/**
 * Data provider. Polls the local API for the chosen workspace and exposes actions.
 * Switching workspace clears what is on screen first, so mission and simulated data are
 * never shown under the other's label, and an unreachable API shows an error, not fixtures.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ReviewAction } from '../../shared/contract'
import type { Workspace } from '../../shared/dataset'
import { api, ApiError, type Health, type Snapshot } from './api'

const POLL_MS = 2500

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function writePref(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: preferences just do not persist */
  }
}

export interface TriggerNotice {
  eventId: string
  at: number
}

interface DataState {
  workspace: Workspace
  setWorkspace: (w: Workspace) => void
  snapshot: Snapshot | null
  error: ApiError | null
  health: Health | null
  latencyMs: number | null
  /** Server clock minus browser clock, measured at the midpoint of the last request. */
  skewMs: number | null
  lastOkAt: number | null
  refresh: () => Promise<void>
  subjectId: string | null
  setSubjectId: (id: string | null) => void
  trigger: TriggerNotice | null
  dismissTrigger: () => void
  actions: {
    review: (eventId: string, action: ReviewAction) => Promise<void>
    importFile: (fileName: string, content: unknown) => ReturnType<typeof api.importFile>
    demoReset: () => Promise<void>
    demoTrigger: () => Promise<string>
    simulateAck: (eventId: string) => Promise<void>
    manualReadings: (measurements: unknown[]) => ReturnType<typeof api.manualReadings>
  }
}

const Ctx = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<Workspace>(() => (readPref('gg.workspace') === 'demo' ? 'demo' : 'mission'))
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [latencyMs, setLatency] = useState<number | null>(null)
  const [skewMs, setSkew] = useState<number | null>(null)
  const [lastOkAt, setLastOkAt] = useState<number | null>(null)
  const [subjectId, setSubjectState] = useState<string | null>(() => readPref(`gg.subject.${readPref('gg.workspace') ?? 'mission'}`))
  const [trigger, setTrigger] = useState<TriggerNotice | null>(null)
  const wsRef = useRef(workspace)
  wsRef.current = workspace
  const inflight = useRef(false)

  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    const ws = wsRef.current
    const started = performance.now()
    const startedWall = Date.now()
    try {
      const [h, s] = await Promise.all([api.health(), api.snapshot(ws)])
      if (wsRef.current !== ws) return
      const rtt = performance.now() - started
      setLatency(Math.round(rtt))
      setSkew(Date.parse(h.time) - (startedWall + rtt / 2))
      setHealth(h)
      setSnapshot(s)
      setError(null)
      setLastOkAt(Date.now())
    } catch (e) {
      if (wsRef.current !== ws) return
      setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e)))
      setHealth(null)
      setSnapshot(null)
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const onVis = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refresh, workspace])

  const setWorkspace = useCallback((w: Workspace) => {
    writePref('gg.workspace', w)
    wsRef.current = w
    setSnapshot(null)
    setError(null)
    setSubjectState(readPref(`gg.subject.${w}`))
    setWorkspaceState(w)
  }, [])

  const setSubjectId = useCallback((id: string | null) => {
    writePref(`gg.subject.${wsRef.current}`, id)
    setSubjectState(id)
  }, [])

  const actions = useMemo<DataState['actions']>(
    () => ({
      async review(eventId, action) {
        await api.review(wsRef.current, eventId, action)
        await refresh()
      },
      async importFile(fileName, content) {
        const r = await api.importFile(fileName, content)
        await refresh()
        return r
      },
      async demoReset() {
        await api.demoReset()
        await refresh()
      },
      async demoTrigger() {
        const r = await api.demoTrigger()
        setTrigger({ eventId: r.eventId, at: Date.now() })
        await refresh()
        return r.eventId
      },
      async simulateAck(eventId) {
        await api.simulateAck(eventId)
        await refresh()
      },
      async manualReadings(measurements) {
        const r = await api.manualReadings(measurements)
        await refresh()
        return r
      },
    }),
    [refresh],
  )

  const value: DataState = {
    workspace,
    setWorkspace,
    snapshot,
    error,
    health,
    latencyMs,
    skewMs,
    lastOkAt,
    refresh,
    subjectId,
    setSubjectId,
    trigger,
    dismissTrigger: () => setTrigger(null),
    actions,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}

/** Counts every resource this page loaded from somewhere other than this computer. */
export function useExternalRequests(): { count: number; origins: string[] } {
  const [state, setState] = useState<{ count: number; origins: string[] }>({ count: 0, origins: [] })
  useEffect(() => {
    const local = new Set([window.location.origin])
    const isLocal = (url: string) => {
      try {
        const u = new URL(url, window.location.href)
        return local.has(u.origin) || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:'
      } catch {
        return true
      }
    }
    const collect = () => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const external = entries.filter((e) => !isLocal(e.name))
      setState({ count: external.length, origins: [...new Set(external.map((e) => new URL(e.name).origin))] })
    }
    collect()
    let obs: PerformanceObserver | null = null
    try {
      obs = new PerformanceObserver(collect)
      obs.observe({ type: 'resource', buffered: true })
    } catch {
      /* older engines: the initial count still stands */
    }
    return () => obs?.disconnect()
  }, [])
  return state
}

/** The browser's own network flag. It says whether any network is attached, not whether the internet works. */
export function useNavigatorOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
