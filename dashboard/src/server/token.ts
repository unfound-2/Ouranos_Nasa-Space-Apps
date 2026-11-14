/**
 * The device token the watch app sends as "Authorization: Bearer <token>".
 *
 * Order: an explicit token (createApp option), then GG_DEVICE_TOKEN, then <dataDir>/device-token,
 * which is created on first start with 32 random bytes (hex) and file mode 0600.
 * Callers log tokenPrefix() and the file path, never the token itself.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const TOKEN_FILE_NAME = 'device-token'

export interface DeviceToken {
  token: string
  source: 'option' | 'env' | 'file'
  /** The token file, or null when the token came from the option or the environment. */
  file: string | null
  /** True when this call generated a new token file. */
  created: boolean
}

/** Printable ASCII without spaces (it travels in an HTTP header), 16 to 256 characters. */
const TOKEN_SHAPE = /^[\x21-\x7e]{16,256}$/

function checkShape(token: string, where: string): string {
  if (!TOKEN_SHAPE.test(token))
    throw new Error(`The device token from ${where} must be 16-256 printable characters without spaces.`)
  return token
}

export function tokenPrefix(token: string): string {
  return `${token.slice(0, 4)}…`
}

export function resolveDeviceToken(opts: { dataDir: string; token?: string | null; env?: NodeJS.ProcessEnv }): DeviceToken {
  if (opts.token) return { token: checkShape(opts.token, 'the token option'), source: 'option', file: null, created: false }
  const fromEnv = opts.env?.GG_DEVICE_TOKEN
  if (fromEnv) return { token: checkShape(fromEnv, 'GG_DEVICE_TOKEN'), source: 'env', file: null, created: false }

  const file = path.join(opts.dataDir, TOKEN_FILE_NAME)
  const existing = readTokenFile(file)
  if (existing !== null) return { token: existing, source: 'file', file, created: false }

  const token = randomBytes(32).toString('hex')
  try {
    // "wx" fails if the file appeared in the meantime; then use that one.
    writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      const raced = readTokenFile(file)
      if (raced !== null) return { token: raced, source: 'file', file, created: false }
    }
    throw new Error(`Could not create the device token file ${file}: ${(e as Error).message}`)
  }
  return { token, source: 'file', file, created: true }
}

function readTokenFile(file: string): string | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`Could not read the device token file ${file}: ${(e as Error).message}`)
  }
  const token = checkShape(text.trim(), file)
  try {
    // Keep it private to this user even if someone widened the permissions.
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600)
  } catch {
    // Best effort; some file systems do not support permissions.
  }
  return token
}
