import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('a watch link pairs, streams simulated readings, and creates one review event', async ({ page }) => {
  const created = await page.request.post('/api/pairing')
  expect(created.status()).toBe(201)
  const { code, watchToken } = await created.json()
  const headers = { Authorization: `Bearer ${watchToken}` }
  const frame = {
    version: 1, source: 'Pairing test simulator', observedAt: Date.now() / 1000,
    simulated: true, readings: [{ metric: 'Heart rate', value: 128, unit: 'bpm', quality: 'valid', status: 'review' }],
  }
  expect((await page.request.post('/api/watch', { headers, data: frame })).status()).toBe(401)
  await page.goto('/#pair=' + code)
  await expect(page.getByRole('status').filter({ hasText: 'Watch paired' })).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/system')
  expect((await page.request.post('/api/pairing/redeem', { data: { code } })).status()).toBe(404)
  expect((await (await page.request.get('/api/device', { headers })).json()).paired).toBe(true)
  expect((await page.request.post('/api/watch', { headers, data: frame })).status()).toBe(202)
  await expect(page.getByText('Pairing test simulator · SIMULATED DEMO')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open simulated demo' }).click()
  await page.goto('/#/system')
  await expect(page.getByText('Pairing test simulator · SIMULATED DEMO')).toBeVisible()

  const id = randomUUID()
  const signal = {
    id, createdAt: Date.now() / 1000, frame,
    evidence: ['Heart rate'], action: 'Verify the pulse with the source instrument.',
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expect((await page.request.post('/api/signals', { headers, data: signal })).status()).toBe(202)
  }
  const demo = await (await page.request.get('/api/v1/snapshot?workspace=demo')).json()
  const mission = await (await page.request.get('/api/v1/snapshot?workspace=mission')).json()
  expect(Object.keys(demo.dataset.events).filter((key) => key === id)).toHaveLength(1)
  expect(mission.dataset.events[id]).toBeUndefined()
  await page.goto('/#/events/' + id)
  await expect(page.getByText(signal.action, { exact: true })).toBeVisible()
  await expect(page.getByTestId('reason-codes').getByText('Pairing test simulator · Heart rate 128 bpm · review', { exact: true })).toBeVisible()
})
