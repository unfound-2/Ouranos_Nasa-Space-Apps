import { Activity, CloudOff, Cpu, FlaskConical, RadioTower, ShieldAlert, Watch } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { subjectDevice } from '../../shared/dataset'
import { ago, utcStamp } from '../../shared/format'
import { useData, useExternalRequests, useNavigatorOnline, useNow } from '../lib/data'
import { href, type Route } from '../lib/router'
import { bannerSourceMode, defaultSubject, LINK_META, SOURCE_META, subjectsOf } from '../lib/view'
import { TONE } from './ui'

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="var(--color-raised)" stroke="var(--color-line)" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--color-cyan)" strokeWidth="1.6" opacity="0.9" />
      <path d="M7.5 17h3.6l2-4.6 3 8.6 2.1-6h6.3" fill="none" stroke="var(--color-mint)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV: { key: Route['name'][]; label: string; to: string }[] = [
  { key: ['overview', 'event'], label: 'Overview', to: href.overview },
  { key: ['crew', 'session'], label: 'Crew Health', to: href.crew },
  { key: ['events'], label: 'Event History', to: href.events },
  { key: ['system'], label: 'System Status', to: href.system },
]

function Readout({ icon, label, value, tone = 'neutral', title }: { icon: ReactNode; label: string; value: ReactNode; tone?: keyof typeof TONE; title?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5" title={title}>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${TONE[tone].border} ${TONE[tone].bg} ${TONE[tone].text}`}>{icon}</span>
      <div className="min-w-0 leading-tight">
        <div className="micro">{label}</div>
        <div className={`mt-0.5 truncate text-[12px] font-bold ${tone === 'neutral' ? 'text-ink' : TONE[tone].text}`}>{value}</div>
      </div>
    </div>
  )
}

export function TopBar({ route }: { route: Route }) {
  const { snapshot, error, workspace, subjectId, setSubjectId, latencyMs } = useData()
  const online = useNavigatorOnline()
  const external = useExternalRequests()
  const ds = snapshot?.dataset ?? null
  const subjects = ds ? subjectsOf(ds) : []

  useEffect(() => {
    if (!ds) return
    if (!subjectId || !subjects.some((s) => s.id === subjectId)) {
      const d = defaultSubject(ds)
      if (d !== subjectId) setSubjectId(d)
    }
  }, [ds, subjectId, subjects, setSubjectId])

  return (
    <div className="border-b border-line bg-void/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <a href={href.overview} className="flex items-center gap-3" aria-label="GRAVITYGUARD overview">
          <LogoMark />
          <div className="leading-tight">
            <div className="font-display text-[14px] tracking-[0.12em] text-ink">GRAVITYGUARD</div>
            <div className="micro mt-0.5">Mission health system</div>
            <div className="micro mt-0.5 text-cyan/80" title="The active mission profile: the protocol this dashboard is configured for">
              Profile · gravity recovery
            </div>
          </div>
        </a>

        <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto min-[1360px]:order-none min-[1360px]:w-auto min-[1360px]:flex-1 min-[1360px]:justify-center">
          {NAV.map((n) => {
            const active = n.key.includes(route.name)
            return (
              <a
                key={n.label}
                href={n.to}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-lg px-2.5 py-2 text-[11.5px] font-bold whitespace-nowrap uppercase tracking-[0.12em] transition-colors ${
                  active ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {n.label}
                <span className={`absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full ${active ? 'bg-cyan' : 'bg-transparent'}`} aria-hidden />
              </a>
            )
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2.5">
            <span className="micro hidden min-[1600px]:inline">Astronaut</span>
            <select
              className="field h-8 max-w-[200px] py-0 text-[12px] font-bold"
              value={subjectId ?? ''}
              onChange={(e) => setSubjectId(e.target.value || null)}
              disabled={!subjects.length}
              aria-label="Selected astronaut"
            >
              {!subjects.length && <option value="">No crew records</option>}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {workspace === 'demo' ? ' (sim)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Readout
            icon={<Cpu size={15} />}
            label="Local computer"
            value={error ? 'API down' : snapshot ? `Online · ${latencyMs ?? '--'} ms` : 'Connecting'}
            tone={error ? 'coral' : snapshot ? 'mint' : 'neutral'}
            title="The mission-computer API on this machine"
          />
          <Readout
            icon={<CloudOff size={15} />}
            label={online ? 'Internet' : 'Network'}
            value={external.count > 0 ? `${external.count} external requests` : online ? 'Not used · 0 requests' : 'Offline · running locally'}
            tone={external.count > 0 ? 'amber' : 'mint'}
            title={`Requests this page made to other machines: ${external.count}${external.origins.length ? ` (${external.origins.join(', ')})` : ''}. The browser reports the network as ${online ? 'attached' : 'disconnected'}; that flag does not test internet access.`}
          />
        </div>
      </div>
    </div>
  )
}

/** The persistent data-source banner. It is part of the sticky header on every page. */
function LinkReadouts() {
  const { snapshot, subjectId } = useData()
  const now = useNow(5000)
  const ds = snapshot?.dataset ?? null
  const device = ds && subjectId ? subjectDevice(ds, subjectId) : null
  const link = device ? (snapshot?.links[device.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const meta = LINK_META[link]
  const lastSync = device?.lastSyncAt ?? null
  return (
    <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1" data-testid="link-readouts">
      <span className="flex items-center gap-2" title={meta.hint}>
        <Watch size={14} className={TONE[meta.tone].text} />
        <span className="micro">Watch</span>
        <span className={`text-[12px] font-bold ${TONE[meta.tone].text}`} data-testid="watch-state">
          {meta.label}
        </span>
      </span>
      <span
        className="flex items-center gap-2"
        title={lastSync ? `Last record received over live sync: ${utcStamp(lastSync)} (${ago(lastSync, now)})` : 'No record has arrived over live sync'}
      >
        <RadioTower size={14} className="text-ink-3" />
        <span className="micro">Last sync</span>
        <span className="text-[12px] font-bold text-ink tnum">{lastSync ? utcStamp(lastSync).slice(5) : '--'}</span>
      </span>
    </div>
  )
}

export function SourceBanner() {
  const { snapshot, error, workspace, setWorkspace, subjectId, refresh } = useData()
  if (error) {
    return (
      <div role="status" className="border-b border-coral/40 bg-coral/12">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
          <ShieldAlert size={15} className="text-coral" />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-coral">Local API unavailable</span>
          <span className="text-[12.5px] text-ink-2">No data is shown. Nothing is substituted. Start the mission computer with npm start, then retry.</span>
          <button className="btn btn-ghost ml-auto h-7" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    )
  }
  if (workspace === 'demo') {
    return (
      <div role="status" data-testid="source-banner" className="sim-hatch border-b border-violet/45 bg-violet/10">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
          <FlaskConical size={15} className="text-violet" />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-violet">Simulated demo</span>
          <span className="text-[12.5px] text-ink">{SOURCE_META['SIMULATED DEMO'].hint}</span>
          <LinkReadouts />
          <button className="btn btn-ghost h-7 bg-void/40" onClick={() => setWorkspace('mission')}>
            Switch to mission records
          </button>
        </div>
      </div>
    )
  }
  const mode = snapshot ? bannerSourceMode(snapshot.dataset, snapshot.links, subjectId) : null
  const meta = mode ? SOURCE_META[mode] : null
  return (
    <div role="status" data-testid="source-banner" className={`border-b ${meta ? `${TONE[meta.tone].border} ${TONE[meta.tone].bg}` : 'border-line bg-panel'}`}>
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-6">
        <Activity size={15} className={meta ? TONE[meta.tone].text : 'text-ink-3'} />
        <span className="micro">Data source</span>
        <span className={`text-[11.5px] font-bold uppercase tracking-[0.16em] ${meta ? TONE[meta.tone].text : 'text-ink-3'}`}>{mode ?? 'Connecting'}</span>
        {meta && <span className="text-[12.5px] text-ink-2">{meta.hint}</span>}
        <LinkReadouts />
        <button className="btn btn-sim h-7" onClick={() => setWorkspace('demo')}>
          Open simulated demo
        </button>
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1480px] px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hair pt-5 text-[12px] text-ink-3">
        <span>GRAVITYGUARD organises recorded evidence for human review. It does not diagnose, predict fainting, measure blood pressure on the wrist, or clear anyone for duty.</span>
        <span className="font-mono">Contract v1 · all times UTC · runs offline</span>
      </div>
    </footer>
  )
}
