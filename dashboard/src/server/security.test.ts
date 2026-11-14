import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { allowedHostnames, hostnameOf, isHostAllowed, isJsonContentType, isLoopback, lanIPv4Addresses, resolveActor, tokensMatch } from './security'

const TOKEN = 'a3f1c0ffee5eed0123456789abcdef0123456789abcdef0123456789abcdef01'

describe('resolveActor', () => {
  it('treats a valid bearer token as the watch app, from any address', () => {
    expect(resolveActor('192.168.1.40', `Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true, actor: 'DEVICE' })
    expect(resolveActor('127.0.0.1', `Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true, actor: 'DEVICE' })
    expect(resolveActor('10.0.0.8', `bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true, actor: 'DEVICE' })
  })

  it('treats a request without Authorization from loopback as the local dashboard user', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(resolveActor(address, undefined, TOKEN)).toEqual({ ok: true, actor: 'LOCAL_USER' })
  })

  it('refuses a request from another machine without a token', () => {
    const r = resolveActor('192.168.1.40', undefined, TOKEN)
    expect(r).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' })
    expect(resolveActor(undefined, undefined, TOKEN)).toMatchObject({ ok: false, status: 401 })
    expect(resolveActor('::ffff:192.168.1.40', undefined, TOKEN)).toMatchObject({ ok: false, status: 401 })
  })

  it('refuses a wrong or malformed Authorization header even from loopback', () => {
    for (const header of ['Bearer wrong-token-wrong-token', `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN, '', 'Bearer', `Bearer ${TOKEN} extra`])
      expect(resolveActor('127.0.0.1', header, TOKEN)).toMatchObject({ ok: false, status: 401, code: 'INVALID_TOKEN' })
  })

  it('compares tokens in constant time without throwing on different lengths', () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true)
    expect(tokensMatch('short', TOKEN)).toBe(false)
    expect(tokensMatch('', TOKEN)).toBe(false)
  })

  it('knows the loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('192.168.1.40')).toBe(false)
    expect(isLoopback(undefined)).toBe(false)
  })
})

describe('Host header allowlist (DNS-rebinding defence)', () => {
  const local = allowedHostnames({ lan: false })

  it('accepts the loopback names on any port, in any case', () => {
    for (const host of ['localhost', 'localhost:4317', '127.0.0.1:5317', '[::1]:4317', '[::1]', 'LOCALHOST:4317'])
      expect(isHostAllowed(host, local)).toBe(true)
  })

  it('refuses other names, look-alikes and malformed headers', () => {
    for (const host of [
      'evil.example',
      'evil.example:4317',
      'localhost.evil.example',
      '127.0.0.1.nip.io:4317',
      'localhost:4317:1',
      'localhost:port',
      '[::1',
      '',
      undefined,
      '192.168.1.20:4317',
    ])
      expect(isHostAllowed(host, local)).toBe(false)
  })

  it('on the local network also accepts this machine\'s IPv4 addresses and host name', () => {
    const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      en0: [
        { address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.20/24' },
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: 'fe80::1/64', scopeid: 4 },
      ],
    }
    expect(lanIPv4Addresses(interfaces)).toEqual(['192.168.1.20'])
    const onLan = allowedHostnames({ lan: true, interfaces, hostname: 'Mission-Laptop' })
    for (const host of ['192.168.1.20:4317', 'mission-laptop:4317', 'Mission-Laptop.local:4317', 'localhost:4317'])
      expect(isHostAllowed(host, onLan)).toBe(true)
    expect(isHostAllowed('192.168.1.99:4317', onLan)).toBe(false)
    expect(isHostAllowed('[fe80::1]:4317', onLan)).toBe(false)
    // Without lan, the same machine's LAN address is refused.
    expect(isHostAllowed('192.168.1.20:4317', local)).toBe(false)
  })

  it('parses host names out of Host headers', () => {
    expect(hostnameOf('Example.LOCAL:80')).toBe('example.local')
    expect(hostnameOf('[::1]:4317')).toBe('[::1]')
    expect(hostnameOf('host:99999999')).toBeNull()
  })
})

describe('JSON content type', () => {
  it('accepts application/json with or without parameters and nothing else', () => {
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('Application/JSON')).toBe(true)
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', '', undefined])
      expect(isJsonContentType(ct)).toBe(false)
  })
})
