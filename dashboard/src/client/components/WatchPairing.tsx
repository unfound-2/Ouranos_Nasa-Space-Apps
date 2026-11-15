import { Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WatchFrame, WatchLinkSnapshot } from '../../shared/watch-link'
import type { Workspace } from '../../shared/dataset'
import { utcStamp } from '../../shared/format'
import { takeWatchPairingCode } from '../lib/watch-pairing'
import { request } from '../lib/api'
import { Secret } from './Secret'

const READING_TONE: Record<WatchFrame['readings'][number]['status'], string> = {
  nominal: 'text-ink-2',
  review: 'text-ink',
  priority: 'text-ink',
}

function Frame({ frame }: { frame: WatchFrame }) {
  const status = frame.simulated ? 'SIMULATED DEMO' : 'LATEST RECEIVED'
  return (
    <div className={`well px-4 py-3.5 ${frame.simulated ? 'sim-hatch' : ''}`}>
      <div className={`text-[11px] font-semibold tracking-[0.08em] ${frame.simulated ? 'text-ink' : 'text-ink'}`}>
        {frame.source} · {status}
      </div>
      <ul className="mt-2.5 grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
        {frame.readings.map((reading) => (
          <li key={reading.metric} className="min-w-0">
            <div className="micro">{reading.metric}</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[15px] font-semibold text-ink tnum">
                {reading.quality === 'missing' ? 'Missing' : reading.value}
                {reading.quality !== 'missing' && <span className="unit ml-1 text-[11px]">{reading.unit}</span>}
              </span>
              <span className={`text-[11px] ${READING_TONE[reading.status]}`}>
                {reading.quality} · {reading.status}
              </span>
            </div>
            <div className="text-[10.5px] text-ink-3 tnum">{utcStamp(new Date((reading.measuredAt ?? frame.observedAt) * 1000).toISOString())}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WatchPairing({ workspace }: { workspace: Workspace }) {
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [adapterToken, setAdapterToken] = useState('')
  const [links, setLinks] = useState<WatchLinkSnapshot[]>([])
  const [feedError, setFeedError] = useState(false)

  async function pair(value: string) {
    setBusy(true)
    setMessage('Checking pairing code…')
    try {
      const paired = await request<{ adapterToken: string }>('POST', '/pairing/redeem', { code: value }, '/api')
      setAdapterToken(paired.adapterToken)
      setCode('')
      setMessage('Watch paired. Readings appear here when the watch sends them.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not pair the watch.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const code = takeWatchPairingCode()
    if (code !== null) void pair(code)
  }, [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await request<WatchLinkSnapshot[]>('GET', '/watch-links', undefined, '/api')
        if (active) {
          setLinks(next)
          setFeedError(false)
        }
      } catch {
        if (active) {
          setLinks([])
          setFeedError(true)
        }
      } finally {
        if (active) timer = setTimeout(refresh, 2500)
      }
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [])

  const frames = links.flatMap(({ deviceId, watch, telemetry }) => [
    ...(watch && watch.simulated === (workspace === 'demo') ? [{ key: `${deviceId}:watch`, frame: watch }] : []),
    ...(workspace === 'mission' ? telemetry.map((frame) => ({ key: `${deviceId}:${frame.source}`, frame })) : []),
  ])

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void pair(code)
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="micro">Watch pairing code</span>
          <input
            className="field code tracking-[0.06em] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCDE-12345"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            maxLength={15}
            required
          />
        </label>
        <button className="btn btn-primary" disabled={busy || !code.trim()} aria-busy={busy}>
          <Link2 size={14} /> Pair watch
        </button>
      </form>
      <p className="text-[12px] text-ink-2" role="status">
        {message || 'Tap Get pairing code on the watch, then type the code here or open the pairing link it shares.'}
      </p>
      {adapterToken && (
        <div className="well px-4 py-3">
          <div className="micro mb-2">Instrument adapter token</div>
          <Secret value={adapterToken} label="Instrument adapter token" testId="adapter-token" />
          <p className="mt-1 text-[11.5px] text-ink-3">Only needed by the onboard instrument adapter (adapter.mjs). It is not kept: reloading this page clears it.</p>
        </div>
      )}
      {feedError && <p className="text-[12px] text-ink">Live watch readings are unavailable.</p>}
      {frames.map(({ key, frame }) => (
        <Frame key={key} frame={frame} />
      ))}
    </div>
  )
}
