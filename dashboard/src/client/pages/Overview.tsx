import { ArrowRight, CheckCircle2, FileUp, FlaskConical, Radio } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { comparePhases, externalReadingFindings, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { buildEventContext, eventTitle, focusLabel, reasonLine, ringMetrics, timelineFor, type TimelineItem } from '../../shared/explain'
import { ago, plural, SYMPTOM_NOUN, utcStamp, utcTime } from '../../shared/format'
import type { WatchLinkSnapshot } from '../../shared/watch-link'
import { EvidenceList, KindMark } from '../components/Astronaut'
import { BodyMap } from '../components/BodyMap'
import { ackLabel } from '../components/Events'
import { MeterBar, meterLabel, type RingValue } from '../components/Ring'
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

const LEGEND: { state: RegionInfo['state']; label: string; tone: Tone }[] = [
  { state: 'symptom', label: 'Reported symptom', tone: 'coral' },
  { state: 'data', label: 'Measured evidence', tone: 'cyan' },
  { state: 'caution', label: 'Check the source', tone: 'amber' },
  { state: 'neutral', label: 'No evidence', tone: 'muted' },
]

export function RegionDetail({ info, unplaced }: { info: RegionInfo | null; unplaced: string[] }) {
  return (
    <div className="well px-3.5 py-3" data-testid="region-detail">
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-ink">{info.name}</div>
            <Pill tone={LEGEND.find((l) => l.state === info.state)!.tone}>{LEGEND.find((l) => l.state === info.state)!.label}</Pill>
          </div>
          {info.items.length ? (
            <ul className="mt-2.5 space-y-2">
              {info.items.map((it, i) => (
                <li key={i}>
                  <div className={`text-[12px] font-semibold ${TONE[it.tone].text}`}>{it.title}</div>
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
          <div className="text-[12.5px] text-ink-2">Select a region for the record behind it. Markers show where evidence was recorded, not a diagnosis.</div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {LEGEND.map((l) => (
              <span key={l.state} className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                <KindMark state={l.state} />
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
    <div className="@container flex flex-col gap-3">
      <div className="grid items-start gap-x-4 gap-y-3 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className={`mx-auto w-full ${compact ? 'max-w-[200px]' : 'max-w-[250px]'}`}>
          <BodyMap regions={regions} selected={selected} onSelect={select} label={`Evidence map for ${subjectId ? subjectLabel(subjectId) : 'crew member'}`} size={compact ? 'compact' : 'hero'} />
        </div>
        <EvidenceList regions={regions} selected={selected} onSelect={select} />
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
        <Radio size={14} /> Trigger simulated watch event
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
      <div className="panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5" data-testid="hero-alert">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-mint" size={18} />
          <div>
            <div className="text-[13px] font-semibold text-ink">No review event</div>
            <p className="mt-0.5 max-w-[80ch] text-[12.5px] text-ink-2">
              {focus.scenario
                ? `${focus.scenario.title}. ${focus.scenario.summary}`
                : `No open review event for ${focus.subjectId ? subjectLabel(focus.subjectId) : 'this crew member'}. A review records that someone looked at the evidence; it is not a medical clearance.`}
            </p>
          </div>
        </div>
        {otherOpen > 0 && (
          <a className="btn btn-ghost btn-sm" href={href.events}>
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
    <div className={`panel overflow-hidden ${open ? t.border : ''}`} data-testid="hero-alert">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className={`rounded-[3px] px-2 py-[3px] text-[11.5px] font-bold tracking-[0.04em] ${t.solid}`} data-testid="focus-label">
          {focusLabel(e)}
        </span>
        {e.isSimulated && <SimTag />}
        <h2 className="text-[16px] font-semibold text-ink">{eventTitle(ctx)}</h2>
        <span className="text-[14px] text-ink-2">
          <span className="hidden text-ink-3 sm:inline">· </span>
          <span data-testid="focus-reason">{reasonLine(ctx)}</span>
        </span>
        <span className="ml-auto text-[11.5px] text-ink-3 tnum">{e.eventId}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line bg-panel-2 px-4 py-2.5">
        <dl className="flex flex-wrap gap-x-8 gap-y-1.5">
          <div>
            <dt className="micro">Created</dt>
            <dd className="text-[12.5px] text-ink tnum">{utcStamp(e.createdAt).slice(5)}</dd>
          </div>
          <div>
            <dt className="micro">Source</dt>
            <dd className="text-[12.5px] text-ink">{ORIGIN_LABEL[e.origin.kind]}</dd>
          </div>
          <div>
            <dt className="micro">On the watch</dt>
            <dd className={`text-[12.5px] ${TONE[ack.tone].text}`}>{ack.text}</dd>
          </div>
          <div>
            <dt className="micro">Review</dt>
            <dd className={`text-[12.5px] ${TONE[REVIEW_META[e.review.state].tone].text}`}>{REVIEW_META[e.review.state].label}</dd>
          </div>
        </dl>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {otherOpen > 0 && (
            <a className="btn btn-ghost btn-sm" href={href.events}>
              {plural(otherOpen, 'other open event')}
            </a>
          )}
          <a className={`btn btn-sm ${tone === 'coral' ? 'btn-alert' : 'btn-primary'}`} href={href.event(e.eventId)} data-testid="open-evidence">
            Open evidence <ArrowRight size={14} />
          </a>
        </div>
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

const READING_COLS = 'md:grid-cols-[148px_128px_minmax(0,1fr)]'

function ReadingRow({ label, value, detail, tone, testId, ariaLabel }: { label: string; value: string; detail: ReactNode; tone?: Tone; testId?: string; ariaLabel?: string }) {
  const color = !tone || tone === 'neutral' ? 'text-ink' : tone === 'muted' ? 'text-ink-3' : TONE[tone].text
  return (
    <div role="row" data-testid={testId} aria-label={ariaLabel} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-3 py-[7px] even:bg-panel-2/60 ${READING_COLS}`}>
      <span role="rowheader" className="text-[12.5px] text-ink-2">
        {label}
      </span>
      <span role="cell" className={`text-right text-[13.5px] font-semibold tnum md:text-left ${color}`}>
        {value}
      </span>
      <span role="cell" className="col-span-2 min-w-0 text-[11.5px] text-ink-3 md:col-span-1">
        {detail}
      </span>
    </div>
  )
}

/** A count over a thin bar, with what is being counted. */
function MeterDetail({ value, tone, caption, unavailable }: { value: RingValue | null; tone: Tone; caption: string; unavailable: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <MeterBar value={value} tone={tone} className="w-[84px] shrink-0" />
      <span className="min-w-0">{value ? caption : unavailable}</span>
    </span>
  )
}

const ratio = (v: RingValue | null) => (v ? `${v.numerator} / ${v.denominator}` : 'N/A')

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
  const sessionLink = s?.provenance.deviceId ? ((snapshot?.links[s.provenance.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const check = recoveryCheckState(s, s ? recordSourceMode(s, sessionLink) : null)
  const steps = s ? sessionCompleteness(s) : null
  const excluded = c ? [...c.rest.excluded, ...c.recovery.excluded] : []
  const extFlags = s ? externalReadingFindings(s, linkedReadings(ds, s.sessionId)).length : 0
  const device = focus.subjectId ? subjectDevice(ds, focus.subjectId) : null
  const link = device ? ((snapshot?.links[device.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const latestSession = sessionsOf(ds, focus.subjectId)[0] ?? null
  const pct = (v: RingValue | null) => (v ? ` · ${Math.round(v.fraction * 100)}%` : '')

  return (
    <section className="panel flex flex-col overflow-hidden" aria-label="Mission telemetry" data-testid="telemetry">
      <header className="pane-head">
        <h2 className="label">Mission telemetry</h2>
        <span className="text-[11.5px] text-ink-3 tnum">{s?.sessionId ?? 'no session'}</span>
      </header>
      <div role="table" aria-label="Readings and checks for this session" data-testid="measurement-strip">
        <div role="row" className={`hidden gap-x-4 border-b border-line bg-panel-2 px-3 py-1.5 md:grid ${READING_COLS}`}>
          {['Reading', 'Value', 'Detail'].map((h) => (
            <span key={h} role="columnheader" className="text-[11.5px] font-semibold text-ink-2">
              {h}
            </span>
          ))}
        </div>
        <div role="rowgroup" className="divide-y divide-hair">
          <ReadingRow
            testId="strip-hr"
            label="Latest heart rate"
            value={hr ? (recent ? `${hr.value} bpm` : 'No recent data') : '--'}
            detail={hr ? `${recent ? '' : `Last ${hr.value} bpm · `}${utcStamp(hr.at).slice(5)} · ${hr.source} · ${hr.mode}` : 'No valid heart-rate reading on record'}
            tone={hr ? (recent ? hr.modeTone : 'muted') : 'muted'}
          />
          <ReadingRow
            testId="strip-check"
            label="Session progress"
            value={check.value}
            tone={s ? 'mint' : 'muted'}
            ariaLabel={meterLabel('Protocol steps', rings.completeness, check.sub)}
            detail={<MeterDetail value={rings.completeness} tone="mint" caption={steps ? `${steps.done} of ${steps.total} protocol steps · ${check.sub}` : check.sub} unavailable={check.sub} />}
          />
          <ReadingRow
            label="HR coverage"
            value={ratio(rings.coverage)}
            tone={rings.coverage ? undefined : 'muted'}
            ariaLabel={meterLabel('HR coverage', rings.coverage, 'Phase times incomplete')}
            detail={<MeterDetail value={rings.coverage} tone="cyan" caption={`10 s intervals with a valid reading${pct(rings.coverage)}`} unavailable={s ? 'Phase times incomplete' : 'No check recorded'} />}
          />
          <ReadingRow label="Valid readings" value={s ? `${valid} / ${recorded}` : '--'} detail={s ? 'Valid of recorded heart-rate readings' : 'No check recorded'} tone={s ? undefined : 'muted'} />
          <ReadingRow
            label="Source quality"
            value={!s ? '--' : excluded.length || extFlags ? `${excluded.length + extFlags} flagged` : 'All valid'}
            detail={
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
          <ReadingRow
            label="Review state"
            value={e ? REVIEW_META[e.review.state].label : '--'}
            detail={e ? (e.review.reviewer ? `Reviewer: ${e.review.reviewer}` : `${STATUS_META[e.status].label} · ${ackLabel(e).text}`) : 'No event for this check'}
            tone={e ? REVIEW_META[e.review.state].tone : 'muted'}
          />
          <ReadingRow
            label="Review checklist"
            value={ratio(rings.review)}
            tone={rings.review ? undefined : 'muted'}
            ariaLabel={meterLabel('Review checklist', rings.review, 'No event to review')}
            detail={<MeterDetail value={rings.review} tone="neutral" caption={`Checklist items, v${REVIEW_CHECKLIST.version}${pct(rings.review)}`} unavailable="No event to review" />}
          />
          <ReadingRow
            label="Last assessment"
            value={latestSession ? utcStamp(latestSession.startedAt).slice(5, 16) + 'Z' : '--'}
            detail={latestSession ? `${latestSession.summary ? `Watch summary: ${latestSession.summary.status.replace(/_/g, ' ').toLowerCase()}` : 'No watch summary'} · ${ago(latestSession.startedAt, nowMs)}` : 'No assessment recorded'}
          />
          <ReadingRow
            label="Watch reachability"
            value={LINK_META[link].label}
            detail={device ? `${device.deviceModel ?? device.deviceId} · last contact ${ago(device.lastSeenAt, nowMs)}` : 'No watch has checked in for this crew member'}
            tone={LINK_META[link].tone}
          />
        </div>
      </div>
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

function MissionTimeline({ focus, onSymptom, selectedRegion }: { focus: Focus; onSymptom: (r: Region) => void; selectedRegion: Region | null }) {
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
    <section className="panel flex flex-1 flex-col" aria-label="Mission timeline" data-testid="timeline">
      <header className="pane-head">
        <h2 className="label">Mission timeline</h2>
        <span className="text-[11.5px] text-ink-3">{items.length ? `${utcStamp(items[0].at).slice(0, 10)} · select a step for its source` : ''}</span>
      </header>
      {items.length ? (
        <ol className="divide-y divide-hair">
          {items.map((i, idx) => {
            const sym = i.kind === 'SYMPTOM' ? symptomFor(i.at) : null
            const linked = sym ? symptomRegion(sym) : null
            const active = linked !== null && linked === selectedRegion
            return (
              <li key={`${i.kind}-${idx}`}>
                <button
                  className={`grid w-full grid-cols-[62px_8px_minmax(0,1fr)] items-center gap-x-3 px-3 py-[6px] text-left transition-colors hover:bg-panel-2 ${active ? 'bg-raised hover:bg-raised' : ''}`}
                  onClick={() => act(i)}
                  data-testid={`tl-${i.kind}`}
                >
                  <span className="text-[11.5px] text-ink-3 tnum">{utcTime(i.at).replace(' UTC', 'Z')}</span>
                  <span className={`h-2 w-2 rounded-full ${TL_TONE[i.tone]}`} aria-hidden />
                  <span className="min-w-0 md:truncate">
                    <span className="text-[12.5px] font-medium text-ink">{i.label}</span>
                    {i.detail && <span className="text-[11.5px] text-ink-3"> · {i.detail}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="px-4 py-3 text-[13px] text-ink-3">No recorded activity for this crew member.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Event queue

function EventQueue({ ds, focusId }: { ds: Dataset; focusId: string | null }) {
  const events = sortEvents(Object.values(ds.events))
  const open = events.filter(isOpen).length
  return (
    <section className="panel overflow-hidden" aria-label="Health event queue">
      <header className="pane-head">
        <h2 className="label">Health event queue</h2>
        <span className="flex items-center gap-3">
          <Pill tone={open ? 'coral' : 'muted'}>{open} open</Pill>
          <a href={href.events} className="text-[12px] text-cyan hover:underline">
            Full history
          </a>
        </span>
      </header>
      <div className="hidden grid-cols-[10px_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_160px] gap-x-4 border-b border-line bg-panel-2 px-4 py-1.5 lg:grid">
        {['', 'Event', 'Crew', 'Created', 'Reason', 'On the watch', 'Review', 'Status'].map((h, i) => (
          <span key={i} className="text-[11.5px] font-semibold text-ink-2">
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
                className={`grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2 transition-colors hover:bg-raised lg:grid-cols-[10px_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_160px] ${e.eventId === focusId ? 'bg-raised' : ''}`}
              >
                <span className={`h-2 w-2 rounded-full ${isOpen(e) ? TONE[cat.tone].dot : 'bg-ink-3'}`} aria-hidden />
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`truncate text-[12.5px] font-semibold ${isOpen(e) ? 'text-ink' : 'text-ink-2'}`}>{cat.label}</span>
                  {e.isSimulated && <SimTag />}
                </span>
                <span className="hidden truncate text-[12px] text-ink-2 lg:block">{subjectLabel(e.subjectId)}</span>
                <span className="hidden truncate text-[12px] text-ink-2 tnum lg:block">{utcStamp(e.createdAt).slice(5)}</span>
                <span className="hidden truncate text-[11.5px] text-ink-3 lg:block">{e.reasonCodes.join(', ')}</span>
                <span className={`hidden truncate text-[12px] lg:block ${TONE[ack.tone].text}`}>{ack.text}</span>
                <span className={`hidden truncate text-[12px] lg:block ${TONE[rv.tone].text}`}>{rv.label}</span>
                <Pill tone={st.tone} className="shrink-0 justify-self-start">
                  {st.label}
                </Pill>
                <span className="col-span-2 col-start-2 truncate text-[11.5px] text-ink-3 tnum lg:hidden">
                  {subjectLabel(e.subjectId)} · {utcStamp(e.createdAt).slice(5)} · {ack.text}
                </span>
              </a>
            </li>
          )
        })}
        {!events.length && <li className="px-4 py-3 text-[13px] text-ink-3">No events recorded.</li>}
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
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
      <div>
        <h1 className="display text-[20px] text-ink">Mission health</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-2">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'} · onboard health monitoring and evidence review</p>
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
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[20px] text-ink">Mission health</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            {focus.subjectId ? subjectLabel(focus.subjectId) : 'No crew selected'} · gravity recovery check · latest {session ? utcStamp(session.startedAt).slice(5, 16) + 'Z' : '--'} ·{' '}
            <span className={workspace === 'demo' ? 'text-violet' : 'text-ink'}>{workspace === 'demo' ? 'simulated demo' : (sessionMode ?? 'no records')}</span>
            {focus.scenario && <span className="text-violet"> · scenario {focus.scenario.id}</span>}
          </p>
        </div>
        {workspace === 'demo' && <TriggerButton />}
      </header>

      <ReviewFocus ds={ds} focus={focus} otherOpen={otherOpen} nowIso={snapshot.serverTime} />

      <section className="grid gap-4 xl:grid-cols-12">
        <div className="panel flex flex-col xl:col-span-5" aria-label="Active crew health">
          <header className="pane-head flex-wrap">
            <h2 className="label">Active crew health</h2>
            <span className="flex items-center gap-2 text-[12px] text-ink-2">
              {focus.subjectId ? subjectLabel(focus.subjectId) : '--'}
              {session?.isSimulated && <SimTag />}
            </span>
          </header>
          <div className="p-4">
            <CrewReport ds={ds} session={session} subjectId={focus.subjectId} selected={region} onSelect={setRegion} />
          </div>
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5 text-[11.5px] text-ink-3" data-testid="provenance">
            <span className="font-semibold text-ink-2">Sensor provenance</span>
            {session ? (
              <>
                <span>
                  {session.measurements[0]?.source.device ?? session.provenance.deviceId ?? 'Unknown device'} · <span className={session.isSimulated ? 'text-violet' : 'text-ink-2'}>{sessionMode}</span>
                </span>
                <span className="tnum">
                  {plural(hrCount, 'heart-rate reading')}, {c ? c.rest.valid.length + c.recovery.valid.length : 0} valid
                </span>
                <span className="tnum">Received {session.provenance.receivedAt ? utcStamp(session.provenance.receivedAt).slice(5) : '--'}</span>
                <a className="ml-auto text-cyan hover:underline" href={href.session(session.sessionId)}>
                  Session readings
                </a>
              </>
            ) : (
              <span>No session recorded for this crew member.</span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <Telemetry ds={ds} focus={focus} nowMs={nowMs} />
          <MissionTimeline focus={focus} onSymptom={(r) => setRegion(r)} selectedRegion={region} />
        </div>
      </section>

      <EventQueue ds={ds} focusId={focus.event?.eventId ?? null} />
    </div>
  )
}
