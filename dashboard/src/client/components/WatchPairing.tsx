import { useEffect, useState } from 'react'
import type { WatchFrame, WatchLinkSnapshot } from '../../shared/watch-link'
import type { Workspace } from '../../shared/dataset'
import { utcStamp } from '../../shared/format'
import { takeWatchPairingCode } from '../lib/watch-pairing'
import { request } from '../lib/api'

function Frame({ frame }: { frame: WatchFrame }) {
  const status = frame.simulated ? 'SIMULATED DEMO' : 'LATEST RECEIVED'
  return (
    <div className="well px-3.5 py-3">
      <div className="text-[12px] font-bold text-ink">{frame.source} · {status}</div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {frame.readings.map((reading) => (
          <li key={reading.metric} className="text-[12px] text-ink-2">
            {reading.metric} · {reading.quality === 'missing' ? 'Missing' : `${reading.value} ${reading.unit}`}
            {' · '}{reading.quality} · {reading.status}
            <div className="text-[11px] text-ink-3">
              {utcStamp(new Date((reading.measuredAt ?? frame.observedAt) * 1000).toISOString())}
            </div>
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

  return (
    <div className="space-y-3 border-t border-hair pt-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
        e.preventDefault()
        void pair(code)
      }}>
        <label className="flex flex-col gap-1 text-[12px] text-ink-2">
          Watch pairing code
          <input className="rounded-lg border border-line bg-void px-3 py-2 font-mono text-ink"
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCDE-12345"
            autoComplete="one-time-code" autoCapitalize="characters" maxLength={15} required />
        </label>
        <button className="btn btn-ghost" disabled={busy || !code.trim()}>Pair watch</button>
      </form>
      <p className="text-[12px] text-ink-2" role="status">
        {message || 'On the watch, tap Get pairing code. Open its link here or enter the code.'}
      </p>
      {adapterToken && (
        <details className="text-[12px] text-ink-2">
          <summary className="cursor-pointer">Instrument adapter token</summary>
          <code className="break-all">{adapterToken}</code>
        </details>
      )}
      {feedError && <p className="text-[12px] text-coral">Live watch readings are unavailable.</p>}
      {links.map(({ deviceId, watch, telemetry }) => (
        <div className="space-y-2" key={deviceId}>
          {watch && watch.simulated === (workspace === 'demo') && <Frame frame={watch} />}
          {workspace === 'mission' && telemetry.map((frame) => <Frame key={frame.source} frame={frame} />)}
        </div>
      ))}
    </div>
  )
}
