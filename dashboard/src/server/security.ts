/**
 * Request-level security for the mission-computer API, as small pure functions.
 *
 * - Host allowlist: a defence against DNS rebinding. A web page cannot make the browser send
 *   "Host: 127.0.0.1" to this server unless it really is on this machine's address.
 * - Actor: who is calling. A valid device token means the watch app (DEVICE). No token from this
 *   machine's loopback interface means the person at the dashboard (LOCAL_USER). Anything else is
 *   refused.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { NetworkInterfaceInfo } from 'node:os'

export type ActorKind = 'DEVICE' | 'LOCAL_USER'

export type ActorResult =
  | { ok: true; actor: ActorKind }
  | { ok: false; status: 401; code: 'UNAUTHORIZED' | 'INVALID_TOKEN'; message: string }

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function isLoopback(address: string | null | undefined): boolean {
  return typeof address === 'string' && LOOPBACK_ADDRESSES.has(address)
}

/** Constant-time comparison. Hashing first makes both sides the same length. */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

const BEARER = /^Bearer +(\S+) *$/i

/**
 * Decide who is calling.
 * - An Authorization header must carry the device token; a wrong one is refused even from loopback.
 * - No Authorization header is accepted only from this machine (LOCAL_USER).
 */
export function resolveActor(remoteAddress: string | null | undefined, authorization: string | null | undefined, token: string): ActorResult {
  if (authorization !== undefined && authorization !== null) {
    const m = BEARER.exec(authorization)
    if (m && tokensMatch(m[1], token)) return { ok: true, actor: 'DEVICE' }
    return {
      ok: false,
      status: 401,
      code: 'INVALID_TOKEN',
      message: 'The Authorization header does not carry this computer\'s device token (expected "Authorization: Bearer <token>").',
    }
  }
  if (isLoopback(remoteAddress)) return { ok: true, actor: 'LOCAL_USER' }
  return {
    ok: false,
    status: 401,
    code: 'UNAUTHORIZED',
    message: 'Requests from another machine need "Authorization: Bearer <device token>". The token is shown on the dashboard System Status page.',
  }
}

/** The hostname part of a Host header, lower-cased; IPv6 keeps its brackets. null if malformed. */
export function hostnameOf(hostHeader: string | null | undefined): string | null {
  if (typeof hostHeader !== 'string') return null
  const h = hostHeader.trim().toLowerCase()
  if (!h) return null
  let name: string
  let rest: string
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    if (end < 0) return null
    name = h.slice(0, end + 1)
    rest = h.slice(end + 1)
  } else {
    const colon = h.indexOf(':')
    name = colon < 0 ? h : h.slice(0, colon)
    rest = colon < 0 ? '' : h.slice(colon)
  }
  if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return null
  return name || null
}

export type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>

/** This machine's IPv4 addresses on the local network (loopback excluded). */
export function lanIPv4Addresses(interfaces: Interfaces): string[] {
  const out = new Set<string>()
  for (const list of Object.values(interfaces)) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.add(a.address)
  return [...out]
}

/**
 * Hostnames this server answers to. Always the loopback names; on the local network (lan) also
 * this machine's IPv4 addresses and its host name with and without ".local".
 */
export function allowedHostnames(opts: { lan: boolean; interfaces?: Interfaces; hostname?: string }): Set<string> {
  const out = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (opts.lan) {
    for (const address of lanIPv4Addresses(opts.interfaces ?? {})) out.add(address)
    const hn = opts.hostname?.trim().toLowerCase()
    if (hn) {
      out.add(hn)
      out.add(hn.endsWith('.local') ? hn.slice(0, -'.local'.length) : `${hn}.local`)
    }
  }
  return out
}

export function isHostAllowed(hostHeader: string | null | undefined, allowed: Set<string>): boolean {
  const name = hostnameOf(hostHeader)
  return name !== null && allowed.has(name)
}

/** "application/json" with or without parameters such as "; charset=utf-8". */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  if (typeof contentType !== 'string') return false
  return contentType.split(';')[0].trim().toLowerCase() === 'application/json'
}
