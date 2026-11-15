import { ChevronDown } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { subjectDevice, type SourceMode } from '../../shared/dataset'
import { ago, utcStamp } from '../../shared/format'
import { useData, useExternalRequests, useNavigatorOnline, useNow } from '../lib/data'
import { href, type Route } from '../lib/router'
import { DEMO_SCENARIOS, scenarioById } from '../lib/scenarios'
import { bannerSourceMode, defaultSubject, LINK_META, SOURCE_META, subjectsOf, type Tone } from '../lib/view'
import { BADGE, TONE } from './ui'

/** A monochrome tile with a heartbeat trace (Vercel-style: light mark, no colour). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <rect width="28" height="28" rx="6" fill="#ededed" />
      <path d="M5 15h4l2-5 3 9 2.5-6 1.5 2H23" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The page width used by the header, the pages and the footer. */
export const CONTAINER = 'mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8'

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
    <div className="border-b border-line bg-void">
      <div className={`${CONTAINER} flex h-16 items-center gap-4`}>
        <a href={href.overview} className="flex min-w-0 items-center gap-3" aria-label="GRAVITYGUARD mission overview">
          <LogoMark />
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">GRAVITYGUARD</span>
          <span className="hidden text-line-strong sm:inline" aria-hidden>
            /
          </span>
          <span className="hidden truncate text-[14px] text-ink-2 sm:inline">Crew health review</span>
        </a>
        <label className="ml-auto flex shrink-0 items-center gap-3">
          <span className="micro hidden lg:inline">Active crew</span>
          <span className="relative">
            <select
              className="field h-8 appearance-none pr-8 pl-3 text-[14px]"
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
            <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-2" aria-hidden />
          </span>
        </label>
      </div>
      <nav aria-label="Main" className={`${CONTAINER} -mb-px flex overflow-x-auto`}>
        <div className="-ml-3 flex">
          {NAV.map((n) => {
            const active = n.key.includes(route.name)
            return (
              <a key={n.label} href={n.to} aria-current={active ? 'page' : undefined} className="nav-pill">
                {n.label}
              </a>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

/** A readout in the status line: label, then the value. It flashes once when the value changes. */
function RailReadout({ icon, label, value, tone, title, testId }: { icon: ReactNode; label: string; value: string; tone: Tone; title: string; testId?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap" title={title}>
      {icon}
      <span className="text-ink-2">{label}</span>
      <span key={value} className={`state-flash ${tone !== 'neutral' && tone !== 'muted' ? `${BADGE} ${TONE[tone].badge}` : 'rounded-[3px] text-ink tnum'}`} data-testid={testId}>
        {value}
      </span>
    </span>
  )
}


function ScenarioPicker() {
  const { scenarioId, setScenarioId, setSubjectId, snapshot } = useData()
  const current = scenarioById(scenarioId)
  return (
    <label className="relative flex items-center gap-2">
      <span className="sr-only">Scenario</span>
      <span className="relative">
        <select
          className="field h-8 appearance-none pr-8 pl-3 text-[13px]"
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
        <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-2" aria-hidden />
      </span>
    </label>
  )
}

/** The persistent data-source line. It is part of the sticky header on every page. */
export function StatusRail() {
  const { snapshot, error, workspace, setWorkspace, subjectId, refresh, latencyMs, setScenarioId } = useData()
  const now = useNow(5000)
  const online = useNavigatorOnline()
  const external = useExternalRequests()

  if (error) {
    return (
      <div role="status" data-testid="source-banner" className="border-b border-coral/40 bg-[rgb(229_72_77/0.1)]">
        <div className={`${CONTAINER} flex flex-wrap items-center gap-3 py-2.5`}>
          <span className={`${BADGE} ${TONE.coral.badge}`}>Local API unavailable</span>
          <span className="text-[13px] text-ink-2">No data is shown and nothing is substituted. Start the mission computer with npm start, then retry.</span>
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
    <div role="status" data-testid="source-banner" className={`border-b ${demo ? 'border-violet/50 bg-[rgb(110_86_207/0.12)]' : 'border-line bg-void'}`}>
      <div className={`${CONTAINER} flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5`}>
        <span className="flex items-center gap-2.5">
          {!demo && <span className="text-[13px] text-ink-2">Data source</span>}
          <span className={`${BADGE} ${demo ? TONE.violet.badge : meta ? TONE[meta.tone].badge : TONE.muted.badge}`} data-testid="source-mode" title={meta?.hint}>
            {demo ? 'Simulated demo' : (mode ?? 'Connecting')}
          </span>
          {demo && <span className="hidden text-[13px] text-ink-2 sm:inline">No astronaut data</span>}
        </span>
        {demo && <ScenarioPicker />}

        <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <RailReadout icon={null} label="Watch" value={linkMeta.label} tone={linkMeta.tone} title={linkMeta.hint} testId="watch-state" />
          <RailReadout
            icon={null}
            label="Last sync"
            value={lastSync ? utcStamp(lastSync).slice(5) : '--'}
            tone="neutral"
            title={lastSync ? `Last record received over live sync: ${utcStamp(lastSync)} (${ago(lastSync, now)})` : 'No record has arrived over live sync'}
          />
          <RailReadout icon={null} label="Onboard" value={snapshot ? `Online · ${latencyMs ?? '--'} ms` : 'Connecting'} tone="neutral" title="The mission-computer API on this machine" />
          <RailReadout
            icon={null}
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
            <button className="btn btn-ghost btn-sm" onClick={() => setWorkspace('demo')}>
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
    <footer className={`${CONTAINER} pb-10`}>
      <div className="rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-6 text-[13px] text-ink-2">
        <span className="max-w-[90ch]">
          GRAVITYGUARD organises recorded evidence for human review. It does not diagnose, predict fainting, measure blood pressure on the wrist, or clear anyone for duty.
        </span>
        <span className="font-mono text-[12px]">Contract v1 · UTC · offline</span>
      </div>
      <p className="mt-3 text-[12px] text-ink-3">
        Spacesuit model: NASA 3D Resources (Z2 suit). Earth photograph: NASA, ISS crew image iss072e340644. Both free of copyright; NASA does not endorse this project.
      </p>
    </footer>
  )
}
