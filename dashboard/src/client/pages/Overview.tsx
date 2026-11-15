import { ArrowRight, CheckCircle2, FileUp, FlaskConical, Radio } from 'lucide-react'
import { useState } from 'react'
import { comparePhases, externalReadingFindings, hrCoverage, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { buildEventContext, eventTitle, focusLabel, reasonLine, ringMetrics, timelineFor, type TimelineItem } from '../../shared/explain'
import { ago, plural, SYMPTOM_NOUN, utcStamp, utcTime } from '../../shared/format'
import type { WatchLinkSnapshot } from '../../shared/watch-link'
import { Astronaut } from '../components/Astronaut'
import { ackLabel } from '../components/Events'
import { Ring } from '../components/Ring'
import { Empty, Pill, SimTag, TONE } from '../components/ui'
import { useData, useNow } from '../lib/data'
import { href, navigate } from '../lib/router'
import { scenarioById } from '../lib/scenarios'
import {
  CATEGORY_META,
  focusFor,
  isOpen,
  LINK_META,
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

const LEGEND: { state: RegionInfo['state']; label: string; tone: Tone; shape: 'circle' | 'diamond' | 'hollow' | 'none' }[] = [
  { state: 'symptom', label: 'Reported symptom', tone: 'coral', shape: 'circle' },
  { state: 'data', label: 'Measured evidence', tone: 'cyan', shape: 'diamond' },
  { state: 'caution', label: 'Check the source', tone: 'amber', shape: 'hollow' },
  { state: 'neutral', label: 'No evidence', tone: 'muted', shape: 'none' },
]

function LegendMark({ shape, tone }: { shape: (typeof LEGEND)[number]['shape']; tone: Tone }) {
  const c = TONE[tone].stroke
  return (
    <svg width="12" height="12" aria-hidden>
      {shape === 'circle' && <circle cx="6" cy="6" r="4" fill={c} />}
      {shape === 'diamond' && <rect x="2.6" y="2.6" width="6.8" height="6.8" fill={c} transform="rotate(45 6 6)" />}
      {shape === 'hollow' && <rect x="2.6" y="2.6" width="6.8" height="6.8" fill="none" stroke={c} strokeWidth="1.5" transform="rotate(45 6 6)" />}
      {shape === 'none' && <line x1="2" y1="6" x2="10" y2="6" stroke={c} strokeWidth="1.5" />}
    </svg>
  )
}

export function RegionDetail({ info, unplaced }: { info: RegionInfo | null; unplaced: string[] }) {
  return (
    <div className="well px-4 py-3.5" data-testid="region-detail">
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="label text-ink">{info.name}</div>
            <Pill tone={LEGEND.find((l) => l.state === info.state)!.tone}>{LEGEND.find((l) => l.state === info.state)!.label}</Pill>
          </div>
          {info.items.length ? (
            <ul className="mt-3 space-y-2.5">
              {info.items.map((it, i) => (
                <li key={i}>
                  <div className={`text-[12px] font-semibold tracking-[0.04em] ${TONE[it.tone].text}`}>{it.title}</div>
                  <div className="text-[12.5px] text-ink-2">{it.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-3">No evidence recorded for this region.</p>
          )}
          {info.note && <p className="rule mt-3 pt-2.5 text-[11.5px] text-ink-3">{info.note}</p>}
        </>
      ) : (
        <>
          <div className="text-[12.5px] text-ink-2">Select a region or marker to open the record behind it. A highlight shows where evidence was recorded, not a diagnosis.</div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {LEGEND.map((l) => (
              <span key={l.state} className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                <LegendMark shape={l.shape} tone={l.tone} />
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
      {unplaced.length > 0 && <p className="mt-3 text-[11.5px] text-ink-3">Also reported without a location: {unplaced.join(', ')}.</p>}
    </div>
  )
}

/** The astronaut evidence map with its detail card. Selection can be driven from outside. */
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
    <div className="flex flex-col gap-4">
      <div className={`mx-auto w-full ${compact ? 'max-w-[440px]' : 'max-w-[560px]'}`}>
        <Astronaut regions={regions} selected={selected} onSelect={select} label={`Evidence map for ${subjectId ? subjectLabel(subjectId) : 'crew member'}`} />
      </div>
      <RegionDetail info={selected ? regions[selected] : null} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
    </div>
  )
}

export function TriggerButton() {
  const { actions } = useData()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-1">
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
        <Radio size={15} /> Trigger simulated watch event
      </button>
      {err && <span className="text-[11.5px] text-coral">{err}</span>}
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

// ---------------------------------------------------------------------------
// Hero focus card

function ReviewFocus({ ds, focus, otherOpen, nowIso }: { ds: Dataset; focus: Focus; otherOpen: number; nowIso: string }) {
  const e = focus.event
  if (!e) {
    return (
      <div className="panel rise flex h-full flex-col justify-between gap-5 p-6" data-testid="hero-alert">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-mint" size={20} />
          <div>
            <div className="label text-mint">No review event</div>
            <p className="mt-2 max-w-[56ch] text-[14px] text-ink-2">
              {focus.scenario
                ? `${focus.scenario.title}. ${focus.scenario.summary}`
                : `No open review event for ${focus.subjectId ? subjectLabel(focus.subjectId) : 'this crew member'}. A review records that someone looked at the evidence; it is not a medical clearance.`}
            </p>
          </div>
        </div>
        {otherOpen > 0 && (
          <a className="text-[12.5px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink" href={href.events}>
            {plural(otherOpen, 'open event')} for other crew
          </a>
        )}
      </div>
    )
  }
  const ctx = buildEventContext(e, ds, nowIso)
  const cat = CATEGORY_META[e.category]
  const tone: Tone = e.review.state === 'REVIEWED' || e.review.state === 'CLOSED' ? 'mint' : cat.tone
  const t = TONE[tone]
  const ack = ackLabel(e)
  const open = isOpen(e)
  return (
    <div
      className={`rise relative flex h-full flex-col overflow-hidden rounded-2xl border p-6 ${t.border}`}
      style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${t.stroke} 9%, var(--color-panel)) 0%, var(--color-panel) 62%)` }}
      data-testid="hero-alert"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${t.dot} ${open ? 'pulse-dot' : ''}`} aria-hidden />
        <span className={`font-display text-[11.5px] font-bold tracking-[0.18em] [font-stretch:112%] ${t.text}`} data-testid="focus-label">
          {focusLabel(e)}
        </span>
        {e.isSimulated && <SimTag />}
        <span className="ml-auto font-mono text-[11px] text-ink-3">{e.eventId}</span>
      </div>
      <h2 className="mt-4 text-[26px] leading-tight font-semibold tracking-[-0.01em] text-ink">{eventTitle(ctx)}</h2>
      <p className="mt-1.5 text-[15px] text-ink-2">
        <span className="text-ink-3">Reason · </span>
        <span className="text-ink" data-testid="focus-reason">
          {reasonLine(ctx)}
        </span>
      </p>
      <dl className="rule mt-5 grid grid-cols-2 gap-x-5 gap-y-3 pt-4 sm:grid-cols-4">
        <div>
          <dt className="micro">Created</dt>
          <dd className="mt-1 text-[12.5px] text-ink tnum">{utcStamp(e.createdAt).slice(5)}</dd>
        </div>
        <div>
          <dt className="micro">Source</dt>
          <dd className="mt-1 text-[12.5px] text-ink">{ORIGIN_LABEL[e.origin.kind]}</dd>
        </div>
        <div>
          <dt className="micro">On the watch</dt>
          <dd className={`mt-1 text-[12.5px] ${TONE[ack.tone].text}`}>{ack.text}</dd>
        </div>
        <div>
          <dt className="micro">Review</dt>
          <dd className={`mt-1 text-[12.5px] ${TONE[REVIEW_META[e.review.state].tone].text}`}>{REVIEW_META[e.review.state].label}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-4 pt-6">
        <a className={`btn ${tone === 'coral' ? 'btn-alert' : 'btn-primary'}`} href={href.event(e.eventId)} data-testid="open-evidence">
          Open evidence <ArrowRight size={15} />
        </a>
        {otherOpen > 0 && (
          <a className="text-[12.5px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink" href={href.events}>
            {plural(otherOpen, 'other open event')}
          </a>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Telemetry

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
    if (!f || f.simulated !== (workspace === 'demo')) continue
    const r = f.readings.find((x) => x.metric.toLowerCase() === 'heart rate' && x.unit.toLowerCase() === 'bpm' && x.quality === 'valid')
    if (!r) continue
    const at = new Date((r.measuredAt ?? f.observedAt) * 1000).toISOString()
    if (best && Date.parse(best.at) >= Date.parse(at)) continue
    const verified = linkStates[l.deviceId] === 'VERIFIED'
    best = {
      value: r.value,
      at,
      source: `${f.source} (code-paired watch)`,
      mode: f.simulated ? 'SIMULATED DEMO' : verified ? 'LIVE DEVICE' : 'SAVED DEVICE DATA',
      modeTone: f.simulated ? 'violet' : verified ? 'mint' : 'cyan',
    }
  }
  return best
}

function Instrument({ label, value, sub, tone, testId }: { label: string; value: string; sub: string; tone?: Tone; testId?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-3" data-testid={testId}>
      <dt className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${tone ? TONE[tone].dot : 'bg-ink-3'}`} aria-hidden />
        <span className="eyebrow">{label}</span>
      </dt>
      <dd className={`text-right text-[15px] font-semibold tnum ${tone && tone !== 'neutral' && tone !== 'muted' ? TONE[tone].text : 'text-ink'}`}>{value}</dd>
      <dd className="col-span-2 mt-0.5 truncate pl-3.5 text-[11.5px] text-ink-3">{sub}</dd>
    </div>
  )
}

function Telemetry({ ds, focus, nowMs }: { ds: Dataset; focus: Focus; nowMs: number }) {
  const { snapshot, watchLinks, workspace } = useData()
  const s = focus.session
  const e = focus.event
  const rings = ringMetrics(s, e, REVIEW_CHECKLIST.items.length)
  const hr = latestHeartRate(ds, focus.subjectId, watchLinks, snapshot?.links ?? {}, workspace)
  const recent = hr ? nowMs - Date.parse(hr.at) <= RULES.recentReadingSeconds * 1000 : false
  const c = s ? comparePhases(s) : null
  const recorded = s ? s.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const valid = c ? c.rest.valid.length + c.recovery.valid.length : 0
  const cov = s ? hrCoverage(s) : null
  const sessionLink = s?.provenance.deviceId ? ((snapshot?.links[s.provenance.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const check = recoveryCheckState(s, s ? recordSourceMode(s, sessionLink) : null)
  const steps = s ? sessionCompleteness(s) : null
  const excluded = c ? [...c.rest.excluded, ...c.recovery.excluded] : []
  const extFlags = s ? externalReadingFindings(s, linkedReadings(ds, s.sessionId)).length : 0
  const device = focus.subjectId ? subjectDevice(ds, focus.subjectId) : null
  const link = device ? ((snapshot?.links[device.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const latestSession = sessionsOf(ds, focus.subjectId)[0] ?? null

  return (
    <section className="panel flex h-full flex-col p-5" aria-label="Mission telemetry" data-testid="telemetry">
      <header className="flex items-center justify-between gap-3">
        <h2 className="label">Mission telemetry</h2>
        <span className="font-mono text-[11px] text-ink-3">{s?.sessionId ?? 'no session'}</span>
      </header>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Ring value={rings.completeness} tone="mint" label="Completeness" caption="Protocol steps in the record" unavailable="No check recorded" size={104} />
        <Ring value={rings.coverage} tone="cyan" label="HR coverage" caption="10 s intervals with a valid reading" unavailable="Phase times incomplete" size={104} />
        <Ring value={rings.review} tone="violet" label="Review" caption={`Checklist items, v${REVIEW_CHECKLIST.version}`} unavailable="No event to review" size={104} />
      </div>
      <dl className="mt-3 divide-y divide-hair" data-testid="measurement-strip">
        <Instrument
          testId="strip-hr"
          label="Latest heart rate"
          value={hr ? (recent ? `${hr.value} bpm` : 'No recent data') : '--'}
          sub={hr ? `${recent ? '' : `Last ${hr.value} bpm · `}${utcStamp(hr.at).slice(5)} · ${hr.source} · ${hr.mode}` : 'No valid heart-rate reading on record'}
          tone={hr ? (recent ? hr.modeTone : 'muted') : 'muted'}
        />
        <Instrument
          label="Sample coverage"
          value={s ? `${valid} / ${recorded}` : '--'}
          sub={s ? `Valid of recorded readings${cov?.status === 'CALCULATED' ? ` · ${cov.coveredIntervals} of ${cov.totalIntervals} intervals covered` : ''}` : 'No check recorded'}
          tone={s ? 'cyan' : 'muted'}
        />
        <Instrument testId="strip-check" label="Session progress" value={check.value} sub={steps ? `${steps.done} of ${steps.total} protocol steps · ${check.sub}` : check.sub} tone={s ? 'mint' : 'muted'} />
        <Instrument
          label="Review state"
          value={e ? REVIEW_META[e.review.state].label : '--'}
          sub={e ? (e.review.reviewer ? `Reviewer: ${e.review.reviewer}` : `${STATUS_META[e.status].label} · ${ackLabel(e).text}`) : 'No event for this check'}
          tone={e ? REVIEW_META[e.review.state].tone : 'muted'}
        />
        <Instrument
          label="Source quality"
          value={!s ? '--' : excluded.length || extFlags ? `${excluded.length + extFlags} flagged` : 'All valid'}
          sub={
            !s
              ? 'No check recorded'
              : excluded.length
                ? `${plural(excluded.length, 'reading')} left out of the medians${extFlags ? ` · ${plural(extFlags, 'external flag')}` : ''}`
                : extFlags
                  ? `${plural(extFlags, 'external reading')} flagged for source review`
                  : 'Every heart-rate reading used'
          }
          tone={!s ? 'muted' : excluded.length || extFlags ? 'amber' : 'mint'}
        />
        <Instrument
          label="Last assessment"
          value={latestSession ? utcStamp(latestSession.startedAt).slice(5, 16) + 'Z' : '--'}
          sub={latestSession ? `${latestSession.summary ? `Watch summary: ${latestSession.summary.status.replace(/_/g, ' ').toLowerCase()}` : 'No watch summary'} · ${ago(latestSession.startedAt, nowMs)}` : 'No assessment recorded'}
        />
        <Instrument
          label="Watch reachability"
          value={LINK_META[link].label}
          sub={device ? `${device.deviceModel ?? device.deviceId} · last contact ${ago(device.lastSeenAt, nowMs)}` : 'No watch has checked in for this crew member'}
          tone={LINK_META[link].tone}
        />
      </dl>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Mission timeline

const TL_TONE: Record<TimelineItem['tone'], string> = {
  neutral: 'bg-ink-3',
  data: 'bg-cyan',
  symptom: 'bg-coral',
  event: 'bg-violet',
  review: 'bg-mint',
  warning: 'bg-amber',
}

function MissionTimeline({ focus, ds, onSymptom, selectedRegion }: { focus: Focus; ds: Dataset; onSymptom: (r: Region) => void; selectedRegion: Region | null }) {
  const items = timelineFor(focus.event, focus.session)
  const symptomFor = (at: string) => focus.session?.symptoms.find((s) => s.reportedAt === at) ?? null
  const act = (i: TimelineItem) => {
    if (i.kind === 'SYMPTOM') {
      const sym = symptomFor(i.at)
      const r = sym ? symptomRegion(sym) : null
      if (r) onSymptom(r)
      return
    }
    if (['SESSION_STARTED', 'REST_RECORDED', 'RECOVERY_CONFIRMED', 'RECOVERY_RECORDED', 'SESSION_SAVED'].includes(i.kind) && focus.session) navigate(href.session(focus.session.sessionId))
    else if (focus.event) navigate(href.event(focus.event.eventId))
  }
  return (
    <section className="panel p-5" aria-label="Mission timeline" data-testid="timeline">
      <header className="flex items-center justify-between gap-3">
        <h2 className="label">Mission timeline</h2>
        <span className="text-[11.5px] text-ink-3">{items.length ? `Recorded steps · ${utcStamp(items[0].at).slice(0, 10)}` : ''}</span>
      </header>
      {items.length ? (
        <ol className="mt-5 flex flex-col gap-0 lg:flex-row lg:overflow-x-auto lg:pb-1">
          {items.map((i, idx) => {
            const sym = i.kind === 'SYMPTOM' ? symptomFor(i.at) : null
            const linked = sym ? symptomRegion(sym) : null
            const active = linked !== null && linked === selectedRegion
            return (
              <li key={`${i.kind}-${idx}`} className="relative flex min-w-0 flex-1 lg:min-w-[128px]">
                <button
                  className={`group flex w-full gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-raised/60 lg:flex-col lg:gap-2 ${active ? 'bg-coral/[0.08]' : ''}`}
                  onClick={() => act(i)}
                  data-testid={`tl-${i.kind}`}
                >
                  <span className="relative flex shrink-0 items-center lg:w-full">
                    <span className={`relative z-10 h-2.5 w-2.5 rounded-full ring-4 ring-panel ${TL_TONE[i.tone]} ${active ? 'pulse-dot' : ''}`} aria-hidden />
                    {idx < items.length - 1 && <span className="absolute top-1/2 left-2.5 hidden h-px w-[calc(100%+16px)] bg-line lg:block" aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] text-ink-3 tnum">{utcTime(i.at).replace(' UTC', 'Z')}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug font-semibold text-ink group-hover:text-white">{i.label}</span>
                    {i.detail && <span className="mt-0.5 block truncate text-[11px] text-ink-3">{i.detail}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">No recorded activity for this crew member.</p>
      )}
      {ds && focus.event && <p className="mt-3 text-[11.5px] text-ink-3">Select a step to open its source: phases open the session readings, the symptom highlights the body map, alert steps open the event.</p>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Event queue

function EventQueue({ ds, focusId }: { ds: Dataset; focusId: string | null }) {
  const events = sortEvents(Object.values(ds.events))
  const open = events.filter(isOpen).length
  return (
    <section className="panel p-5" aria-label="Health event queue">
      <header className="flex items-center justify-between gap-3">
        <h2 className="label">Health event queue</h2>
        <span className="flex items-center gap-3">
          <Pill tone={open ? 'coral' : 'muted'}>{open} open</Pill>
          <a href={href.events} className="text-[12px] text-ink-2 hover:text-ink">
            Full history →
          </a>
        </span>
      </header>
      <div className="mt-3 hidden grid-cols-[14px_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto] gap-x-4 px-2 pb-2 lg:grid">
        {['', 'Event', 'Crew', 'Created', 'Reason', 'On the watch', 'Review', 'Status'].map((h, i) => (
          <span key={i} className="micro">
            {h}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-hair" data-testid="event-feed">
        {events.slice(0, 8).map((e) => {
          const cat = CATEGORY_META[e.category]
          const st = STATUS_META[e.status]
          const ack = ackLabel(e)
          const rv = REVIEW_META[e.review.state]
          return (
            <li key={e.eventId}>
              <a
                href={href.event(e.eventId)}
                data-testid={`event-row-${e.eventId}`}
                className={`grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-raised/60 lg:grid-cols-[14px_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_auto] ${e.eventId === focusId ? 'bg-raised/40' : ''}`}
              >
                <span className={`h-2 w-2 rounded-full ${isOpen(e) ? TONE[cat.tone].dot : 'bg-ink-3'} ${isOpen(e) && e.eventId === focusId ? 'pulse-dot' : ''}`} aria-hidden />
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`truncate text-[12.5px] font-semibold ${isOpen(e) ? 'text-ink' : 'text-ink-2'}`}>{cat.label}</span>
                  {e.isSimulated && <SimTag />}
                </span>
                <span className="hidden truncate text-[12px] text-ink-2 lg:block">{subjectLabel(e.subjectId)}</span>
                <span className="hidden truncate text-[12px] text-ink-2 tnum lg:block">{utcStamp(e.createdAt).slice(5)}</span>
                <span className="hidden truncate font-mono text-[11px] text-ink-3 lg:block">{e.reasonCodes.join(', ')}</span>
                <span className={`hidden truncate text-[12px] lg:block ${TONE[ack.tone].text}`}>{ack.text}</span>
                <span className={`hidden truncate text-[12px] lg:block ${TONE[rv.tone].text}`}>{rv.label}</span>
                <Pill tone={st.tone} className="shrink-0">
                  {st.label}
                </Pill>
                <span className="col-span-2 col-start-2 truncate text-[11.5px] text-ink-3 tnum lg:hidden">
                  {subjectLabel(e.subjectId)} · {utcStamp(e.createdAt).slice(5)} · {ack.text}
                </span>
              </a>
            </li>
          )
        })}
        {!events.length && <li className="py-3 text-[13px] text-ink-3">No events recorded.</li>}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Empty states

function EmptyWorkspace() {
  const { workspace, setWorkspace, actions } = useData()
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-12">
      <div>
        <div className="eyebrow">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'}</div>
        <h1 className="display mt-3 text-[40px] text-ink">MISSION HEALTH</h1>
        <p className="mt-3 text-[15px] text-ink-2">Onboard health monitoring and evidence review.</p>
      </div>
      {workspace === 'mission' ? (
        <Empty
          title="No mission records yet"
          action={
            <div className="flex flex-wrap gap-3">
              <a className="btn btn-primary" href={href.system}>
                <FileUp size={15} /> Connect or import a watch
              </a>
              <button className="btn btn-sim" onClick={() => setWorkspace('demo')}>
                <FlaskConical size={15} /> Open simulated demo
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
              <FlaskConical size={15} /> Load simulated scenarios
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
  if (Object.keys(ds.sessions).length + Object.keys(ds.events).length === 0) return <EmptyWorkspace />

  const focus = resolveFocus(ds, subjectId, scenarioId)
  const session = focus.session
  const openAll = sortEvents(Object.values(ds.events)).filter(isOpen)
  const otherOpen = openAll.filter((e) => e.eventId !== focus.event?.eventId).length
  const c = session ? comparePhases(session) : null
  const hrCount = session ? session.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const sessionMode = session ? recordSourceMode(session, session.provenance.deviceId ? (snapshot.links[session.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED') : null

  return (
    <div className="flex flex-col gap-5">
      {/* Hero */}
      <section className="grid gap-5 lg:grid-cols-12">
        <div className="rise flex flex-col justify-between gap-6 lg:col-span-5">
          <div>
            <div className="eyebrow">
              Mission overview · {focus.subjectId ? subjectLabel(focus.subjectId) : 'no crew selected'}
              {focus.scenario && <span className="text-violet"> · scenario {focus.scenario.id}</span>}
            </div>
            <h1 className="display mt-3 text-[clamp(34px,4.2vw,52px)] text-ink">MISSION HEALTH</h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">Onboard health monitoring and evidence review.</p>
          </div>
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="micro">Profile</dt>
              <dd className="mt-1 text-[13px] text-ink">Gravity recovery</dd>
            </div>
            <div>
              <dt className="micro">Latest check</dt>
              <dd className="mt-1 text-[13px] text-ink tnum">{session ? utcStamp(session.startedAt).slice(5, 16) + 'Z' : '--'}</dd>
            </div>
            <div>
              <dt className="micro">Mode</dt>
              <dd className={`mt-1 text-[13px] ${workspace === 'demo' ? 'text-violet' : 'text-ink'}`}>{workspace === 'demo' ? 'Simulated demo' : (sessionMode ?? 'No records')}</dd>
            </div>
          </dl>
          {workspace === 'demo' && <TriggerButton />}
        </div>
        <div className="lg:col-span-7">
          <ReviewFocus ds={ds} focus={focus} otherOpen={otherOpen} nowIso={snapshot.serverTime} />
        </div>
      </section>

      {/* Crew stage and telemetry */}
      <section className="grid gap-5 xl:grid-cols-12">
        <div className="panel-quiet ticks flex flex-col p-5 xl:col-span-7" aria-label="Active crew health">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="label">Active crew health</h2>
            <span className="flex items-center gap-2 text-[12px] text-ink-2">
              {focus.subjectId ? subjectLabel(focus.subjectId) : '--'}
              {session?.isSimulated && <SimTag />}
            </span>
          </header>
          <div className="mt-2">
            <CrewReport ds={ds} session={session} subjectId={focus.subjectId} selected={region} onSelect={setRegion} />
          </div>
          <div className="rule mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-3 text-[11.5px] text-ink-3" data-testid="provenance">
            <span className="eyebrow">Sensor provenance</span>
            {session ? (
              <>
                <span>
                  {session.measurements[0]?.source.device ?? session.provenance.deviceId ?? 'Unknown device'} · <span className={session.isSimulated ? 'text-violet' : 'text-ink-2'}>{sessionMode}</span>
                </span>
                <span className="tnum">
                  {plural(hrCount, 'heart-rate reading')}, {c ? c.rest.valid.length + c.recovery.valid.length : 0} valid
                </span>
                <span className="tnum">Received {session.provenance.receivedAt ? utcStamp(session.provenance.receivedAt).slice(5) : '--'}</span>
                <a className="ml-auto text-ink-2 hover:text-ink" href={href.session(session.sessionId)}>
                  Session readings →
                </a>
              </>
            ) : (
              <span>No session recorded for this crew member.</span>
            )}
          </div>
        </div>
        <div className="xl:col-span-5">
          <Telemetry ds={ds} focus={focus} nowMs={nowMs} />
        </div>
      </section>

      <MissionTimeline focus={focus} ds={ds} onSymptom={(r) => setRegion(r)} selectedRegion={region} />
      <EventQueue ds={ds} focusId={focus.event?.eventId ?? null} />
    </div>
  )
}
