import assert from 'node:assert/strict'

const address = process.argv[2]
if (!address) {
  console.error('Usage: node scripts/check-hosted-pairing.mjs https://your-site.vercel.app')
  process.exit(1)
}

const site = new URL(address)
assert.equal(site.protocol, 'https:', 'Use the deployed HTTPS website address.')
assert.ok(!site.username && !site.password, 'Use an address without credentials.')

async function call(path, { method = 'GET', body, token, cookie, expected = 200 } = {}) {
  const response = await fetch(new URL(path, site.origin), {
    method,
    redirect: 'error',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(response.status, expected, `${method} ${path} returned HTTP ${response.status}. Check deployment settings.`)
  return response
}

const health = await call('/api/v1/health').then((response) => response.json())
assert.equal(health.service, 'gravityguard-mission-computer', 'This address does not serve GravityGuard.')
assert.equal(health.network.bind, 'HTTPS', 'This address does not serve the hosted API.')
assert.equal(health.storage.writable, true, 'Set SUPABASE_SECRET_KEY in Vercel and redeploy.')

const { code, watchToken } = await call('/api/pairing', { method: 'POST', expected: 201 }).then((response) => response.json())
try {
  const redeemed = await call('/api/pairing/redeem', { method: 'POST', body: { code } })
  const setCookie = redeemed.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /; Secure/i)
  assert.match(setCookie, /; HttpOnly/i)
  const cookie = setCookie.split(';')[0]
  const { deviceId } = await redeemed.json()
  await call('/api/pairing/redeem', { method: 'POST', body: { code }, expected: 404 })
  const { paired } = await call('/api/device', { token: watchToken }).then((response) => response.json())
  assert.equal(paired, true)
  await call('/api/watch', {
    method: 'POST', token: watchToken, expected: 202,
    body: {
      version: 1, source: 'Hosted pairing check', observedAt: Date.now() / 1000, simulated: true,
      readings: [{ metric: 'Heart rate', value: 77, unit: 'bpm', quality: 'valid', status: 'nominal' }],
    },
  })
  const linked = await call('/api/watch-links', { cookie }).then((response) => response.json())
  assert.equal(linked.find((link) => link.deviceId === deviceId)?.watch?.readings[0]?.value, 77)
  const publicLinks = await call('/api/watch-links').then((response) => response.json())
  assert.deepEqual(publicLinks, [])
} finally {
  await call('/api/device', { method: 'DELETE', token: watchToken })
}

console.log('Hosted pairing, simulated reading delivery, and browser isolation passed.')
