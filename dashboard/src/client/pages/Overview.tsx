import { ArrowRight, CheckCircle2, FileUp, FlaskConical, Radio, Search, X } from 'lucide-react'
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { comparePhases, externalReadingFindings, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { buildEventContext, eventTitle, focusLabel, reasonLine, ringMetrics, timelineFor, type TimelineItem } from '../../shared/explain'
import { ago, plural, signed, SYMPTOM_NOUN, utcStamp, utcTime } from '../../shared/format'
import type { WatchLinkSnapshot } from '../../shared/watch-link'
import { EvidenceList, KindMark } from '../components/Astronaut'
import { BodyMap } from '../components/BodyMap'
import { ackLabel } from '../components/Events'
import { BarRow, Dial, DottedColumns, RingGauge, type ColumnDatum } from '../components/Gauge'
import { CornerLink, Empty, Panel, Pill, SimTag, TONE } from '../components/ui'
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
    <div className="well px-4 py-3.5" data-testid="region-detail">
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

/** The astronaut evidence map with its findings and detail. Selection can be driven from outside. */
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

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// ---------------------------------------------------------------------------
// The review focus strip

function ReviewFocus({ ds, focus, otherOpen, nowIso }: { ds: Dataset; focus: Focus; otherOpen: number; nowIso: string }) {
  const e = focus.event
  if (!e) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4" data-testid="hero-alert">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-mint" size={18} />
          <div>
            <div className="text-[13.5px] font-semibold text-ink">No review event</div>
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
    <div className={`panel overflow-hidden ${open ? t.border : ''}`} data-testid="hero-alert" style={open ? { boxShadow: `0 0 0 1px color-mix(in oklab, ${t.stroke} 18%, transparent), 0 18px 50px -30px ${t.stroke}` } : undefined}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <span className={`rounded-full px-3 py-[5px] text-[11px] font-bold tracking-[0.08em] ${t.solid}`} data-testid="focus-label">
            {focusLabel(e)}
          </span>
          {e.isSimulated && <SimTag />}
          <h2 className="display text-[18px] text-ink">{eventTitle(ctx)}</h2>
          <span className="text-[14px] text-ink-2">
            <span className="hidden text-ink-3 sm:inline">· </span>
            <span data-testid="focus-reason">{reasonLine(ctx)}</span>
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-7 gap-y-1.5">
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
        <div className="flex items-center gap-2">
          {otherOpen > 0 && (
            <a className="btn btn-ghost btn-sm" href={href.events}>
              {plural(otherOpen, 'other open event')}
            </a>
          )}
          <CornerLink href={href.event(e.eventId)} label="Open this event's evidence" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-1.5 text-[11px] text-ink-3">
        <span className="tnum">{e.eventId}</span>
        <span className="hidden sm:inline">A review records that someone looked at the evidence. It is not a diagnosis.</span>
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

function useTelemetry(ds: Dataset, focus: Focus, nowMs: number) {
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
  return { s, e, rings, hr, recent, c, recorded, valid, check, steps, excluded, extFlags, device, link, latestSession }
}

type Telemetry = ReturnType<typeof useTelemetry>

/** Left column: the latest heart rate on a dial, with this check's phase medians. */
function HeartRateCard({ t }: { t: Telemetry }) {
  const { hr, recent, c, s } = t
  return (
    <Panel title="Heart rate" meta={hr ? <Pill tone={recent ? hr.modeTone : 'muted'}>{recent ? hr.mode : 'No recent data'}</Pill> : undefined} bodyClassName="px-5 pt-1 pb-5">
      <div data-testid="strip-hr" className="flex flex-col items-center">
        <Dial
          value={hr ? hr.value : null}
          min={40}
          max={180}
          majorStep={20}
          unit="bpm"
          tone={hr && recent ? 'cyan' : 'muted'}
          label={hr ? (recent ? 'Latest heart rate' : 'Last recorded heart rate') : 'Latest heart rate'}
          unavailable="No valid reading"
          caption={hr ? `${utcStamp(hr.at).slice(5)} · ${hr.source} · ${hr.mode}` : 'No valid heart-rate reading on record'}
          size={176}
        />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-4 text-center">
        <div>
          <dt className="micro">Rest median</dt>
          <dd className="figure mt-1 text-[18px] text-ink">{c?.restMedian ?? '--'}</dd>
        </div>
        <div>
          <dt className="micro">Recovery</dt>
          <dd className="figure mt-1 text-[18px] text-ink">{c?.recoveryMedian ?? '--'}</dd>
        </div>
        <div>
          <dt className="micro">Difference</dt>
          <dd className="figure mt-1 text-[18px] text-ink">{c?.observedDelta != null ? signed(c.observedDelta) : '--'}</dd>
        </div>
      </dl>
      <p className="mt-2 text-center text-[11px] text-ink-3">{s ? 'bpm, this check · descriptive, not a clinical threshold' : 'No check recorded'}</p>
    </Panel>
  )
}

/** Left column: the three ratios that are fully explained by their counts. */
function ChecksCard({ t }: { t: Telemetry }) {
  return (
    <Panel title="Record checks" bodyClassName="px-4 pt-1 pb-5">
      <div className="grid grid-cols-3 gap-1">
        <RingGauge value={t.rings.completeness} tone="mint" label="Protocol" caption="Steps in the record" unavailable="No check recorded" size={86} />
        <RingGauge value={t.rings.coverage} tone="cyan" label="HR coverage" caption="10 s intervals with a reading" unavailable="Phase times incomplete" size={86} />
        <RingGauge value={t.rings.review} tone="neutral" label="Review" caption={`Checklist items, v${REVIEW_CHECKLIST.version}`} unavailable="No event to review" size={86} />
      </div>
    </Panel>
  )
}

function Readout({ label, value, detail, tone, testId }: { label: string; value: string; detail: string; tone?: Tone; testId?: string }) {
  const color = !tone || tone === 'neutral' ? 'text-ink' : tone === 'muted' ? 'text-ink-3' : TONE[tone].text
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2" data-testid={testId}>
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className={`text-right text-[13px] font-semibold ${color}`}>{value}</span>
      <span className="col-span-2 truncate text-[11px] text-ink-3" title={detail}>
        {detail}
      </span>
    </div>
  )
}

/** Bottom row: readings as glowing line bars, then the status readouts. */
function ReadingsCard({ t, nowMs }: { t: Telemetry; nowMs: number }) {
  const { s, e, c, recorded, valid, check, steps, excluded, extFlags, device, link, latestSession } = t
  const phase = (p: NonNullable<typeof c>['rest']) => {
    const n = p.valid.length + p.excluded.length
    return { n, v: p.valid.length, f: n ? p.valid.length / n : null }
  }
  const rest = c ? phase(c.rest) : null
  const rec = c ? phase(c.recovery) : null
  return (
    <section className="panel flex min-w-0 flex-col" aria-label="Mission telemetry" data-testid="telemetry">
      <header className="pane-head">
        <h2 className="label">Readings</h2>
        {s && <CornerLink href={href.session(s.sessionId)} label="Open the session readings" />}
      </header>
      <div className="flex flex-1 flex-col gap-4 px-5 pt-2 pb-4" data-testid="measurement-strip">
        <BarRow label="Valid heart-rate readings" value={s ? `${valid} / ${recorded}` : '--'} fraction={s && recorded ? valid / recorded : null} tone="cyan" />
        <BarRow label="Rest phase, valid" value={rest ? `${rest.v} / ${rest.n}` : '--'} fraction={rest?.f ?? null} tone="cyan" />
        <BarRow label="Recovery phase, valid" value={rec ? `${rec.v} / ${rec.n}` : '--'} fraction={rec?.f ?? null} tone="cyan" />
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          <Readout
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
          <Readout testId="strip-check" label="Session progress" value={check.value} detail={steps ? `${steps.done} of ${steps.total} protocol steps · ${check.sub}` : check.sub} tone={s ? 'mint' : 'muted'} />
          <Readout
            label="Review state"
            value={e ? REVIEW_META[e.review.state].label : '--'}
            detail={e ? (e.review.reviewer ? `Reviewer: ${e.review.reviewer}` : `${STATUS_META[e.status].label} · ${ackLabel(e).text}`) : 'No event for this check'}
            tone={e ? REVIEW_META[e.review.state].tone : 'muted'}
          />
          <Readout
            label="Last assessment"
            value={latestSession ? utcStamp(latestSession.startedAt).slice(5, 16) + 'Z' : '--'}
            detail={latestSession ? `${latestSession.summary ? `Watch summary: ${latestSession.summary.status.replace(/_/g, ' ').toLowerCase()}` : 'No watch summary'} · ${ago(latestSession.startedAt, nowMs)}` : 'No assessment recorded'}
          />
          <Readout
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

/** Bottom row: recovery minus rest for each recorded check of this crew member, oldest first. */
function RecoveryColumns({ ds, focus }: { ds: Dataset; focus: Focus }) {
  const sessions = sessionsOf(ds, focus.subjectId).slice(0, 6).reverse()
  const rows = sessions.map((s) => ({ s, d: comparePhases(s).observedDelta }))
  const max = Math.max(10, ...rows.map((r) => r.d ?? 0))
  const data: ColumnDatum[] = rows.map(({ s, d }) => ({
    key: s.sessionId,
    label: shortDate(s.startedAt),
    value: d,
    display: d === null ? '--' : signed(d),
    tone: s.symptoms.length ? 'coral' : 'cyan',
    current: s.sessionId === focus.session?.sessionId,
    href: href.session(s.sessionId),
  }))
  return (
    <Panel title="Recovery − rest by session" href={href.crew} hrefLabel="Open recovery history" bodyClassName="px-5 pt-1 pb-5">
      {data.length ? (
        <>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="figure text-[30px] text-ink">{rows.at(-1)?.d != null ? signed(rows.at(-1)!.d!) : '--'}</span>
            <span className="text-[12px] text-ink-3">bpm, latest check · {plural(rows.length, 'check')}</span>
          </div>
          <DottedColumns data={data} max={max} height={128} ariaLabel={`Recovery minus rest heart rate for ${plural(rows.length, 'check')}`} />
          <p className="mt-3 text-[11px] text-ink-3">Coral: a symptom was reported in that check. "--": too few readings to compare.</p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-3">No recorded checks for this crew member.</p>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Mission timeline, in the reference's "Releases" style

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
    <section className="panel flex min-w-0 flex-col" aria-label="Mission timeline" data-testid="timeline">
      <header className="pane-head">
        <h2 className="label">Mission timeline</h2>
        <span className="chip tnum">{items.length ? shortDate(items[0].at) : 'No steps'}</span>
      </header>
      {items.length ? (
        <ol className="flex flex-col px-3 pt-1 pb-3">
          {items.map((i, idx) => {
            const sym = i.kind === 'SYMPTOM' ? symptomFor(i.at) : null
            const linked = sym ? symptomRegion(sym) : null
            const active = linked !== null && linked === selectedRegion
            return (
              <li key={`${i.kind}-${idx}`} className="relative">
                {idx < items.length - 1 && <span className="absolute top-[24px] bottom-[-12px] left-[87px] w-px bg-white/[0.08]" aria-hidden />}
                <button
                  className={`grid w-full grid-cols-[64px_12px_minmax(0,1fr)] items-start gap-x-3 rounded-[12px] px-2 py-[7px] text-left transition-colors hover:bg-white/[0.04] ${active ? 'bg-cyan/[0.08]' : ''}`}
                  onClick={() => act(i)}
                  data-testid={`tl-${i.kind}`}
                >
                  <span className="chip h-[22px] justify-center px-1.5 text-[10.5px] tnum">{utcTime(i.at).replace(' UTC', '').slice(0, 8)}</span>
                  <span className={`mt-[7px] h-2 w-2 rounded-full ${TL_TONE[i.tone]}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{i.label}</span>
                    {i.detail && <span className="block truncate text-[11px] text-ink-3">{i.detail}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="px-5 pb-4 text-[13px] text-ink-3">No recorded activity for this crew member.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Search over the records (not an assistant: it matches text in the stored events)

function RecordSearch({ ds }: { ds: Dataset }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return sortEvents(Object.values(ds.events))
      .filter((e) =>
        [e.eventId, e.sessionId ?? '', subjectLabel(e.subjectId), CATEGORY_META[e.category].label, STATUS_META[e.status].label, ORIGIN_LABEL[e.origin.kind], ...e.reasonCodes].some((f) => f.toLowerCase().includes(needle)),
      )
      .slice(0, 6)
  }, [q, ds])
  const show = open && q.trim().length > 0
  return (
    <div
      ref={box}
      className="relative w-full max-w-[520px]"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div className="field flex h-11 items-center gap-2.5 rounded-full pr-2 pl-4">
        <Search size={15} className="shrink-0 text-ink-3" aria-hidden />
        <input
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
          placeholder="Search events, crew, reason codes"
          value={q}
          role="combobox"
          aria-expanded={show}
          aria-controls={`${id}-list`}
          aria-label="Search recorded events"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQ('')
              setOpen(false)
            }
            if (e.key === 'Enter' && results[0]) navigate(href.event(results[0].eventId))
          }}
        />
        {q && (
          <button className="icon-btn icon-btn-sm" onClick={() => setQ('')} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>
      {show && (
        <ul id={`${id}-list`} role="listbox" className="panel absolute inset-x-0 top-[calc(100%+8px)] z-30 overflow-hidden py-1.5">
          {results.length ? (
            results.map((e) => {
              const cat = CATEGORY_META[e.category]
              return (
                <li key={e.eventId} role="option" aria-selected={false}>
                  <a href={href.event(e.eventId)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2 hover:bg-white/[0.05]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[cat.tone].dot}`} aria-hidden />
                      <span className={`truncate text-[12.5px] font-semibold ${TONE[cat.tone].text}`}>{cat.label}</span>
                      {e.isSimulated && <SimTag />}
                      <span className="truncate text-[12px] text-ink-2">{subjectLabel(e.subjectId)}</span>
                    </span>
                    <span className="text-[11px] text-ink-3 tnum">{utcStamp(e.createdAt).slice(5)}</span>
                    <span className="col-span-2 truncate text-[11px] text-ink-3">
                      {e.eventId} · {e.reasonCodes.join(', ')}
                    </span>
                  </a>
                </li>
              )
            })
          ) : (
            <li className="px-4 py-2.5 text-[12.5px] text-ink-3">No recorded event matches “{q.trim()}”.</li>
          )}
        </ul>
      )}
    </div>
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
        <span className="flex items-center gap-2">
          <Pill tone={open ? 'coral' : 'muted'}>{open} open</Pill>
          <CornerLink href={href.events} label="Open the full event history" />
        </span>
      </header>
      <div className="overflow-x-auto px-2 pb-2">
        <table className="data-table">
          <thead>
            <tr>
              <th>Event</th>
              <th className="hidden md:table-cell">Crew</th>
              <th className="hidden md:table-cell">Created</th>
              <th className="hidden lg:table-cell">Reason</th>
              <th className="hidden lg:table-cell">On the watch</th>
              <th className="hidden xl:table-cell">Review</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody data-testid="event-feed">
            {events.slice(0, 8).map((e) => {
              const cat = CATEGORY_META[e.category]
              const st = STATUS_META[e.status]
              const ack = ackLabel(e)
              const rv = REVIEW_META[e.review.state]
              return (
                <tr key={e.eventId} className="row-link" data-selected={e.eventId === focusId} onClick={() => navigate(href.event(e.eventId))}>
                  <td>
                    <a href={href.event(e.eventId)} data-testid={`event-row-${e.eventId}`} className="flex min-w-0 items-center gap-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${isOpen(e) ? TONE[cat.tone].dot : 'bg-ink-3'}`} aria-hidden />
                      <span className={`truncate text-[12.5px] font-semibold ${isOpen(e) ? 'text-ink' : 'text-ink-2'}`}>{cat.label}</span>
                      {e.isSimulated && <SimTag />}
                    </a>
                    <span className="mt-0.5 block truncate pl-[18px] text-[11px] text-ink-3 md:hidden">
                      {subjectLabel(e.subjectId)} · {utcStamp(e.createdAt).slice(5)} · {ack.text}
                    </span>
                  </td>
                  <td className="hidden text-ink-2 md:table-cell">{subjectLabel(e.subjectId)}</td>
                  <td className="hidden text-ink-2 tnum md:table-cell">{utcStamp(e.createdAt).slice(5)}</td>
                  <td className="hidden max-w-[260px] truncate text-[11.5px] text-ink-3 lg:table-cell">{e.reasonCodes.join(', ')}</td>
                  <td className={`hidden max-w-[240px] truncate lg:table-cell ${TONE[ack.tone].text}`}>{ack.text}</td>
                  <td className={`hidden xl:table-cell ${TONE[rv.tone].text}`}>{rv.label}</td>
                  <td>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </td>
                </tr>
              )
            })}
            {!events.length && (
              <tr>
                <td colSpan={7} className="text-ink-3">
                  No events recorded.
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
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
      <div>
        <h1 className="display text-[28px] text-ink">Mission health</h1>
        <p className="mt-1 text-[12.5px] text-ink-2">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'} · onboard health monitoring and evidence review</p>
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

function Provenance({ session, mode, hrCount, validCount }: { session: StoredSession | null; mode: string | null; hrCount: number; validCount: number }) {
  return (
    <Panel title="Sensor provenance" href={session ? href.session(session.sessionId) : undefined} hrefLabel="Open the session readings" bodyClassName="px-5 pt-1 pb-5">
      <div className="flex flex-col gap-2 text-[12px]" data-testid="provenance">
        {session ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-3">Device</span>
              <span className="truncate text-right text-ink">{session.measurements[0]?.source.device ?? session.provenance.deviceId ?? 'Unknown device'}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-3">Source</span>
              <span className={session.isSimulated ? 'text-violet' : 'text-ink'}>{mode}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-3">Readings</span>
              <span className="text-ink tnum">
                {plural(hrCount, 'heart-rate reading')}, {validCount} valid
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-3">Received</span>
              <span className="text-ink tnum">{session.provenance.receivedAt ? utcStamp(session.provenance.receivedAt).slice(5) : '--'}</span>
            </div>
            <a className="mt-1 self-start text-[12px] text-cyan hover:underline" href={href.session(session.sessionId)}>
              Session readings
            </a>
          </>
        ) : (
          <span className="text-ink-3">No session recorded for this crew member.</span>
        )}
      </div>
    </Panel>
  )
}

function Hero({ children, action, search }: { children: ReactNode; action: ReactNode; search: ReactNode }) {
  return (
    <div className="relative flex min-w-0 flex-col items-center">
      {/* a cold glow and a horizon arc behind the figure, static, clipped to the hero */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-x-0 top-[6%] h-[78%] bg-[radial-gradient(closest-side,rgb(70_140_255/0.16),rgb(70_140_255/0.05)_55%,transparent)]" />
        <div
          className="absolute inset-x-[2%] top-[56%] h-[46%] rounded-[50%] border-t border-cyan/30 [mask-image:linear-gradient(90deg,transparent,black_22%,black_78%,transparent)]"
          style={{ boxShadow: 'inset 0 18px 40px -26px rgb(124 200 255 / 0.5)' }}
        />
      </div>
      <div className="relative w-full">{children}</div>
      <div className="relative mt-2 flex w-full flex-col items-center gap-4">
        {action}
        {search}
      </div>
    </div>
  )
}

export function Overview() {
  const { snapshot, workspace, subjectId, scenarioId } = useData()
  const nowMs = useNow(5000)
  const [region, setRegion] = useState<Region | null>(null)
  if (!snapshot) return null
  const ds = snapshot.dataset
  if (Object.keys(ds.sessions).length + Object.keys(ds.events).length === 0) return <EmptyWorkspace />
  return <Dashboard ds={ds} nowMs={nowMs} region={region} setRegion={setRegion} workspace={workspace} subjectId={subjectId} scenarioId={scenarioId} serverTime={snapshot.serverTime} links={snapshot.links} />
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
  links,
}: {
  ds: Dataset
  nowMs: number
  region: Region | null
  setRegion: (r: Region | null) => void
  workspace: string
  subjectId: string | null
  scenarioId: string | null
  serverTime: string
  links: Record<string, LinkState>
}) {
  const focus = resolveFocus(ds, subjectId, scenarioId)
  const session = focus.session
  const t = useTelemetry(ds, focus, nowMs)
  const openAll = sortEvents(Object.values(ds.events)).filter(isOpen)
  const otherOpen = openAll.filter((e) => e.eventId !== focus.event?.eventId).length
  const hrCount = session ? session.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const sessionMode = session ? recordSourceMode(session, session.provenance.deviceId ? (links[session.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED') : null
  const regions = regionsFor(session, session ? linkedReadings(ds, session.sessionId) : [])
  const crew = focus.subjectId ? subjectLabel(focus.subjectId) : null

  const heroAction = focus.event ? (
    <a className="btn btn-hero" href={href.event(focus.event.eventId)} data-testid="open-evidence">
      Open evidence <ArrowRight size={15} />
    </a>
  ) : session ? (
    <a className="btn btn-hero" href={href.session(session.sessionId)}>
      Session readings <ArrowRight size={15} />
    </a>
  ) : null

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">Mission overview</div>
          <h1 className="display text-[28px] text-ink">Mission health</h1>
          <p className="mt-1 text-[12.5px] text-ink-2">
            {crew ?? 'No crew selected'} · gravity recovery check · latest {session ? utcStamp(session.startedAt).slice(5, 16) + 'Z' : '--'} ·{' '}
            <span className={workspace === 'demo' ? 'text-violet' : 'text-ink'}>{workspace === 'demo' ? 'simulated demo' : (sessionMode ?? 'no records')}</span>
            {focus.scenario && <span className="text-violet"> · scenario {focus.scenario.id}</span>}
          </p>
        </div>
        {workspace === 'demo' && <TriggerButton />}
      </header>

      <ReviewFocus ds={ds} focus={focus} otherOpen={otherOpen} nowIso={serverTime} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,330px)_minmax(0,1fr)_minmax(0,350px)]">
        <div className="xl:col-start-2 xl:row-start-1">
          <Hero action={heroAction} search={<RecordSearch ds={ds} />}>
            <div className="mb-1 flex items-center justify-center gap-2 text-[12px] text-ink-3">
              <span>Body evidence map</span>
              <span aria-hidden>·</span>
              <span className="text-ink-2">{crew ?? '--'}</span>
              {session?.isSimulated && <SimTag />}
            </div>
            <BodyMap regions={regions} selected={region} onSelect={setRegion} label={`Evidence map for ${crew ?? 'crew member'}`} size="hero" />
          </Hero>
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-3 xl:row-start-1">
          <Panel title="Recorded evidence" meta={crew ? <span className="flex items-center gap-2 text-[12px] text-ink-2">{crew}{session?.isSimulated && <SimTag />}</span> : undefined} bodyClassName="flex flex-col gap-3 px-4 pt-1 pb-4">
            <EvidenceList regions={regions} selected={region} onSelect={setRegion} title={null} />
            <RegionDetail info={region ? regions[region] : null} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
          </Panel>
          <Provenance session={session} mode={sessionMode} hrCount={hrCount} validCount={t.valid} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-1">
          <HeartRateCard t={t} />
          <ChecksCard t={t} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <RecoveryColumns ds={ds} focus={focus} />
        <MissionTimeline focus={focus} onSymptom={(r) => setRegion(r)} selectedRegion={region} />
        <ReadingsCard t={t} nowMs={nowMs} />
      </section>

      <EventQueue ds={ds} focusId={focus.event?.eventId ?? null} />
    </div>
  )
}
