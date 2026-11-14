import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDeviceToken, TOKEN_FILE_NAME, tokenPrefix } from './token'

const dirs: string[] = []
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gg-token-test-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('device token', () => {
  it('creates a 32-byte hex token file readable only by this user, and reuses it', () => {
    const dir = tempDir()
    const first = resolveDeviceToken({ dataDir: dir, env: {} })
    expect(first).toMatchObject({ source: 'file', created: true, file: path.join(dir, TOKEN_FILE_NAME) })
    expect(first.token).toMatch(/^[0-9a-f]{64}$/)
    expect(statSync(first.file!).mode & 0o777).toBe(0o600)
    expect(readFileSync(first.file!, 'utf8').trim()).toBe(first.token)
    const second = resolveDeviceToken({ dataDir: dir, env: {} })
    expect(second).toMatchObject({ token: first.token, source: 'file', created: false })
  })

  it('prefers the explicit option, then GG_DEVICE_TOKEN, over the file', () => {
    const dir = tempDir()
    const fromFile = resolveDeviceToken({ dataDir: dir, env: {} }).token
    const env = { GG_DEVICE_TOKEN: 'env-token-0123456789abcdef' }
    expect(resolveDeviceToken({ dataDir: dir, env })).toMatchObject({ token: env.GG_DEVICE_TOKEN, source: 'env', file: null })
    expect(resolveDeviceToken({ dataDir: dir, env, token: 'option-token-0123456789' })).toMatchObject({ token: 'option-token-0123456789', source: 'option' })
    expect(readFileSync(path.join(dir, TOKEN_FILE_NAME), 'utf8').trim()).toBe(fromFile)
  })

  it('refuses a short token or one with spaces', () => {
    const dir = tempDir()
    expect(() => resolveDeviceToken({ dataDir: dir, env: { GG_DEVICE_TOKEN: 'abc' } })).toThrow(/GG_DEVICE_TOKEN/)
    expect(() => resolveDeviceToken({ dataDir: dir, env: {}, token: 'has spaces in the token value' })).toThrow(/printable/)
  })

  it('refuses an unusable token file without overwriting it', () => {
    const dir = tempDir()
    const file = path.join(dir, TOKEN_FILE_NAME)
    writeFileSync(file, 'oops\n', { mode: 0o600 })
    expect(() => resolveDeviceToken({ dataDir: dir, env: {} })).toThrow(file)
    expect(readFileSync(file, 'utf8')).toBe('oops\n')
  })

  it('tightens a token file that others could read', () => {
    const dir = tempDir()
    const file = path.join(dir, TOKEN_FILE_NAME)
    writeFileSync(file, `${'ab'.repeat(32)}\n`, { mode: 0o644 })
    expect(resolveDeviceToken({ dataDir: dir, env: {} }).token).toBe('ab'.repeat(32))
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('shows only the first four characters when logged', () => {
    expect(tokenPrefix('a3f1c0ffee5eed0123456789')).toBe('a3f1…')
  })
})
