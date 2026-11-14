/**
 * Typed client for the local mission-computer API. Same origin only: in development Vite
 * proxies /api to the local server, in production the server serves this app.
 * There is no fallback data source: if the API is down, callers get an ApiError.
 */
import type { ReviewAction, StoredEvent, StoredMeasurement, StoredSession } from '../../shared/contract'
import type { Dataset, IngestResult, LinkState, Workspace } from '../../shared/dataset'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string[] = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const TIMEOUT_MS = 4000

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      // A frozen API must not leave old LIVE or verified labels on screen.
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new ApiError(0, 'API_TIMEOUT', `The local mission-computer API did not answer within ${TIMEOUT_MS / 1000} s.`)
    throw new ApiError(0, 'API_UNREACHABLE', 'The local mission-computer API is not reachable.')
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `The API answered with something other than JSON (HTTP ${res.status}).`)
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: string[] } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `HTTP ${res.status}`, err?.details ?? [])
  }
  return json as T
}

export interface Health {
  ok: boolean
  service: string
  version: string
  contractVersion: string
  time: string
  uptimeSeconds: number
  storage: { dataDir: string; writable: boolean }
  workspaces: Record<Workspace, { sessions: number; events: number; readings: number; devices: number }>
  network: { bind: string; lan: boolean }
}

export interface Snapshot {
  workspace: Workspace
  serverTime: string
  dataset: Dataset
  links: Record<string, LinkState>
}

export interface Integration {
  token: string
  tokenFile: string
  port: number
  lan: boolean
  urls: string[]
  endpoints: { method: string; path: string; actor: string; purpose: string }[]
}

export interface ImportResponse {
  results: IngestResult[]
  workspaces?: Workspace[]
}

export const api = {
  health: () => request<Health>('GET', '/health'),
  async snapshot(workspace: Workspace): Promise<Snapshot> {
    const s = await request<Snapshot>('GET', `/snapshot?workspace=${workspace}`)
    // The API leaves out the dedup fingerprints; the shared functions do not need them.
    return { ...s, dataset: { ...s.dataset, fingerprints: {} } }
  },
  integration: () => request<Integration>('GET', '/integration'),
  review: (workspace: Workspace, eventId: string, action: ReviewAction) =>
    request<{ event: StoredEvent }>('POST', `/alerts/${encodeURIComponent(eventId)}/review?workspace=${workspace}`, action),
  importFile: (fileName: string, content: unknown) => request<ImportResponse>('POST', '/import', { fileName, content }),
  manualReadings: (measurements: unknown[]) => request<{ results: IngestResult[] }>('POST', '/measurements', { measurements }),
  demoReset: () => request<unknown>('POST', '/demo/reset', {}),
  demoTrigger: () => request<{ sessionId: string; eventId: string }>('POST', '/demo/trigger', {}),
  simulateAck: (eventId: string) => request<unknown>('POST', `/demo/alerts/${encodeURIComponent(eventId)}/simulate-ack`, {}),
}

export type { StoredEvent, StoredMeasurement, StoredSession }
