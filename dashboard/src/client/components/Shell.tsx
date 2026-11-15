import { ChevronDown, Cpu, FlaskConical, Network, RadioTower, ShieldAlert, Watch } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { subjectDevice, type SourceMode } from '../../shared/dataset'
import { ago, utcStamp } from '../../shared/format'
import { useData, useExternalRequests, useNavigatorOnline, useNow } from '../lib/data'
import { href, type Route } from '../lib/router'
import { DEMO_SCENARIOS, scenarioById } from '../lib/scenarios'
import { bannerSourceMode, defaultSubject, LINK_META, SOURCE_META, subjectsOf, type Tone } from '../lib/view'
import { TONE } from './ui'

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="6" fill="var(--color-raised)" stroke="var(--color-line)" />
      <path d="M6 17h5l2-5 3.5 9 2.5-6.5 1.5 2.5H26" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV: { key: Route['name'][]; label: string; to: string }[] = [
  { key: ['overview'], label: 'Mission Overview', to: href.overview },
  { key: ['crew', 'session'], label: 'Crew Health', to: href.crew },
  { key: ['events', 'event'], label: 'Event History', to: href.events },
  { key: ['system'], label: 'System Status', to: href.system },
]

export function CommandBar({ route }: { route: Route }) {
  const { snapshot, workspace, subjectId, setSubjectId, setScenarioId } = useData()
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
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 sm:px-6 lg:h-12 lg:flex-nowrap lg:py-0">
        <a href={href.overview} className="flex shrink-0 items-center gap-2.5" aria-label="GRAVITYGUARD mission overview">
          <LogoMark />
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-[0.06em] text-ink">GRAVITYGUARD</div>
            <div className="text-[11px] text-ink-3">Autonomous crew health system</div>
          </div>
        </a>

        <nav aria-label="Main" className="order-3 -mx-1 flex w-full overflow-x-auto lg:order-none lg:mx-0 lg:h-12 lg:w-auto lg:flex-1">
          {NAV.map((n) => {
            const active = n.key.includes(route.name)
            return (
              <a
                key={n.label}
                href={n.to}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-10 items-center px-3 text-[13px] font-medium whitespace-nowrap transition-colors lg:h-12 ${
                  active ? 'text-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {n.label}
                {active && <span className="absolute inset-x-3 bottom-0 h-[2px] bg-cyan" aria-hidden />}
              </a>
            )
          })}
        </nav>

        <label className="ml-auto flex shrink-0 items-center gap-3">
          <span className="micro hidden xl:inline">Active crew</span>
          <span className="relative">
            <select
              className="field h-8 min-h-8 appearance-none pr-8 text-[12.5px] font-medium"
              value={subjectId ?? ''}
              onChange={(e) => {
                setScenarioId(null)
                setSubjectId(e.target.value || null)
              }}
              disabled={!subjects.length}
              aria-label="Active crew member"
            >
              {!subjects.length && <option value="">No crew records</option>}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {workspace === 'demo' ? ' · simulated' : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-3" aria-hidden />
          </span>
        </label>
      </div>
    </div>
  )
}

/** A compact readout. It re-plays a one-off flash only when its value actually changes. */
function RailReadout({ icon, label, value, tone, title, testId }: { icon: ReactNode; label: string; value: string; tone: Tone; title: string; testId?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <span className="text-ink-3">{icon}</span>
      <span className="sr-only">{label}</span>
      <span key={value} className={`state-flash rounded-[3px] px-1 text-[12px] font-medium tnum ${tone === 'neutral' ? 'text-ink' : TONE[tone].text}`} data-testid={testId}>
        {value}
      </span>
    </span>
  )
}

const MODE_DOT: Record<SourceMode, string> = {
  'LIVE DEVICE': 'bg-mint',
  'SAVED DEVICE DATA': 'bg-cyan',
  'MANUALLY ENTERED': 'bg-cyan',
  IMPORTED: 'bg-cyan',
  'SIMULATED DEMO': 'bg-violet',
  UNAVAILABLE: 'bg-ink-3',
}

function ScenarioPicker() {
  const { scenarioId, setScenarioId, setSubjectId, snapshot } = useData()
  const current = scenarioById(scenarioId)
  return (
    <label className="relative flex items-center gap-2">
      <span className="sr-only">Scenario</span>
      <span className="relative">
        <select
          className="field h-7 min-h-7 appearance-none border-violet/50 bg-void pr-8 text-[12px] font-medium"
          value={current?.id ?? ''}
          aria-label="Simulated scenario"
          data-testid="scenario-picker"
          onChange={(e) => {
            const s = scenarioById(e.target.value)
            setScenarioId(s?.id ?? null)
            if (s && snapshot?.dataset.sessions[s.sessionId]) setSubjectId(s.subjectId)
          }}
        >
          <option value="">Latest activity</option>
          {DEMO_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} · {s.title}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-violet" aria-hidden />
      </span>
    </label>
  )
}

/** The persistent data-source rail. It is part of the sticky header on every page. */
export function StatusRail() {
  const { snapshot, error, workspace, setWorkspace, subjectId, refresh, latencyMs, setScenarioId } = useData()
  const now = useNow(5000)
  const online = useNavigatorOnline()
  const external = useExternalRequests()

  if (error) {
    return (
      <div role="status" data-testid="source-banner" className="border-b border-coral bg-[#3a1219]">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-3 px-4 py-2 sm:px-6">
          <ShieldAlert size={15} className="text-coral" />
          <span className="text-[12.5px] font-bold text-coral uppercase">Local API unavailable</span>
          <span className="text-[12.5px] text-ink-2">No data is shown and nothing is substituted. Start the mission computer with npm start, then retry.</span>
          <button className="btn btn-ghost btn-sm ml-auto" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const ds = snapshot?.dataset ?? null
  const mode: SourceMode | null = ds ? bannerSourceMode(ds, snapshot!.links, subjectId) : workspace === 'demo' ? 'SIMULATED DEMO' : null
  const meta = mode ? SOURCE_META[mode] : null
  const device = ds && subjectId ? subjectDevice(ds, subjectId) : null
  const link = device ? (snapshot?.links[device.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const linkMeta = LINK_META[link]
  const lastSync =
    ds && subjectId
      ? (Object.values(ds.devices)
          .filter((d) => d.subjectId === subjectId && d.lastSyncAt)
          .map((d) => d.lastSyncAt as string)
          .sort()
          .at(-1) ?? null)
      : null
  const demo = workspace === 'demo'

  return (
    <div role="status" data-testid="source-banner" className={`border-b ${demo ? 'border-violet/60 bg-[#1d1730]' : 'border-line bg-panel-2'}`}>
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-1.5 sm:px-6">
        <span className="flex items-center gap-2">
          {demo ? <FlaskConical size={14} className="text-violet" /> : <span className={`h-2 w-2 rounded-full ${mode ? MODE_DOT[mode] : 'bg-ink-3'}`} aria-hidden />}
          {!demo && <span className="micro hidden sm:inline">Data source</span>}
          <span className={`text-[12px] font-bold tracking-[0.06em] uppercase ${meta ? TONE[meta.tone].text : 'text-ink-3'}`} data-testid="source-mode" title={meta?.hint}>
            {demo ? 'Simulated demo' : (mode ?? 'Connecting')}
          </span>
          {demo && <span className="hidden text-[12px] text-ink-2 sm:inline">No astronaut data</span>}
        </span>
        {demo && <ScenarioPicker />}

        <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
          <RailReadout icon={<Watch size={14} />} label="Watch" value={linkMeta.label} tone={linkMeta.tone} title={linkMeta.hint} testId="watch-state" />
          <RailReadout
            icon={<RadioTower size={14} />}
            label="Last sync"
            value={lastSync ? utcStamp(lastSync).slice(5) : '--'}
            tone="neutral"
            title={lastSync ? `Last record received over live sync: ${utcStamp(lastSync)} (${ago(lastSync, now)})` : 'No record has arrived over live sync'}
          />
          <RailReadout
            icon={<Cpu size={14} />}
            label="Onboard"
            value={snapshot ? `Online · ${latencyMs ?? '--'} ms` : 'Connecting'}
            tone="neutral"
            title="The mission-computer API on this machine"
          />
          <RailReadout
            icon={<Network size={14} />}
            label="Network"
            value={external.count > 0 ? `${external.count} external` : online ? 'Internet not used' : 'Offline · local'}
            tone={external.count > 0 ? 'amber' : 'neutral'}
            title={`Requests this page made to other machines: ${external.count}. The browser reports the network as ${online ? 'attached' : 'disconnected'}; that flag does not test internet access, and nothing here needs it.`}
          />
          {demo ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setScenarioId(null)
                setWorkspace('mission')
              }}
            >
              Exit demo
            </button>
          ) : (
            <button className="btn btn-sim btn-sm" onClick={() => setWorkspace('demo')}>
              Open simulated demo
            </button>
          )}
        </span>
      </div>
      {demo && <div className="sr-only">Every reading, symptom and alert here is simulated. No astronaut data.</div>}
    </div>
  )
}

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1520px] px-4 pb-10 sm:px-6">
      <div className="rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-5 text-[12px] text-ink-3">
        <span className="max-w-[90ch]">
          GRAVITYGUARD organises recorded evidence for human review. It does not diagnose, predict fainting, measure blood pressure on the wrist, or clear anyone for duty.
        </span>
        <span>Contract v1 · all times UTC · runs offline</span>
      </div>
    </footer>
  )
}
