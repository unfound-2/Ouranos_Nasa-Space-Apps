import { AttentionSummary, useAttentionSummary } from '../components/AttentionSummary'
import { Activity, ArrowRight, FileUp, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { comparePhases, externalReadingFindings, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { buildEventContext, eventTitle, focusLabel, reasonLine, ringMetrics } from '../../shared/explain'
import { plural, signed, SYMPTOM_NOUN, utcStamp, utcTime } from '../../shared/format'
import type { WatchLinkSnapshot } from '../../shared/watch-link'
import { EvidenceList, REGION_ORDER } from '../components/Astronaut'
import { MissionAssistant } from '../components/MissionAssistant'
import { useCrewProfile } from '../lib/crew-profile'
import { OnboardInstrumentTrends, useSimulatorSamples, WatchCharts } from '../components/WatchCharts'
import { BodyMap } from '../components/BodyMap'
import { ackLabel } from '../components/Events'
import { Bars, Kpi, type BarDatum } from '../components/Gauge'
import { CornerLink, Empty, Pill } from '../components/ui'
import { useData, useNow } from '../lib/data'
import { href, navigate } from '../lib/router'
import { watchSignIn } from '../lib/watch-pairing'
import { scenarioById } from '../lib/scenarios'
import {
  CATEGORY_META,
  focusFor,
  isOpen,
  ORIGIN_LABEL,
  recoveryCheckState,
  regionsFor,
  REVIEW_META,
  sessionsOf,
  sortEvents,
  STATUS_META,
  subjectLabel,
  symptomRegion,
  type Region,
  type RegionInfo,
  type Tone,
} from '../lib/view'

// ---------------------------------------------------------------------------
// Shared pieces also used by the investigation and session pages

export function headlineFor(e: StoredEvent, ds: Dataset): string {
  const ctx = buildEventContext(e, ds, new Date().toISOString())
  return `${eventTitle(ctx)} — ${reasonLine(ctx)}`
}

const LEGEND: { state: RegionInfo['state']; label: string; tone: Tone }[] = [
  { state: 'symptom', label: 'Reported symptom', tone: 'coral' },
  { state: 'data', label: 'Measured evidence', tone: 'cyan' },
  { state: 'caution', label: 'Check the source', tone: 'amber' },
  { state: 'neutral', label: 'No evidence', tone: 'muted' },
]

export function RegionDetail({ info, unplaced, showBadge = true }: { info: RegionInfo | null; unplaced: string[]; showBadge?: boolean }) {
  return (
    <div className="rounded-[8px] border border-hair bg-panel-2 px-4 py-3.5" data-testid="region-detail">
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[14px] font-medium text-ink">{info.name}</div>
            {showBadge && <Pill tone={LEGEND.find((l) => l.state === info.state)!.tone}>{LEGEND.find((l) => l.state === info.state)!.label}</Pill>}
          </div>
          {info.items.length ? (
            <ul className="mt-3 space-y-2.5">
              {info.items.map((it, i) => (
                <li key={i}>
                  <div className="text-[13px] font-medium text-ink">{it.title}</div>
                  <div className="text-[13px] text-ink-2">{it.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-ink-2">No evidence recorded for this region.</p>
          )}
          {info.note && <p className="rule mt-3 pt-3 text-[13px] text-ink-2">{info.note}</p>}
        </>
      ) : (
        <>
          <div className="text-[13px] text-ink-2">Select a region for the record behind it. Marks show where evidence was recorded, not a diagnosis.</div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {LEGEND.map((l) => (
              <Pill key={l.state} tone={l.tone} icon={l.state === 'data' ? Activity : undefined}>
                {l.label}
              </Pill>
            ))}
          </div>
        </>
      )}
      {unplaced.length > 0 && <p className="mt-3 text-[13px] text-ink-2">Also reported without a location: {unplaced.join(', ')}.</p>}
    </div>
  )
}

/** The body evidence map with its findings and detail. Selection can be driven from outside. */
export function CrewReport({
  ds,
  session,
  subjectId,
  compact = false,
  selected: selectedProp,
  onSelect,
}: {
  ds: Dataset
  session: StoredSession | null
  subjectId: string | null
  compact?: boolean
  selected?: Region | null
  onSelect?: (r: Region | null) => void
}) {
  const [own, setOwn] = useState<Region | null>(null)
  const selected = selectedProp !== undefined ? selectedProp : own
  const select = onSelect ?? setOwn
  const regions = regionsFor(session, session ? linkedReadings(ds, session.sessionId) : [])
  return (
    <div className="flex flex-col gap-3">
      <BodyMap regions={regions} selected={selected} onSelect={select} label={`Evidence map for ${subjectId ? subjectLabel(subjectId) : 'crew member'}`} size={compact ? 'compact' : 'hero'} />
      <EvidenceList regions={regions} selected={selected} onSelect={select} />
      <RegionDetail info={selected ? regions[selected] : null} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
    </div>
  )
}

export function TriggerButton() {
  const { actions } = useData()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        className="btn btn-sim"
        data-testid="trigger-sim"
        aria-busy={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            await actions.demoTrigger()
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        Trigger simulated watch event
      </button>
      {err && <span className="text-[13px] text-ink-2">{err}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Focus

interface Focus {
  subjectId: string | null
  session: StoredSession | null
  event: StoredEvent | null
  scenario: ReturnType<typeof scenarioById>
}

function resolveFocus(ds: Dataset, subjectId: string | null, scenarioId: string | null): Focus {
  const scenario = scenarioById(scenarioId)
  if (scenario && Object.hasOwn(ds.sessions, scenario.sessionId)) {
    const event = scenario.eventId && Object.hasOwn(ds.events, scenario.eventId) ? ds.events[scenario.eventId] : null
    return { subjectId: scenario.subjectId, session: ds.sessions[scenario.sessionId], event, scenario }
  }
  const f = focusFor(ds, subjectId)
  const session = f.session
  const sessionEvents = session ? sortEvents(Object.values(ds.events).filter((e) => e.sessionId === session.sessionId)) : []
  return { subjectId, session, event: f.event ?? sessionEvents[0] ?? f.latestEvent, scenario: null }
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
// 1. The alert: the one thing that needs a person

function ReviewFocus({ ds, focus, otherOpen, nowIso }: { ds: Dataset; focus: Focus; otherOpen: number; nowIso: string }) {
  const e = focus.event
  if (!e) {
    return (
      <div className="panel p-6" data-testid="hero-alert">
        <div className="flex items-center gap-2.5">
          <Pill tone="mint">No open event</Pill>
        </div>
        <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] text-ink">No review event</h2>
        <p className="mt-1 max-w-[62ch] text-[15px] text-ink-2">
          {focus.scenario
            ? `${focus.scenario.title}. ${focus.scenario.summary}`
            : `No open review event for ${focus.subjectId ? subjectLabel(focus.subjectId) : 'this crew member'}. A review records that someone looked at the evidence; it is not a medical clearance.`}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {focus.session && (
            <a className="btn btn-primary" href={href.session(focus.session.sessionId)}>
              Session readings <ArrowRight size={16} />
            </a>
          )}
          {otherOpen > 0 && (
            <a className="btn btn-ghost" href={href.events}>
              {plural(otherOpen, 'open event')} for other crew
            </a>
          )}
        </div>
      </div>
    )
  }
  const ctx = buildEventContext(e, ds, nowIso)
  const cat = CATEGORY_META[e.category]
  const tone: Tone = e.review.state === 'REVIEWED' || e.review.state === 'CLOSED' ? 'mint' : cat.tone
  const ack = ackLabel(e)
  return (
    <div className="panel p-6" data-testid="hero-alert">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Pill tone={tone} className="text-[13px] font-semibold tracking-[0.02em]" testId="focus-label">
          {focusLabel(e)}
        </Pill>
        <span className="ml-auto font-mono text-[12px] text-ink-3">{e.eventId}</span>
      </div>
      <h2 className="mt-4 text-[24px] leading-8 font-semibold tracking-[-0.02em] text-ink">{eventTitle(ctx)}</h2>
      <p className="mt-1 text-[16px] text-ink-2">
        <span data-testid="focus-reason">{reasonLine(ctx)}</span>
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-hair pt-5 sm:grid-cols-4">
        <div>
          <dt className="micro">Created</dt>
          <dd className="mt-1 font-mono text-[13px] text-ink">{utcStamp(e.createdAt).slice(5)}</dd>
        </div>
        <div>
          <dt className="micro">Source</dt>
          <dd className="mt-1 text-[14px] text-ink">{ORIGIN_LABEL[e.origin.kind]}</dd>
        </div>
        <div>
          <dt className="micro">On the watch</dt>
          <dd className="mt-1 text-[14px] text-ink">{ack.text}</dd>
        </div>
        <div>
          <dt className="micro">Review</dt>
          <dd className="mt-1">
            <Pill tone={REVIEW_META[e.review.state].tone}>{REVIEW_META[e.review.state].label}</Pill>
          </dd>
        </div>
      </dl>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className="btn btn-primary" href={href.event(e.eventId)} data-testid="open-evidence">
          Open evidence <ArrowRight size={16} />
        </a>
        {otherOpen > 0 && (
          <a className="btn btn-ghost" href={href.events}>
            {plural(otherOpen, 'other open event')}
          </a>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Key metrics

interface HeartRateObservation {
  value: number
  at: string
  source: string
  mode: string
  modeTone: Tone
}

/** The newest heart rate on record: a live code-paired watch frame or a stored reading, whichever is newer. */
function latestHeartRate(ds: Dataset, subjectId: string | null, links: WatchLinkSnapshot[] | null, linkStates: Record<string, LinkState>, workspace: string): HeartRateObservation | null {
  const stored = latestValidHeartRate(sessionsOf(ds, subjectId))
  let best: HeartRateObservation | null = stored
    ? {
        value: stored.value as number,
        at: stored.measuredAt,
        source: stored.source.device ?? stored.source.kind,
        mode: recordSourceMode(stored, stored.provenance.deviceId ? (linkStates[stored.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED'),
        modeTone: stored.isSimulated ? 'violet' : 'cyan',
      }
    : null
  for (const l of links ?? []) {
    const f = l.watch
    if (!f || (workspace === 'demo' && !f.simulated)) continue
    const r = f.readings.find((x) => x.metric.toLowerCase() === 'heart rate' && x.unit.toLowerCase() === 'bpm' && x.quality === 'valid')
    if (!r) continue
    const at = new Date((r.measuredAt ?? f.observedAt) * 1000).toISOString()
    if (best && Date.parse(best.at) >= Date.parse(at)) continue
    const verified = linkStates[l.deviceId] === 'VERIFIED'
    best = {
      value: r.value,
      at,
      source: f.simulated && workspace === 'mission' ? 'Watch test feed' : `${f.source} (code-paired watch)`,
      mode: f.simulated ? (workspace === 'demo' ? 'SIMULATED DEMO' : 'WATCH TEST FEED') : verified ? 'LIVE DEVICE' : 'SAVED DEVICE DATA',
      modeTone: f.simulated ? 'violet' : verified ? 'mint' : 'cyan',
    }
  }
  return best
}

function useTelemetry(ds: Dataset, focus: Focus, nowMs: number) {
  const { snapshot, watchLinks, workspace } = useData()
  const profile = useCrewProfile()
  const s = focus.session
  const e = focus.event
  const rings = ringMetrics(s, e, REVIEW_CHECKLIST.items.length)
  const hr = latestHeartRate(ds, focus.subjectId, profile ? watchLinks?.filter((link) => link.deviceId === profile.deviceId) ?? null : watchLinks, snapshot?.links ?? {}, workspace)
  const recent = hr ? nowMs - Date.parse(hr.at) <= RULES.recentReadingSeconds * 1000 : false
  const c = s ? comparePhases(s) : null
  const recorded = s ? s.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const valid = c ? c.rest.valid.length + c.recovery.valid.length : 0
  const sessionLink = s?.provenance.deviceId ? ((snapshot?.links[s.provenance.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const check = recoveryCheckState(s, s ? recordSourceMode(s, sessionLink) : null)
  const steps = s ? sessionCompleteness(s) : null
  const excluded = c ? [...c.rest.excluded, ...c.recovery.excluded] : []
  const extFlags = s ? externalReadingFindings(s, linkedReadings(ds, s.sessionId)).length : 0
  const device = focus.subjectId ? subjectDevice(ds, focus.subjectId) : null
  const link = device ? ((snapshot?.links[device.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const latestSession = sessionsOf(ds, focus.subjectId)[0] ?? null
  const validIds = new Set(c ? [...c.rest.valid, ...c.recovery.valid].map((m) => m.measurementId) : [])
  const series = s
    ? s.measurements
        .filter((m) => validIds.has(m.measurementId) && typeof m.value === 'number')
        .map((m) => ({ x: Date.parse(m.measuredAt), y: m.value as number }))
        .sort((a, b) => a.x - b.x)
    : []
  return { s, e, rings, hr, recent, c, recorded, valid, check, steps, excluded, extFlags, device, link, latestSession, series }
}

type Telemetry = ReturnType<typeof useTelemetry>

function RecoveryTrend({ ds, focus, t }: { ds: Dataset; focus: Focus; t: Telemetry }) {
  const { c } = t
  const sessions = sessionsOf(ds, focus.subjectId).slice(0, 6).reverse()
  const bars: BarDatum[] = sessions.map((s) => {
    const d = comparePhases(s).observedDelta
    return {
      key: s.sessionId,
      label: shortDate(s.startedAt),
      value: d,
      display: d === null ? 'Too few readings to compare' : `${signed(d)} bpm, recovery − rest`,
      tone: s.symptoms.length ? 'coral' : 'cyan',
      current: s.sessionId === focus.session?.sessionId,
      href: href.session(s.sessionId),
      note: s.symptoms.length ? 'A symptom was reported in this check' : undefined,
    }
  })
  return (
    <section aria-label="Recovery trend">
      <Kpi
        label="Recovery − rest"
        value={c?.observedDelta != null ? signed(c.observedDelta) : '--'}
        unit={c?.observedDelta != null ? 'bpm' : undefined}
        sub={c?.observedDelta != null ? `This check   medians ${c.recoveryMedian} and ${c.restMedian}` : 'Too few readings in this check'}
        mark={<CornerLink href={href.crew} label="Open recovery history" />}
      >
        <Bars data={bars} height={96} ariaLabel={`Recovery minus rest for the last ${plural(bars.length, 'check')}`} onSelect={(d) => d.href && navigate(d.href)} />
      </Kpi>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Health event queue


function EventQueue({ ds, focusId }: { ds: Dataset; focusId: string | null }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => sortEvents(Object.values(ds.events)), [ds])
  const needle = q.trim().toLowerCase()
  const events = needle
    ? all.filter((e) => [e.eventId, e.sessionId ?? '', subjectLabel(e.subjectId), CATEGORY_META[e.category].label, STATUS_META[e.status].label, ORIGIN_LABEL[e.origin.kind], ...e.reasonCodes].some((f) => f.toLowerCase().includes(needle)))
    : all.slice(0, 8)
  return (
    <section className="panel min-w-0 overflow-hidden" aria-label="Health event queue">
      <header className="pane-head flex-wrap">
        <h2 className="label">Health event queue</h2>
        <div className="flex flex-wrap items-center gap-4">
          <label className="relative">
            <span className="sr-only">Search events</span>
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
            <input className="field h-8 w-[240px] max-w-full pl-8 text-[13px]" placeholder="Search events, crew, reason codes" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <CornerLink href={href.events} label="Open the full event history" />
        </div>
      </header>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th className="hidden md:table-cell">Crew</th>
              <th className="hidden md:table-cell">Created</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody data-testid="event-feed">
            {events.map((e) => {
              const cat = CATEGORY_META[e.category]
              const st = STATUS_META[e.status]
              return (
                <tr key={e.eventId} className="row-link" data-selected={e.eventId === focusId} onClick={() => navigate(href.event(e.eventId))}>
                  <td>
                    <a href={href.event(e.eventId)} data-testid={`event-row-${e.eventId}`} className="flex min-w-0 items-center gap-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <span className="truncate font-medium text-ink">{cat.label}</span>
                    </a>
                    <span className="mt-1 block truncate text-[13px] text-ink-2 md:hidden">
                      {subjectLabel(e.subjectId)}   {utcStamp(e.createdAt).slice(5)}
                    </span>
                  </td>
                  <td className="hidden text-ink-2 md:table-cell">{subjectLabel(e.subjectId)}</td>
                  <td className="hidden font-mono text-[13px] text-ink-2 md:table-cell">{utcStamp(e.createdAt).slice(5)}</td>
                  <td>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </td>
                </tr>
              )
            })}
            {!events.length && (
              <tr>
                <td colSpan={4} className="text-ink-2">
                  {needle ? `No recorded event matches “${q.trim()}”.` : 'No events recorded.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Empty states

function EmptyWorkspace() {
  const { workspace, setWorkspace, actions } = useData()
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      {workspace === 'mission' ? (
        <Empty
          title="No mission records yet"
          action={
            <div className="flex flex-wrap gap-3">
              <a className="btn btn-primary" href={href.system}>
                <FileUp size={16} /> Connect or import a watch
              </a>
              <button className="btn btn-sim" onClick={() => setWorkspace('demo')}>
                Open simulated demo
              </button>
            </div>
          }
        >
          Nothing has arrived from a watch, so there is nothing to show. Pair the watch or import a saved watch file from System Status. The dashboard never fills this view with simulated data on its own.
        </Empty>
      ) : (
        <Empty
          title="The demo workspace is empty"
          action={
            <button
              className="btn btn-sim"
              aria-busy={busy}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await actions.demoReset()
                } finally {
                  setBusy(false)
                }
              }}
            >
              Load simulated scenarios
            </button>
          }
        >
          Load the six simulated scenarios: a normal check, dizziness, too few readings, a questionable cuff reading, an unreachable watch, and an acknowledged but unreviewed alert.
        </Empty>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page

export function Overview() {
  const { snapshot, workspace, subjectId, scenarioId } = useData()
  const nowMs = useNow(5000)
  const [region, setRegion] = useState<Region | null>(null)
  if (!snapshot) return null
  const ds = snapshot.dataset
  return <Dashboard ds={ds} nowMs={nowMs} region={region} setRegion={setRegion} workspace={workspace} subjectId={subjectId} scenarioId={scenarioId} serverTime={snapshot.serverTime} />
}

function Dashboard({
  ds,
  nowMs,
  region,
  setRegion,
  workspace,
  subjectId,
  scenarioId,
  serverTime,
}: {
  ds: Dataset
  nowMs: number
  region: Region | null
  setRegion: (r: Region | null) => void
  workspace: string
  subjectId: string | null
  scenarioId: string | null
  serverTime: string
}) {
  const profile = useCrewProfile()
  const { health } = useData()
  const simulated = useSimulatorSamples()
  const pairedDevice = profile?.deviceId ?? (workspace === 'mission' ? watchSignIn()?.deviceId : undefined)
  const linkedSubject = pairedDevice ? ds.devices[pairedDevice]?.subjectId ?? null : null
  const scoped = workspace === 'mission' && (profile || pairedDevice)
  const crewData = scoped && !linkedSubject ? { ...ds, sessions: {}, events: {} } : ds
  const focus = resolveFocus(crewData, scoped ? linkedSubject : subjectId, scenarioId)
  const session = focus.session
  const t = useTelemetry(crewData, focus, nowMs)
  const otherOpen = sortEvents(Object.values(ds.events))
    .filter(isOpen)
    .filter((e) => e.eventId !== focus.event?.eventId).length
  const regions = regionsFor(session, session ? linkedReadings(ds, session.sessionId) : [])
  const crew = focus.subjectId ? subjectLabel(focus.subjectId) : profile?.name ?? null
  const attention = useAttentionSummary({
    event: focus.event && isOpen(focus.event) ? focus.event : null,
    session, dataset: ds, serverTime, deviceId: pairedDevice, simulated,
  })
  const selectedRegion = region ?? 'CHEST'
  const recentChecks = focus.subjectId ? sessionsOf(crewData, focus.subjectId).slice(0, 5) : []
  for (const r of ['HEAD', 'LEGS'] as const) {
    const checksWithReports = recentChecks.filter((check) => check.symptoms.some((symptom) => symptomRegion(symptom) === r))
    const latestReport = checksWithReports[0]
    const symptomNames = [...new Set(latestReport?.symptoms.filter((symptom) => symptomRegion(symptom) === r).map((symptom) => SYMPTOM_NOUN[symptom.code]) ?? [])]
    regions[r].items.push({
      kind: 'symptom',
      title: r === 'HEAD' ? 'Head symptom check-ins' : 'Leg symptom check-ins',
      tone: checksWithReports.length ? 'coral' : 'muted',
      detail: recentChecks.length
        ? `${checksWithReports.length} of ${recentChecks.length} recent check-ins included a report.${latestReport ? ` Latest: ${symptomNames.join(', ')}   ${utcStamp(latestReport.startedAt)}.` : ''}`
        : 'No check-ins recorded yet.',
    })
  }
  const regionNotes: Record<Region, string> = {
    HEAD: 'Look here for reported dizziness and other symptoms located at the head.',
    CHEST: 'Compare pulse, breathing, oxygen and pressure here. Some of these readings are measured at the wrist.',
    ARMS: 'Look here for wrist sensor readings and their quality.',
    LEGS: 'Look here for reported symptoms or observations located at the legs.',
  }
  const matches = (label: string, r: Region) => r === 'CHEST'
    ? /heart rate|pulse|respirat|breath|oxygen|spo2|pressure/i.test(label)
    : r === 'ARMS' && /skin temperature|wrist/i.test(label)
  for (const r of REGION_ORDER) {
    const info = regions[r]
    const current = attention.readings.filter(({ label }) => matches(label, r))
    for (const reading of current) {
      const flagged = ['review', 'priority'].includes(reading.status)
      const title = `${reading.label}: ${reading.value} ${reading.unit}`.trim()
      info.items.push({
        kind: 'reading', title, tone: flagged ? 'amber' : 'cyan',
        detail: `${reading.source}   ${utcTime(new Date(reading.time * 1000).toISOString())}${flagged ? '   Flagged for review' : ''}`,
      })
      if (info.state !== 'symptom' && (info.state === 'neutral' || flagged)) {
        info.state = flagged ? 'caution' : 'data'
        info.callout = title
      }
    }
    for (const reading of attention.simulatedReadings.filter(({ label }) => matches(label, r))) {
      const value = Number(reading.value.toFixed(1))
      info.items.push({ kind: 'reading', title: reading.label, tone: 'cyan', detail: `Simulated   ${value > 0 ? '+' : ''}${value} ${reading.unit} from rest` })
      if (info.state === 'neutral') {
        info.state = 'data'
        info.callout = 'Simulated measurements'
      }
    }
    info.note ??= regionNotes[r]
  }


  return (
    <div className="mission-health flex flex-col gap-5">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Mission health</h1>
        <p className="flex flex-wrap justify-center gap-x-3"><span>{crew ?? 'No crew selected'}</span><span>{session ? utcStamp(session.startedAt) : 'No recorded assessment'}</span></p>
      </header>

      <section className="mission-vitals" aria-label="Crew measurements">
        <div className="mission-vitals-right">
          <WatchCharts recordedHeartRate={t.series} simulated={simulated} compact />
          <section className="panel flag-readings" aria-label="Readings that triggered the flag">
            <h2 className="faded-label text-base font-semibold">Readings that triggered the flag</h2>
            <ul className="flag-reading-rows">
              {(attention.triggerReadings.length ? attention.triggerReadings.slice(0, 2) : ['No readings flagged']).map((reading) => (
                <li key={reading} title={reading}>{reading}</li>
              ))}
            </ul>
            {attention.triggerReadings.length > 2 && (
              <details className="flag-reading-dropdown">
                <summary>Show {attention.triggerReadings.length - 2} more</summary>
                <ul>{attention.triggerReadings.slice(2).map((reading) => <li key={reading}>{reading}</li>)}</ul>
              </details>
            )}
          </section>
        </div>
        <div className="mission-vitals-body">
          <BodyMap regions={regions} selected={selectedRegion} onSelect={(r) => r && setRegion(r)} label={`Evidence map for ${crew ?? 'crew member'}`} size="hero" />
        </div>
        <div className="mission-vitals-left">
          <AttentionSummary summary={attention} />
          <MissionAssistant key={profile?.id ?? 'default'} summary={attention} name={profile?.name} />
        </div>
      </section>
      {!session && !focus.event && !t.hr && (workspace === 'demo' || !pairedDevice) && <EmptyWorkspace />}
      <section aria-label="Body region evidence">
        <div className="region-tabs" role="tablist" aria-label="Body regions">
          {REGION_ORDER.map((r, i) => (
            <button key={r} type="button" id={`body-tab-${r}`} role="tab" aria-selected={selectedRegion === r}
              tabIndex={selectedRegion === r ? 0 : -1} aria-controls="body-region-evidence"
              onClick={() => setRegion(r)}
              onKeyDown={(e) => {
                const next = e.key === 'ArrowRight' ? (i + 1) % REGION_ORDER.length
                  : e.key === 'ArrowLeft' ? (i + REGION_ORDER.length - 1) % REGION_ORDER.length
                  : e.key === 'Home' ? 0 : e.key === 'End' ? REGION_ORDER.length - 1 : null
                if (next === null) return
                e.preventDefault()
                setRegion(REGION_ORDER[next])
                const nextTab = e.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined
                nextTab?.focus()
              }}>
              {regions[r].name}
            </button>
          ))}
        </div>
        <div id="body-region-evidence" role="tabpanel" tabIndex={0} aria-labelledby={`body-tab-${selectedRegion}`} aria-live="polite">
          <RegionDetail showBadge={false} info={regions[selectedRegion]} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
        </div>
      </section>
      <OnboardInstrumentTrends samples={simulated} deviceId={pairedDevice ?? undefined} />
      <ReviewFocus ds={ds} focus={focus} otherOpen={otherOpen} nowIso={serverTime} />
      <section className="grid gap-4" aria-labelledby="assessment-title">
        <h2 id="assessment-title" className="display faded-label text-[24px]">Recovery assessment</h2>
        <RecoveryTrend ds={crewData} focus={focus} t={t} />
        <div className="panel p-5">
          <h3 className="font-semibold">Assessment</h3>
          <p className="mt-2">{attention.interpretation}</p>
          {attention.explanation && <p className="mt-1 text-sm text-ink-2">{attention.explanation}</p>}
        </div>
      </section>
      <EventQueue ds={ds} focusId={focus.event?.eventId ?? null} />
      {workspace === 'demo' && health?.network.bind !== 'HTTPS' && <div><TriggerButton /></div>}
    </div>
  )
}
