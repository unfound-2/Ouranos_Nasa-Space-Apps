/** A tiny hash router: #/, #/crew, #/events, #/events/:id, #/sessions/:id, #/system. */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'pair' }
  | { name: 'overview' }
  | { name: 'crew' }
  | { name: 'plan' }
  | { name: 'attention'; id?: string }
  | { name: 'events' }
  | { name: 'event'; id: string }
  | { name: 'session'; id: string }
  | { name: 'system' }
  | { name: 'guide'; topic?: string }
  | { name: 'missing'; path: string }

export function parseRoute(hash: string): Route {
  const path = hash.split('?')[0].replace(/^#/, '').replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'overview' }
  if (parts[0] === 'pair' && parts.length === 1) return { name: 'pair' }
  if (parts[0] === 'plan' && parts.length === 1) return { name: 'plan' }
  if (parts[0] === 'crew' && parts.length === 1) return { name: 'crew' }
  if (parts[0] === 'guide' && parts.length === 1) return { name: 'guide', topic: new URLSearchParams(hash.split('?')[1]).get('topic') ?? undefined }
  if (parts[0] === 'system' && parts.length === 1) return { name: 'system' }
  if (parts[0] === 'attention' && parts.length === 1) return { name: 'attention' }
  if (parts[0] === 'events' && parts.length === 1) return { name: 'events' }
  if (parts[0] === 'attention' && parts.length === 2) {
    try { return { name: 'attention', id: decodeURIComponent(parts[1]) } } catch { return { name: 'missing', path } }
  }
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
  pair: '#/pair',
  overview: '#/',
  crew: '#/crew',
  plan: '#/plan',
  events: '#/events',
  attention: '#/attention',
  attentionFor: (id: string) => `#/attention/${encodeURIComponent(id)}`,
  event: (id: string) => `#/events/${encodeURIComponent(id)}`,
  session: (id: string) => `#/sessions/${encodeURIComponent(id)}`,
  system: '#/system',
  guide: '#/guide',
  guideTopic: (topic: string) => `#/guide?topic=${encodeURIComponent(topic)}`,
}

export function navigate(to: string) {
  if (window.location.hash !== to) window.location.hash = to
  window.scrollTo({ top: 0 })
}
