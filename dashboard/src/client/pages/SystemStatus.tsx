import { Copy, Eye, EyeOff, FileUp, FlaskConical, HardDrive, Network, Plug, RotateCcw, Watch } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IngestResult } from '../../shared/dataset'
import { ago, utcStamp } from '../../shared/format'
import { Code, Empty, KV, Panel, Pill } from '../components/ui'
import { api, ApiError, type Integration } from '../lib/api'
import { useData, useExternalRequests, useNavigatorOnline, useNow } from '../lib/data'
import { LINK_META, sessionsOf, subjectLabel, subjectsOf, type Tone } from '../lib/view'
import { WatchPairing } from '../components/WatchPairing'
import { TriggerButton } from './Overview'

const OUTCOME_TONE: Record<IngestResult['outcome'], Tone> = {
  CREATED: 'mint',
  UPDATED: 'cyan',
  DUPLICATE: 'muted',
  STALE_IGNORED: 'muted',
  CONFLICT: 'amber',
  REJECTED: 'coral',
}

function Section({ icon, title, children, meta, className = '' }: { icon: ReactNode; title: string; children: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <Panel
      className={className}
      title={
        <h2 className="label flex items-center gap-2">
          <span className="text-ink-3">{icon}</span>
          {title}
        </h2>
      }
      meta={meta}
    >
      {children}
    </Panel>
  )
}

function ImportPanel() {
  const { actions } = useData()
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ file: string; results: IngestResult[]; error?: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function handle(file: File) {
    setBusy(true)
    setResult(null)
    try {
      if (file.size > 2_000_000) throw new Error('File is larger than 2 MB.')
      let content: unknown
      try {
        content = JSON.parse(await file.text())
      } catch {
        throw new Error('The file is not valid JSON.')
      }
      const r = await actions.importFile(file.name, content)
      setResult({ file: file.name, results: r.results })
    } catch (e) {
      const results = e instanceof ApiError ? ((e as ApiError & { results?: IngestResult[] }).results ?? []) : []
      setResult({ file: file.name, results, error: e instanceof ApiError ? `${e.message}${e.details.length ? `: ${e.details.join('; ')}` : ''}` : String(e instanceof Error ? e.message : e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) void handle(f)
        }}
        className={`flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-5 transition-colors ${drag ? 'border-cyan bg-cyan/[0.06]' : 'border-line'}`}
      >
        <p className="text-[13px] text-ink-2">
          Drop a watch export (<Code>gravityguard.export-bundle.v1</Code>, a session, an event, or a list of them). A file from the watch app is labelled <b className="text-ink">SAVED DEVICE DATA</b>, never live.
          Records go to the workspace their <Code>isSimulated</Code> flag names.
        </p>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} data-testid="import-input" />
        <button className="btn btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
          <FileUp size={15} /> {busy ? 'Importing' : 'Choose JSON file'}
        </button>
      </div>
      {result && (
        <div className="mt-4" data-testid="import-result">
          <div className="text-[12.5px] text-ink">
            {result.file}
            {result.error && <span className="ml-2 text-coral">{result.error}</span>}
          </div>
          {result.results.length > 0 && (
            <table className="data-table mt-2">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Type</th>
                  <th>Stored in</th>
                  <th>Outcome</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono text-[11.5px]">{r.id ?? '--'}</td>
                    <td className="text-ink-2">{r.kind?.toLowerCase() ?? '--'}</td>
                    <td className="text-ink-2">{r.workspace === 'demo' ? 'Simulated demo' : r.workspace === 'mission' ? 'Mission records' : '--'}</td>
                    <td>
                      <Pill tone={OUTCOME_TONE[r.outcome]}>{r.outcome.replace('_', ' ')}</Pill>
                    </td>
                    <td className="text-[12px] text-ink-3">{r.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function ManualReading() {
  const { snapshot, workspace, actions, subjectId } = useData()
  const ds = snapshot?.dataset
  const [subject, setSubject] = useState(subjectId ?? '')
  const [session, setSession] = useState('')
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  const [at, setAt] = useState('')
  const [device, setDevice] = useState('Upper-arm cuff')
  const [quality, setQuality] = useState<'VALID' | 'QUESTIONABLE' | 'INVALID'>('VALID')
  const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null)
  if (!ds) return null
  const sim = workspace === 'demo'
  const sessions = subject ? sessionsOf(ds, subject) : []
  async function submit() {
    setMsg(null)
    const measuredAt = at ? `${at.length === 16 ? `${at}:00` : at}Z` : ''
    const base = Date.now()
    const mk = (suffix: string, indicator: string, value: string) => ({
      measurementId: `manual-${base}-${suffix}`,
      subjectId: subject,
      sessionId: session || null,
      indicator,
      value: value === '' ? null : Number(value),
      unit: 'mmHg',
      measuredAt,
      phase: null,
      source: { kind: 'EXTERNAL_INSTRUMENT', device: device || null, sensor: null },
      provenance: { origin: 'MISSION_COMPUTER', appVersion: null, deviceId: null },
      isSimulated: sim,
      quality: value === '' ? 'MISSING' : quality,
    })
    try {
      const r = await actions.manualReadings([mk('sys', 'BLOOD_PRESSURE_SYSTOLIC', sys), mk('dia', 'BLOOD_PRESSURE_DIASTOLIC', dia)])
      setMsg({ tone: 'mint', text: `Stored ${r.results.filter((x) => x.outcome === 'CREATED').length} readings as MANUALLY ENTERED${sim ? ' (simulated workspace)' : ''}.` })
      setSys('')
      setDia('')
    } catch (e) {
      setMsg({ tone: 'coral', text: e instanceof ApiError ? `${e.message}${e.details.length ? `: ${e.details.join('; ')}` : ''}` : String(e) })
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-2">
        Type in a reading from an external instrument, such as a cuff. It is stored and shown as <b className="text-ink">MANUALLY ENTERED</b> from that instrument, never as a watch measurement.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="micro">Astronaut</span>
          <select className="field" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Choose</option>
            {subjectsOf(ds).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Link to session</span>
          <select className="field" value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="">None</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {utcStamp(s.startedAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Systolic (mmHg)</span>
          <input className="field" inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Diastolic (mmHg)</span>
          <input className="field" inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Measured at (UTC)</span>
          <input type="datetime-local" step="1" className="field" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Instrument</span>
          <input className="field" value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Instrument quality flag</span>
          <select className="field" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="VALID">Valid</option>
            <option value="QUESTIONABLE">Questionable</option>
            <option value="INVALID">Invalid</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost" disabled={!subject || !at || (!sys && !dia)} onClick={submit}>
          Store reading
        </button>
        {msg && <span className={`text-[12px] ${msg.tone === 'coral' ? 'text-coral' : 'text-mint'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}

function IntegrationPanel() {
  const [info, setInfo] = useState<Integration | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    api.integration().then(setInfo, (e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  if (err) return <p className="text-[12.5px] text-coral">{err}</p>
  if (!info) return <p className="text-[12.5px] text-ink-3">Loading…</p>
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <KV k="Network mode">{info.lan ? 'Local network (watch can connect)' : 'This computer only (127.0.0.1)'}</KV>
        <KV k="Port" mono>
          {info.port}
        </KV>
      </dl>
      <div>
        <div className="micro">Addresses</div>
        <ul className="mt-1.5 space-y-1">
          {info.urls.map((u) => (
            <li key={u} className="font-mono text-[12px] text-ink-2">
              {u}
            </li>
          ))}
        </ul>
        {!info.lan && (
          <p className="mt-2 text-[12px] text-ink-3">
            The watch cannot reach this computer in this mode. Restart with <Code>GG_LAN=1 npm start</Code> to accept watch connections on the local network.
          </p>
        )}
      </div>
      <div>
        <div className="micro">Watch pairing token</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-line bg-void px-3 py-2 font-mono text-[12px] text-ink" data-testid="token">
            {show ? info.token : `${'•'.repeat(24)}${info.token.slice(-4)}`}
          </code>
          <button className="btn btn-ghost h-9" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? 'Hide' : 'Reveal'}
          </button>
          <button
            className="btn btn-ghost h-9"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(info.token)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                setShow(true)
              }
            }}
          >
            <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          The watch app sends <Code>Authorization: Bearer &lt;token&gt;</Code>. Stored in <Code>{info.tokenFile}</Code>. Treat it like a password; it is shown only on this computer.
        </p>
      </div>
      <details>
        <summary className="cursor-pointer text-[12.5px] text-ink-2 hover:text-ink">Endpoints ({info.endpoints.length})</summary>
        <table className="data-table mt-2">
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Who</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {info.endpoints.map((e) => (
              <tr key={`${e.method} ${e.path}`}>
                <td className="font-mono text-[11.5px]">{e.method}</td>
                <td className="font-mono text-[11.5px]">{e.path}</td>
                <td className="text-ink-2">{e.actor}</td>
                <td className="text-ink-3">{e.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

export function SystemStatus() {
  const { snapshot, health, latencyMs, skewMs, error, workspace, actions } = useData()
  const now = useNow(1000)
  const online = useNavigatorOnline()
  const external = useExternalRequests()
  const [resetting, setResetting] = useState(false)
  const skew = skewMs === null ? null : Math.round(skewMs / 1000)
  const devices = snapshot ? Object.values(snapshot.dataset.devices) : []
  return (
    <div className="flex flex-col gap-5">
      <div className="rise">
        <div className="micro">System status</div>
        <h1 className="mt-2 font-display text-[clamp(24px,2.6vw,34px)] tracking-[0.06em]">MISSION COMPUTER</h1>
        <p className="mt-2 max-w-[70ch] text-[13.5px] text-ink-2">What this computer is running, where records live, how the watch connects, and proof that nothing here depends on the internet.</p>
      </div>

      <section className="grid gap-5 lg:grid-cols-3">
        <Section icon={<HardDrive size={14} />} title="Local computer" meta={<Pill tone={error ? 'coral' : health ? 'mint' : 'neutral'} dot>{error ? 'API down' : health ? 'Online' : 'Connecting'}</Pill>}>
          {health ? (
            <dl className="grid grid-cols-2 gap-4">
              <KV k="Service">{health.service}</KV>
              <KV k="Version" mono>
                {health.version} · contract {health.contractVersion}
              </KV>
              <KV k="Round trip">{latencyMs ?? '--'} ms</KV>
              <KV k="Clock vs browser">{skew === null ? '--' : skew === 0 ? 'In step' : `${skew > 0 ? '+' : ''}${skew} s`}</KV>
              <KV k="Up for">{ago(new Date(Date.now() - health.uptimeSeconds * 1000).toISOString(), Date.now()).replace(' ago', '')}</KV>
              <KV k="Storage">{health.storage.writable ? 'Writable' : 'NOT WRITABLE'}</KV>
              <div className="col-span-2">
                <KV k="Data directory" mono>
                  {health.storage.dataDir}
                </KV>
              </div>
              <KV k="Mission records">
                {health.workspaces.mission.sessions} sessions · {health.workspaces.mission.events} events
              </KV>
              <KV k="Simulated demo">
                {health.workspaces.demo.sessions} sessions · {health.workspaces.demo.events} events
              </KV>
            </dl>
          ) : (
            <Empty title={error ? 'The local API is not reachable' : 'Connecting'}>{error ? 'Start it with npm start (production) or npm run dev.' : null}</Empty>
          )}
        </Section>

        <Section icon={<Network size={14} />} title="Offline operation" meta={<Pill tone={external.count ? 'amber' : 'mint'} dot>{external.count ? `${external.count} external` : '0 external requests'}</Pill>}>
          <dl className="grid grid-cols-2 gap-4" data-testid="offline-panel">
            <KV k="Requests to other machines">
              <span data-testid="external-count">{external.count}</span>
              {external.origins.length ? ` (${external.origins.join(', ')})` : ''}
            </KV>
            <KV k="Browser network flag">{online ? 'Attached' : 'Disconnected'}</KV>
            <KV k="Fonts, icons, figure">Bundled with the app</KV>
            <KV k="Analysis and review">Run on this computer</KV>
          </dl>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
            The count covers every file and request this page has loaded since it opened. The browser flag only says whether a network is attached; it does not test internet access, and the dashboard does not
            need either. To check: turn Wi-Fi off and keep using this page.
          </p>
        </Section>

        <Section icon={<Watch size={14} />} title="Watch links" meta={<span className="text-[12px] text-ink-3">{workspace === 'demo' ? 'Simulated devices' : 'Mission devices'}</span>}>
          {devices.length ? (
            <ul className="space-y-3">
              {devices.map((d) => {
                const link = snapshot?.links[d.deviceId] ?? 'NOT_PAIRED'
                const meta = LINK_META[link]
                return (
                  <li key={d.deviceId} className="well px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-ink">{d.deviceId}</span>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>
                    <div className="mt-1.5 text-[11.5px] text-ink-3">
                      {d.subjectId ? subjectLabel(d.subjectId) : 'No crew member'} · {d.deviceModel ?? 'unknown model'} · last contact {utcStamp(d.lastSeenAt)} ({ago(d.lastSeenAt, now)})
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty title="No watch has checked in">A watch appears here after its first authenticated heartbeat or record. Until then the dashboard shows WATCH UNREACHABLE or NO WATCH LINK, never connected.</Empty>
          )}
          <p className="mt-3 text-[11.5px] text-ink-3">Verified means an authenticated contact in the last 60 seconds. A successful send is never treated as proof that the watch showed an alert.</p>
        </Section>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Section icon={<FileUp size={14} />} title="Import records">
          <ImportPanel />
        </Section>
        <Section icon={<Plug size={14} />} title="Watch integration">
          <WatchPairing workspace={workspace} />
          <IntegrationPanel />
        </Section>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Section icon={<HardDrive size={14} />} title="Enter an external reading">
          <ManualReading />
        </Section>
        <Section icon={<FlaskConical size={14} />} title="Simulated demo" meta={<Pill tone="violet">Demo workspace only</Pill>}>
          <p className="text-[12.5px] text-ink-2">
            These controls only ever write simulated records to the demo workspace. Mission records are never touched. Fixtures keep their original dates; a triggered event is stamped with the moment you press the button.
          </p>
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {workspace === 'demo' ? (
              <TriggerButton />
            ) : (
              <span className="text-[12px] text-ink-3">Switch to the simulated demo (banner above) to trigger a simulated watch event.</span>
            )}
            <button
              className="btn btn-ghost"
              disabled={resetting}
              onClick={async () => {
                setResetting(true)
                try {
                  await actions.demoReset()
                } finally {
                  setResetting(false)
                }
              }}
            >
              <RotateCcw size={15} /> {resetting ? 'Resetting' : 'Reset simulated scenarios'}
            </button>
          </div>
        </Section>
      </section>
    </div>
  )
}
