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

export async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, prefix = '/api/v1', timeoutMs = TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${prefix}${path}`, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      // A frozen API must not leave old LIVE or verified labels on screen.
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError')
      throw new ApiError(0, 'API_TIMEOUT', `The local mission-computer API did not answer within ${timeoutMs / 1000} s.`)
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
  storage: { dataDir: string; writable: boolean; lastWriteError?: string | null }
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

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_TESTED'
export type CheckRecordKind = 'EVENT' | 'SESSION' | 'MEASUREMENT'

/** One of the nine watch-integration checks (GET /api/v1/integration/checks). */
export interface IntegrationCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  evidence: string | null
  at: string | null
  recordId?: string | null
  recordKind?: CheckRecordKind | null
  /** dashboard-display: decided in the browser, not on the server. */
  clientCheck?: true
}

export interface IntegrationChecks {
  generatedAt: string
  checks: IntegrationCheck[]
  lan: { enabled: boolean; bind: string; port: number | null; addresses: { interface: string; address: string; url: string }[] }
  watch: {
    paired: boolean
    deviceId: string | null
    lastSeenAt: string | null
    frame: { observedAt: string; metrics: string[]; simulated: boolean } | null
  }
}

/** POST /api/v1/integration/selftest: a simulated round trip through this computer's own endpoints. */
export interface SelftestReport {
  simulated: true
  summary: string
  ranAt: string
  target: { lan: boolean; watchBase: string; consoleBase: string }
  steps: { step: string; method: string; path: string; url: string; status: number | null; ok: boolean; detail: string }[]
  demoEventId: string | null
  passed: boolean
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
  checks: () => request<IntegrationChecks>('GET', '/integration/checks', undefined, '/api/v1', 8000),
  selftest: () => request<SelftestReport>('POST', '/integration/selftest', {}, '/api/v1', 20000),
  review: (workspace: Workspace, eventId: string, action: ReviewAction) =>
    request<{ event: StoredEvent }>('POST', `/alerts/${encodeURIComponent(eventId)}/review?workspace=${workspace}`, action),
  importFile: (fileName: string, content: unknown) => request<ImportResponse>('POST', '/import', { fileName, content }),
  manualReadings: (measurements: unknown[]) => request<{ results: IngestResult[] }>('POST', '/measurements', { measurements }),
  demoReset: () => request<unknown>('POST', '/demo/reset', {}),
  demoTrigger: () => request<{ sessionId: string; eventId: string }>('POST', '/demo/trigger', {}),
  simulateAck: (eventId: string) => request<unknown>('POST', `/demo/alerts/${encodeURIComponent(eventId)}/simulate-ack`, {}),
}

export type { StoredEvent, StoredMeasurement, StoredSession }
