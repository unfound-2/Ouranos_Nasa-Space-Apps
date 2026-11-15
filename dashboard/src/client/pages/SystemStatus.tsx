import { Disclosure } from '../components/ui'
import { watchSignIn } from '../lib/watch-pairing'
import { ArrowUpRight, Check, Copy, Cpu, FileUp, FlaskConical, Minus, MonitorCheck, RefreshCw, RotateCcw, SquareCheck, SquareDashed, SquareX, Watch, Wifi, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IngestPathT } from '../../shared/contract'
import type { Dataset, DeviceRecord, IngestResult } from '../../shared/dataset'
import { ago, plural, utcStamp, utcTime } from '../../shared/format'
import { Code, Pill, SectionNo } from '../components/ui'
import { Secret } from '../components/Secret'
import { WatchPairing } from '../components/WatchPairing'
import { api, ApiError, type CheckStatus, type Integration, type IntegrationCheck, type IntegrationChecks, type SelftestReport } from '../lib/api'
import { useData, useExternalRequests, useNavigatorOnline, useNow } from '../lib/data'
import { checkTally, resolveChecks } from '../lib/integration'
import { href } from '../lib/router'
import { LINK_META, sessionsOf, subjectLabel, subjectsOf, type Tone } from '../lib/view'
import { TriggerButton } from './Overview'
import './tabs.css'

// ---------------------------------------------------------------------------
// Shared pieces

function Section({ index, title, aside, children, className = '', testId }: { index: string; title: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`} data-testid={testId} data-index={index}>
      <header className="pane-head flex-wrap">
        <h2 className="label">
          <SectionNo n={index} />
          {title}
        </h2>
        {aside}
      </header>
      <div className="flex flex-1 flex-col px-5 pt-1 pb-5">{children}</div>
    </section>
  )
}

function Row({ k, children, mono = false }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)] items-baseline gap-x-4 border-t border-hair py-2 first:border-t-0 first:pt-0">
      <dt className="micro">{k}</dt>
      <dd className={`min-w-0 text-[13px] break-words text-ink ${mono ? 'font-mono text-[11.5px] whitespace-pre-wrap' : ''}`}>{children}</dd>
    </div>
  )
}

const STATUS_MARK: Record<CheckStatus, { icon: ReactNode; text: string; className: string; bar: string }> = {
  PASS: { icon: <Check size={14} strokeWidth={2.4} />, text: 'Pass', className: 'text-ink', bar: 'bg-mint' },
  FAIL: { icon: <X size={14} strokeWidth={2.4} />, text: 'Fail', className: 'text-ink', bar: 'bg-coral' },
  NOT_TESTED: { icon: <Minus size={14} strokeWidth={2} />, text: 'Not tested', className: 'text-ink-3', bar: 'bg-line' },
}

/** The brief's names for the nine checks, in the order a connection is built. */
const CHECK_TITLE: Record<string, string> = {
  backend: 'Backend running',
  'lan-enabled': 'LAN endpoint enabled',
  'network-interface': 'Network interface detected',
  pairing: 'Pairing configured',
  'lan-reachable': 'LAN endpoint reachable',
  'device-ingest': 'Real device record received',
  'record-persisted': 'Record saved to disk',
  'dashboard-display': 'Shown in this dashboard',
  'watch-confirmation': 'Watch receipt or acknowledgement',
}

/** The watch can only use an address on the network it shares with this computer. */
function interfaceKind(name: string): { label: string; usable: boolean } {
  if (/^en\d/.test(name)) return { label: 'Wi-Fi or Ethernet', usable: true }
  if (/^(utun|ipsec|ppp|tun|tap|wg)/.test(name)) return { label: 'VPN tunnel', usable: false }
  if (/^bridge/.test(name)) return { label: 'Bridge', usable: false }
  return { label: 'Other interface', usable: true }
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          window.setTimeout(() => setDone(false), 1600)
        } catch {
          // Clipboard blocked: the text is on screen to copy by hand.
        }
      }}
    >
      <Copy size={13} /> {done ? 'Copied' : 'Copy'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Integration checks

function useChecks(intervalMs = 5000) {
  const [data, setData] = useState<IntegrationChecks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  /** Background polls stay quiet; only a run the operator asked for shows as busy. */
  const run = useCallback(async (manual = false) => {
    if (manual) setBusy(true)
    try {
      const next = await api.checks()
      if (!alive.current) return
      setData(next)
      setError(null)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void run()
    const id = window.setInterval(() => void run(), intervalMs)
    return () => {
      alive.current = false
      window.clearInterval(id)
    }
  }, [run, intervalMs])
  return { data, error, busy, run }
}

function recordHref(c: IntegrationCheck): string | null {
  if (!c.recordId) return null
  if (c.recordKind === 'EVENT') return href.event(c.recordId)
  if (c.recordKind === 'SESSION') return href.session(c.recordId)
  return null
}

function CheckRow({ c, n }: { c: IntegrationCheck; n: number }) {
  const mark = STATUS_MARK[c.status]
  const link = recordHref(c)
  return (
    <li data-testid={`check-${c.id}`} data-status={c.status}>
      <span className="check-tile-mark" aria-hidden>
        {mark.icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold text-ink">
          <span className="mr-2 font-mono text-[11px] font-normal text-ink-3">{n}</span>
          {CHECK_TITLE[c.id] ?? c.label}
        </h3>
        <span className={`text-[13px] font-semibold ${c.status === 'NOT_TESTED' ? 'text-ink-3' : 'text-ink'}`} data-testid={`check-${c.id}-status`}>
          {mark.text}
        </span>
      </div>
      <div className="col-span-2 min-w-0">
        <p className="text-[12.5px] leading-relaxed text-ink-2">{c.detail}</p>
        {(c.evidence || c.at || link) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            {c.evidence && <span className="font-mono break-all">{c.evidence}</span>}
            {c.at && <span className="tnum">{utcStamp(c.at)}</span>}
            {link && (
              <a className="inline-flex items-center gap-1 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={link}>
                Open record <ArrowUpRight size={12} />
              </a>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** The path a watch reading takes, each stop coloured by the real results of its own checks. */
const FLOW: { title: string; icon: LucideIcon; checks: string[] }[] = [
  { title: 'Watch', icon: Watch, checks: ['pairing', 'watch-confirmation'] },
  { title: 'Local network', icon: Wifi, checks: ['lan-enabled', 'network-interface', 'lan-reachable'] },
  { title: 'Mission computer', icon: Cpu, checks: ['backend', 'device-ingest', 'record-persisted'] },
  { title: 'Dashboard', icon: MonitorCheck, checks: ['dashboard-display'] },
]
const FLOW_TONE: Record<CheckStatus, string> = { PASS: 'tab-tone-mint', FAIL: 'tab-tone-coral', NOT_TESTED: 'tab-tone-neutral' }

function stageStatus(checks: IntegrationCheck[]): CheckStatus {
  if (checks.some((c) => c.status === 'FAIL')) return 'FAIL'
  if (checks.length && checks.every((c) => c.status === 'PASS')) return 'PASS'
  return 'NOT_TESTED'
}

function ConnectionDiagram({ list, loading }: { list: IntegrationCheck[]; loading: boolean }) {
  const stages = FLOW.map((f) => {
    const checks = f.checks.map((id) => list.find((c) => c.id === id)).filter((c): c is IntegrationCheck => !!c)
    const status = stageStatus(checks)
    const pass = checks.filter((c) => c.status === 'PASS').length
    const fail = checks.filter((c) => c.status === 'FAIL').length
    const state = !checks.length ? 'Not tested' : status === 'PASS' ? 'All checks pass' : fail ? `${fail} of ${checks.length} failing` : pass ? `${pass} of ${checks.length} pass, the rest not tested` : 'Not tested yet'
    return { ...f, found: checks, status, state }
  })
  const linkStatus = (a: CheckStatus, b: CheckStatus): CheckStatus => (a === 'FAIL' || b === 'FAIL' ? 'FAIL' : a === 'PASS' && b === 'PASS' ? 'PASS' : 'NOT_TESTED')
  return (
    <section className="panel px-5 pt-5 pb-5" aria-labelledby="connection-path-title" data-testid="connection-path">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="connection-path-title" className="label">Connection path</h2>
        <span className="text-[12px] text-ink-3">{loading ? 'Running the checks…' : 'From the integration checks below'}</span>
      </div>
      <div className="tab-flow">
        {stages.map((st, i) => {
          const Icon = st.icon
          return (
            <div key={st.title} className="contents">
              {i > 0 && <div className={`tab-flow-link ${FLOW_TONE[linkStatus(stages[i - 1].status, st.status)].replace('neutral', 'muted')}`} aria-hidden />}
              <div className={`tab-flow-node ${FLOW_TONE[st.status]}`} role="group" aria-label={`${st.title}: ${st.state}`} data-state={st.status}>
                <header>
                  <span className="tab-flow-icon" aria-hidden>
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <h3>{st.title}</h3>
                    <div className="tab-flow-state">{st.state}</div>
                  </div>
                </header>
                <ul className="tab-flow-checks">
                  {st.checks.map((id) => {
                    const c = st.found.find((x) => x.id === id)
                    const status = c?.status ?? 'NOT_TESTED'
                    return (
                      <li key={id}>
                        <span className={`status-mark ${STATUS_MARK[status].bar}`} aria-hidden />
                        <span>
                          {CHECK_TITLE[id] ?? id}: {STATUS_MARK[status].text.toLowerCase()}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-[11.5px] text-ink-3">Green when every check at that stop passes, red when one fails, grey when not tested. A line is green only when both ends pass. Simulated data never passes a check.</p>
    </section>
  )
}

function Selftest() {
  const { workspace } = useData()
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<SelftestReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="well px-4 py-3" data-testid="selftest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[62ch]">
          <div className="text-[13px] font-semibold text-ink">Simulated self-test</div>
          <p className="mt-1 text-[12.5px] text-ink-2">Real requests to this computer's own pairing and signal endpoints with a simulated signal (stored in the demo). Not proof that a watch can connect; changes no check.</p>
        </div>
        <button
          className="btn btn-sim"
          aria-busy={busy}
          disabled={busy}
          data-testid="run-selftest"
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              setReport(await api.selftest())
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <FlaskConical size={15} /> Run self-test (simulated)
        </button>
      </div>
      {error && <p className="mt-3 text-[12px] text-ink">{error}</p>}
      {report && (
        <div className="mt-4" data-testid="selftest-report">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="violet">Simulated</Pill>
            <Pill tone={report.passed ? 'mint' : 'coral'} dot>
              {report.passed ? 'Endpoints answered' : 'A step failed'}
            </Pill>
            <span className="text-[11.5px] text-ink-3 tnum">Ran {utcStamp(report.ranAt)}</span>
          </div>
          <p className="mt-2 text-[12.5px] text-ink-2">{report.summary}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Request</th>
                  <th>HTTP</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.steps.map((s, i) => (
                  <tr key={i}>
                    <td className="text-ink">{s.step}</td>
                    <td className="code text-[11px] break-all text-ink-2">
                      {s.method} {s.url}
                    </td>
                    <td className="tnum">{s.status ?? '--'}</td>
                    <td className={s.ok ? 'text-ink' : 'text-ink'}>
                      {s.ok ? 'OK' : 'Failed'}
                      <span className="block text-[11px] text-ink-3">{s.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.demoEventId && (
            <p className="mt-2 text-[11.5px] text-ink-3">
              Simulated review event <span className="font-mono">{report.demoEventId}</span>
              {workspace === 'demo' ? (
                <>
                  {' '}
                  ·{' '}
                  <a className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" href={href.event(report.demoEventId)}>
                    open it
                  </a>
                </>
              ) : (
                ' is in the simulated demo, not in mission records.'
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function IntegrationCheckPanel({ checks, className = '' }: { checks: ReturnType<typeof useChecks>; className?: string }) {
  const { workspace, snapshot } = useData()
  const list = checks.data ? resolveChecks(checks.data.checks, workspace, snapshot?.dataset ?? null) : []
  const tally = checkTally(list)
  return (
    <Section
      index="02"
      title="Integration check"
      className={className}
      testId="integration-checks"
      aside={
        <div className="flex items-center gap-3">
          {checks.data && (
            <span className="text-[11.5px] text-ink-3 tnum" data-testid="checks-tally">
              <span className="text-ink">{tally.PASS} pass</span> · <span className={tally.FAIL ? 'text-ink' : ''}>{tally.FAIL} fail</span> · {tally.NOT_TESTED} not tested
            </span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => void checks.run(true)} aria-busy={checks.busy} disabled={checks.busy}>
            <RefreshCw size={13} /> Re-run
          </button>
        </div>
      }
    >
      <p className="max-w-[78ch] text-[12.5px] text-ink-2">In the order a connection is built. Simulated and demo data never pass a check; no check identifies watch hardware.</p>
      {!checks.data && !checks.error && <p className="mt-4 text-[12.5px] text-ink-3">Running the checks…</p>}
      {checks.error && !checks.data && <p className="mt-4 text-[12.5px] text-ink">Checks unavailable: {checks.error}</p>}
      {checks.error && checks.data && (
        <p className="mt-4 text-[12px] text-ink" role="status">
          The last check failed ({checks.error}). Showing the result from {utcTime(checks.data.generatedAt)}.
        </p>
      )}
      {checks.data && (
        <>
          <div className="mt-4 flex items-center gap-1.5" role="img" aria-label={`${tally.PASS} of ${list.length} checks pass, ${tally.FAIL} fail, ${tally.NOT_TESTED} not tested`}>
            {list.map((c) => (
              <span key={c.id} className={`h-2.5 flex-1 rounded-[4px] ${STATUS_MARK[c.status].bar}`} title={`${CHECK_TITLE[c.id] ?? c.label}: ${STATUS_MARK[c.status].text}`} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 gap-y-0.5 text-[10.5px] text-ink-3 tnum">
            <span>Checked {utcTime(checks.data.generatedAt)} · every 5 s while this page is open</span>
            <span>{workspace === 'demo' ? 'Mission records only' : 'Mission records'}</span>
          </div>
          <ol className="check-tiles mt-5">
            {list.map((c, i) => (
              <CheckRow key={c.id} c={c} n={i + 1} />
            ))}
          </ol>
        </>
      )}
      <div className="mt-5">
        <Selftest />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 01 Watch connection

function realLinkSummary(checks: IntegrationChecks | null, missionDevices: DeviceRecord[] | null, links: Record<string, string>, nowMs: number): { label: string; tone: Tone; detail: string } {
  const verified = (missionDevices ?? []).filter((d) => links[d.deviceId] === 'VERIFIED')
  if (verified.length) {
    const d = verified[0]
    return { label: 'Link verified', tone: 'mint', detail: `Authenticated contact ${ago(d.lastSeenAt, nowMs)} from ${d.deviceModel ?? d.deviceId}. That proves the app is talking to this computer, not which hardware it runs on.` }
  }
  if (checks?.watch.paired) {
    const seen = checks.watch.lastSeenAt
    return seen
      ? { label: 'Watch unreachable', tone: 'amber', detail: `Paired, but no contact for ${ago(seen, nowMs).replace(' ago', '')}. The watch app checks in while it is open.` }
      : { label: 'Paired · no contact yet', tone: 'amber', detail: 'A watch app holds this computer’s pairing but has not checked in yet.' }
  }
  const known = [...(missionDevices ?? [])].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0]
  if (known) return { label: 'Watch unreachable', tone: 'amber', detail: `Last authenticated contact ${utcStamp(known.lastSeenAt)} (${ago(known.lastSeenAt, nowMs)}).` }
  return { label: 'No watch paired', tone: 'muted', detail: 'No watch app has paired with this computer. Nothing on this dashboard comes from a live watch.' }
}

function Step({ n, title, done, children }: { n: number; title: ReactNode; done: boolean; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3">
      <span className={`mt-px grid h-6 w-6 place-items-center rounded-[6px] border font-mono text-[12px] tnum ${done ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-2'}`}>{done ? <Check size={14} /> : n}</span>
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{title}</div>
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </li>
  )
}

function WatchConnection({ checks, className = '' }: { checks: IntegrationChecks | null; className?: string }) {
  const { snapshot, workspace } = useData()
  const now = useNow(1000)
  const devices = snapshot ? Object.values(snapshot.dataset.devices) : []
  const summary = realLinkSummary(checks, workspace === 'mission' ? devices : null, snapshot?.links ?? {}, now)
  const lanOn = checks?.lan.enabled ?? false
  const port = checks?.lan.port ?? null
  const addresses = (checks?.lan.addresses ?? []).map((a) => ({ ...a, kind: interfaceKind(a.interface) })).sort((a, b) => Number(b.kind.usable) - Number(a.kind.usable))
  const paired = checks?.checks.find((c) => c.id === 'pairing')?.status === 'PASS'
  const tone = { mint: 'text-ink', amber: 'text-ink', coral: 'text-ink', muted: 'text-ink-2' } as Record<string, string>
  return (
    <Section index="01" title="Watch connection" className={className} testId="watch-connection" aside={<Pill tone={summary.tone} dot>{summary.label}</Pill>}>
      <div className="well px-3.5 py-3">
        <div className={`text-[16px] font-semibold ${tone[summary.tone] ?? 'text-ink'}`} data-testid="link-summary">
          {summary.label}
        </div>
        <p className="mt-0.5 text-[12.5px] text-ink-2">{summary.detail}</p>
        {workspace === 'demo' && <p className="mt-2 text-[11.5px] text-ink">You are viewing the simulated demo. This is the real connection state; the demo’s own devices are simulated and listed below.</p>}
      </div>

      <h3 className="mt-4 mb-2.5 text-[12px] font-semibold text-ink-2">Watch integration · connect a watch</h3>
      <ol className="flex flex-col gap-3.5">
        <Step n={1} title="Listen on the local network" done={lanOn}>
          {lanOn ? (
            <span className="text-[12px] text-ink-3">Listening on {checks?.lan.bind}:{port}.</span>
          ) : (
            <span className="text-[12px] text-ink-2">
              Stop the server and start it with <Code>GG_LAN=1 npm start</Code>. Until then only this computer can connect.
            </span>
          )}
        </Step>
        <Step
          n={2}
          title={
            <>
              On the watch, tap <b className="font-semibold">Set console address</b> and enter
            </>
          }
          done={paired}
        >
          {addresses.length && port !== null ? (
            <ul className="flex flex-col gap-1.5">
              {addresses.map((a) => (
                <li key={a.address} className="flex flex-wrap items-center gap-2">
                  <code className={`code rounded-[3px] border px-2 py-1 text-[12px] ${a.kind.usable ? 'border-line text-ink' : 'border-hair text-ink-3'}`}>{a.url}</code>
                  <span className="text-[11px] text-ink-3">
                    {a.interface} · {a.kind.label}
                    {!a.kind.usable && ': use the Wi-Fi address on the watch'}
                  </span>
                  {a.kind.usable && <CopyText text={a.url} label={`address ${a.url}`} />}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[12px] text-ink-3">No local-network address found. Join the same Wi-Fi network as the watch.</span>
          )}
          {!lanOn && addresses.length > 0 && <p className="mt-1.5 text-[11.5px] text-ink-3">These addresses answer only after step 1.</p>}
        </Step>
        <Step
          n={3}
          title={
            <>
              Tap <b className="font-semibold">Get pairing code</b> on the watch
            </>
          }
          done={paired}
        />
        <Step n={4} title="Enter the code here" done={paired}>
          <WatchPairing workspace={workspace} />
        </Step>
      </ol>

      <h3 className="mt-5 mb-2 text-[12px] font-semibold text-ink-2">{workspace === 'demo' ? 'Devices in the simulated demo' : 'Devices in mission records'}</h3>
      {devices.length ? (
        <ul className="flex flex-col divide-y divide-hair">
          {devices.map((d) => {
            const meta = LINK_META[snapshot?.links[d.deviceId] ?? 'NOT_PAIRED']
            return (
              <li key={d.deviceId} className="py-2.5 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11.5px] text-ink">{d.deviceId}</span>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </div>
                <div className="mt-1 text-[11.5px] text-ink-3">
                  {d.subjectId ? subjectLabel(d.subjectId) : 'No crew member'} · {d.deviceModel ?? 'model not reported'} · last contact {utcStamp(d.lastSeenAt)} ({ago(d.lastSeenAt, now)})
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-3">None yet. A watch appears here after its first authenticated contact.</p>
      )}
      <div className="min-h-6 flex-1" aria-hidden />
      <p className="border-t border-hair pt-3 text-[11.5px] text-ink-3">Verified = authenticated contact from a paired watch app in the last 60 s. It can be the Xcode simulator, so it never means hardware.</p>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 03 Onboard computer, 04 Data integrity, 05 Offline operation

function OnboardComputer({ className = '' }: { className?: string }) {
  const { health, latencyMs, skewMs, error } = useData()
  const skew = skewMs === null ? null : Math.round(skewMs / 1000)
  return (
    <Section index="03" title="Onboard computer" className={className} aside={<Pill tone={error ? 'coral' : health ? 'mint' : 'neutral'} dot>{error ? 'API down' : health ? 'Online' : 'Connecting'}</Pill>}>
      {health ? (
        <dl>
          <Row k="Service">{health.service}</Row>
          <Row k="Version">
            {health.version} · contract {health.contractVersion}
          </Row>
          <Row k="Up for">{ago(new Date(Date.now() - health.uptimeSeconds * 1000).toISOString(), Date.now()).replace(' ago', '')}</Row>
          <Row k="Round trip">{latencyMs ?? '--'} ms</Row>
          <Row k="Clock vs browser">{skew === null ? '--' : skew === 0 ? 'In step' : `${skew > 0 ? '+' : ''}${skew} s`}</Row>
          <Row k="Network">{health.network.lan ? `Local network (${health.network.bind})` : 'This computer only (127.0.0.1)'}</Row>
          <Row k="Storage">{health.storage.writable ? 'Writable' : <span className="text-ink">NOT WRITABLE</span>}</Row>
          <Row k="Data directory" mono>
            {health.storage.dataDir}
          </Row>
        </dl>
      ) : (
        <p className="text-[12.5px] text-ink-2">{error ? 'The local API is not reachable. Start it with npm start.' : 'Connecting…'}</p>
      )}
    </Section>
  )
}

const PATH_LABEL: Record<IngestPathT | 'COMPUTER', string> = {
  LIVE_SYNC: 'Live sync from a device',
  SAVED_DEVICE_FILE: 'Saved device file',
  FILE_IMPORT: 'File import',
  MANUAL_ENTRY: 'Typed in on this computer',
  DEMO_FIXTURE: 'Simulated fixture',
  DEMO_TRIGGER: 'Simulated trigger',
  COMPUTER: 'Created by this computer',
}

const QUALITY: { key: 'VALID' | 'QUESTIONABLE' | 'INVALID' | 'MISSING'; label: string; bar: string; text: string }[] = [
  { key: 'VALID', label: 'Valid', bar: 'bg-mint', text: 'text-ink' },
  { key: 'QUESTIONABLE', label: 'Questionable', bar: 'bg-amber', text: 'text-ink' },
  { key: 'INVALID', label: 'Invalid', bar: 'bg-coral', text: 'text-ink' },
  { key: 'MISSING', label: 'No value', bar: 'bg-ink-3', text: 'text-ink-3' },
]

function integrity(ds: Dataset) {
  const records = [...Object.values(ds.sessions), ...Object.values(ds.events), ...Object.values(ds.readings)]
  const misplaced = records.filter((r) => r.isSimulated !== (ds.workspace === 'demo')).length
  const paths = new Map<IngestPathT | 'COMPUTER', number>()
  for (const r of records) {
    const k = r.provenance.ingestPath ?? 'COMPUTER'
    paths.set(k, (paths.get(k) ?? 0) + 1)
  }
  const quality = { VALID: 0, QUESTIONABLE: 0, INVALID: 0, MISSING: 0 }
  for (const s of Object.values(ds.sessions)) for (const m of s.measurements) quality[m.quality] += 1
  for (const m of Object.values(ds.readings)) quality[m.quality] += 1
  const outcomes = { CREATED: 0, UPDATED: 0, DUPLICATE: 0, STALE_IGNORED: 0, CONFLICT: 0, REJECTED: 0 } as Record<string, number>
  for (const e of ds.log) if (e.outcome in outcomes) outcomes[e.outcome] += 1
  return { records: records.length, misplaced, paths: [...paths.entries()].sort((a, b) => b[1] - a[1]), quality, outcomes }
}

function DataIntegrity({ className = '' }: { className?: string }) {
  const { snapshot, workspace, health } = useData()
  if (!snapshot) return <Section index="04" title="Data integrity" className={className}><p className="text-[12.5px] text-ink-3">Loading…</p></Section>
  const r = integrity(snapshot.dataset)
  const totalQ = Object.values(r.quality).reduce((a, b) => a + b, 0)
  return (
    <Section
      index="04"
      title="Data integrity"
      className={className}
      testId="data-integrity"
      aside={<span className="text-[11.5px] text-ink-3">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'}</span>}
    >
      <div className="flex items-start gap-3">
        <span className={r.misplaced ? 'text-ink' : r.records ? 'text-ink' : 'text-ink-3'}>{r.misplaced ? <SquareX size={18} /> : r.records ? <SquareCheck size={18} /> : <SquareDashed size={18} />}</span>
        <div>
          <div className="text-[13.5px] font-semibold text-ink" data-testid="separation">
            {r.misplaced
              ? `${plural(r.misplaced, 'record')} in the wrong workspace`
              : r.records
                ? `All ${plural(r.records, 'record')} ${workspace === 'demo' ? 'are simulated' : 'are real'}`
                : `No ${workspace === 'demo' ? 'simulated' : 'mission'} records yet`}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">Real and simulated records are stored apart.</p>
        </div>
      </div>

      <h3 className="mt-4 mb-1.5 text-[12px] font-semibold text-ink-2">Readings by quality</h3>
      {totalQ ? (
        <>
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-[2px]" role="img" aria-label={QUALITY.map((q) => `${r.quality[q.key]} ${q.label.toLowerCase()}`).join(', ')}>
            {QUALITY.filter((q) => r.quality[q.key]).map((q) => (
              <span key={q.key} className={q.bar} style={{ flexGrow: r.quality[q.key] }} />
            ))}
          </div>
          <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {QUALITY.map((q) => (
              <div key={q.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                <dt className="flex items-center gap-1.5 text-ink-2">
                  <span className={`status-mark ${q.bar}`} aria-hidden />
                  {q.label}
                </dt>
                <dd className="text-ink tnum">{r.quality[q.key]}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-[12px] text-ink-3">No readings yet.</p>
      )}

      <h3 className="mt-4 mb-1.5 text-[12px] font-semibold text-ink-2">How records arrived</h3>
      {r.paths.length ? (
        <dl>
          {r.paths.map(([k, n]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-t border-hair py-1.5 text-[12px] first:border-t-0">
              <dt className="text-ink-2">{PATH_LABEL[k]}</dt>
              <dd className="text-ink tnum">{n}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[12px] text-ink-3">Nothing stored yet.</p>
      )}

      <h3 className="mt-4 mb-1.5 text-[12px] font-semibold text-ink-2">Ingest decisions</h3>
      <p className="text-[12px] leading-relaxed text-ink-2">
        {r.outcomes.CREATED} created · {r.outcomes.UPDATED} updated · {r.outcomes.DUPLICATE} repeats ignored · {r.outcomes.STALE_IGNORED} older copies ignored · {r.outcomes.CONFLICT} conflicts kept for review · {r.outcomes.REJECTED} rejected
      </p>
      {health && !health.storage.writable && <p className="mt-3 text-[12px] text-ink">Storage is not writable: new records cannot be saved.</p>}
    </Section>
  )
}

function OfflineOperation({ className = '' }: { className?: string }) {
  const online = useNavigatorOnline()
  const external = useExternalRequests()
  return (
    <Section
      index="05"
      title="Offline operation"
      className={className}
      aside={
        <Pill tone={external.count ? 'amber' : 'mint'} dot>
          {external.count ? `${external.count} external` : '0 external requests'}
        </Pill>
      }
    >
      <div className="flex items-baseline gap-3" data-testid="offline-panel">
        <span className="figure text-[32px] text-ink" data-testid="external-count">
          {external.count}
        </span>
        <span className="text-[12.5px] leading-snug text-ink-2">
          requests to other machines since this page opened
          {external.origins.length ? ` (${external.origins.join(', ')})` : ''}
        </span>
      </div>
      <dl className="mt-4">
        <Row k="Browser network">{online ? 'Attached' : 'Disconnected'}</Row>
        <Row k="Fonts, icons, figure">Bundled with the app</Row>
        <Row k="Analysis and review">Run on this computer</Row>
        <Row k="Watch link">Local network only</Row>
      </dl>
      <p className="mt-3 text-[11.5px] text-ink-3">Counts every file and request this page loaded. To prove it, turn Wi-Fi off and keep working.</p>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 06 Integration tools

const OUTCOME_TONE: Record<IngestResult['outcome'], Tone> = {
  CREATED: 'mint',
  UPDATED: 'cyan',
  DUPLICATE: 'muted',
  STALE_IGNORED: 'muted',
  CONFLICT: 'amber',
  REJECTED: 'coral',
}

function Tool({ title, children, aside, className = '' }: { title: string; children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  )
}

function ConnectionSettings() {
  const [info, setInfo] = useState<Integration | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api.integration().then(setInfo, (e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])
  return (
    <Tool title="Connection settings">
      {err && <p className="text-[12.5px] text-ink">{err}</p>}
      {!info && !err && <p className="text-[12.5px] text-ink-3">Loading…</p>}
      {info && (
        <div className="flex flex-col gap-4">
          <dl>
            <Row k="Network mode">{info.lan ? 'Local network (watch can connect)' : 'This computer only'}</Row>
            <Row k="Port">{info.port}</Row>
            <Row k="Addresses" mono>
              {info.urls.join('\n')}
            </Row>
          </dl>
          <div>
            <div className="micro mb-2">Device API token (v1)</div>
            <Secret value={info.token} label="Device API token" testId="token" />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
              For a watch app using the v1 device API (<Code>Authorization: Bearer</Code>). The code-paired watch app does not need it. Stored in <Code>{info.tokenFile}</Code>; treat it like a password.
            </p>
          </div>
          <details>
            <summary className="cursor-pointer text-[12.5px] text-ink-2 hover:text-ink">Endpoints ({info.endpoints.length})</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="data-table">
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
                      <td className="code text-[11px]">{e.method}</td>
                      <td className="code text-[11px]">{e.path}</td>
                      <td className="text-ink-2">{e.actor}</td>
                      <td className="text-ink-3">{e.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </Tool>
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
    <Tool title="Import saved records">
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
        className={`flex flex-col items-start gap-3 rounded-[4px] border border-dashed px-4 py-4 transition-colors ${drag ? 'border-cyan bg-cyan/[0.06]' : 'border-line'}`}
      >
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Drop a watch export (<Code>gravityguard.export-bundle.v1</Code>, a session, an event, or a list of them). A file from the watch app is labelled <b className="font-semibold text-ink">SAVED DEVICE DATA</b>, never live. Each record goes to the workspace its <Code>isSimulated</Code> flag names.
        </p>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} data-testid="import-input" />
        <button className="btn btn-ghost btn-sm" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
          <FileUp size={14} /> {busy ? 'Importing' : 'Choose JSON file'}
        </button>
      </div>
      {result && (
        <div className="mt-4" data-testid="import-result">
          <div className="text-[12.5px] text-ink">
            {result.file}
            {result.error && <span className="ml-2 text-ink">{result.error}</span>}
          </div>
          {result.results.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="data-table">
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
                      <td className="font-mono text-[11px]">{r.id ?? '--'}</td>
                      <td className="text-ink-2">{r.kind?.toLowerCase() ?? '--'}</td>
                      <td className="text-ink-2">{r.workspace === 'demo' ? 'Simulated demo' : r.workspace === 'mission' ? 'Mission records' : '--'}</td>
                      <td>
                        <Pill tone={OUTCOME_TONE[r.outcome]}>{r.outcome.replace('_', ' ')}</Pill>
                      </td>
                      <td className="text-[11.5px] text-ink-3">{r.detail ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Tool>
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
    <Tool title="Enter an external reading">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        A reading from another instrument, such as a cuff. It is stored and shown as <b className="font-semibold text-ink">MANUALLY ENTERED</b> from that instrument, never as a watch measurement.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          <input className="field tnum" inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Diastolic (mmHg)</span>
          <input className="field tnum" inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Measured at (UTC)</span>
          <input type="datetime-local" step="1" className="field" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Instrument</span>
          <input className="field" value={device} onChange={(e) => setDevice(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="micro">Instrument quality flag</span>
          <select className="field" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
            <option value="VALID">Valid</option>
            <option value="QUESTIONABLE">Questionable</option>
            <option value="INVALID">Invalid</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost btn-sm" disabled={!subject || !at || (!sys && !dia)} onClick={submit}>
          Store reading
        </button>
        {msg && <span className={`text-[12px] ${msg.tone === 'coral' ? 'text-ink' : 'text-ink'}`}>{msg.text}</span>}
      </div>
    </Tool>
  )
}

function DemoTools() {
  const { workspace, actions } = useData()
  const [resetting, setResetting] = useState(false)
  return (
    <Tool title="Simulated demo" aside={<Pill tone="violet">Demo workspace only</Pill>}>
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        These controls only write simulated records to the demo workspace; mission records are never touched. Fixtures keep their original dates. A triggered event is stamped with the moment you press the button.
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-3">
        {workspace === 'demo' ? <TriggerButton /> : <span className="text-[12px] text-ink-3">Open the simulated demo (status bar above) to trigger a simulated watch event.</span>}
        <button
          className="btn btn-ghost btn-sm"
          disabled={resetting}
          aria-busy={resetting}
          onClick={async () => {
            setResetting(true)
            try {
              await actions.demoReset()
            } finally {
              setResetting(false)
            }
          }}
        >
          <RotateCcw size={14} /> Reset simulated scenarios
        </button>
      </div>
    </Tool>
  )
}

// ---------------------------------------------------------------------------

export function SystemStatus() {
  const { health, watchLinks, snapshot } = useData()
  if (health?.network.bind === 'HTTPS') {
    const device = watchSignIn()?.deviceId
    const link = watchLinks?.find((watch) => watch.deviceId === device)
    const connection = device ? snapshot?.links[device] : undefined
    return (
      <div className="tab-page">
        <div className="mission-horizon" aria-hidden="true" />
        <header className="mission-intro">
          <h1 className="display faded-label">Hosted console</h1>
          <p>{health.storage.writable ? 'HTTPS online' : 'Watch pairing needs the Supabase server key'}</p>
        </header>
        <section className="panel mx-auto grid w-full max-w-2xl gap-3 p-6">
          <p className="text-[17px] font-semibold">{connection === 'VERIFIED' ? 'Watch connected' : link ? 'Paired. Waiting for the watch.' : 'No watch paired in this browser.'}</p>
          <p className="text-sm text-ink-2">Use this address in the watch app:</p>
          <code className="well break-all px-3 py-2">{location.origin}</code>
          <a className="underline" href={href.pair}>Pair or sync a watch</a>
        </section>
      </div>
    )
  }
  return <LocalSystemStatus />
}

function LocalSystemStatus() {
  const { workspace, health, error, snapshot } = useData()
  const checks = useChecks()
  const list = checks.data?.checks ?? []
  const tally = checkTally(list)
  const resolved = checks.data ? resolveChecks(checks.data.checks, workspace, snapshot?.dataset ?? null) : []
  const signedIn = workspace === 'mission' ? watchSignIn() : null
  const summary = checks.data ? `${tally.PASS} of ${list.length} pass` : '--'
  return (
    <div className="tab-page">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Mission computer</h1>
        <p>
          {signedIn && <span className="faded-label">Signed in as {signedIn.name}</span>}
          <span>System status</span>
          <span>{workspace === 'demo' ? 'Simulated demo' : 'Mission records'}</span>
          <span>What is proven about the watch link</span>
        </p>
      </header>
      <dl className="tab-stats">
        <div className="tab-card tab-stat">
          <dt className="tab-stat-label">Computer</dt>
          <dd className="tab-stat-value">{error ? 'API down' : health ? 'Online' : 'Connecting'}</dd>
        </div>
        <div className="tab-card tab-stat">
          <dt className="tab-stat-label">Watch pairing</dt>
          <dd className="tab-stat-value">{checks.data ? (checks.data.watch.paired ? 'Paired' : 'Not paired') : '--'}</dd>
        </div>
        <div className="tab-card tab-stat">
          <dt className="tab-stat-label">Integration</dt>
          <dd className="tab-stat-value">{summary}</dd>
        </div>
      </dl>

      <ConnectionDiagram list={resolved} loading={!checks.data && !checks.error} />
      <WatchConnection checks={checks.data} />
      <IntegrationCheckPanel checks={checks} />
      <Disclosure title="Computer, data and offline operation">
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <OnboardComputer />
          <DataIntegrity />
          <OfflineOperation />
        </div>
      </Disclosure>
      <Disclosure title="Integration tools">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2" data-testid="integration-tools">
          <ConnectionSettings />
          <ImportPanel />
          <ManualReading />
          <DemoTools />
        </div>
      </Disclosure>
    </div>
  )
}
