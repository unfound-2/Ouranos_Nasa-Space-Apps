/** A tiny hash router: #/, #/crew, #/events, #/events/:id, #/sessions/:id, #/system. */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'overview' }
  | { name: 'crew' }
  | { name: 'events' }
  | { name: 'event'; id: string }
  | { name: 'session'; id: string }
  | { name: 'system' }
  | { name: 'missing'; path: string }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'overview' }
  if (parts[0] === 'crew' && parts.length === 1) return { name: 'crew' }
  if (parts[0] === 'system' && parts.length === 1) return { name: 'system' }
  if (parts[0] === 'events' && parts.length === 1) return { name: 'events' }
  if (parts[0] === 'events' && parts.length === 2) return { name: 'event', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'sessions' && parts.length === 2) return { name: 'session', id: decodeURIComponent(parts[1]) }
  return { name: 'missing', path }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  return parseRoute(hash)
}

export const href = {
  overview: '#/',
  crew: '#/crew',
  events: '#/events',
  event: (id: string) => `#/events/${encodeURIComponent(id)}`,
  session: (id: string) => `#/sessions/${encodeURIComponent(id)}`,
  system: '#/system',
}

export function navigate(to: string) {
  if (window.location.hash !== to) window.location.hash = to
  window.scrollTo({ top: 0 })
}
