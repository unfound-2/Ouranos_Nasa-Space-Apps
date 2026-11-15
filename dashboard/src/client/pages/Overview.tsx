import { ArrowRight, FileUp, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { comparePhases, externalReadingFindings, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { buildEventContext, eventTitle, focusLabel, reasonLine, ringMetrics, timelineFor, type TimelineItem } from '../../shared/explain'
import { ago, plural, signed, SYMPTOM_NOUN, utcStamp, utcTime } from '../../shared/format'
import type { WatchLinkSnapshot } from '../../shared/watch-link'
import { EvidenceList, KindMark } from '../components/Astronaut'
import { BodyMap } from '../components/BodyMap'
import { ackLabel } from '../components/Events'
import { Bars, Kpi, Progress, Spark, type BarDatum } from '../components/Gauge'
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
    <div className="rounded-[8px] border border-hair bg-panel-2 px-4 py-3.5" data-testid="region-detail">
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[14px] font-medium text-ink">{info.name}</div>
            <Pill tone={LEGEND.find((l) => l.state === info.state)!.tone}>{LEGEND.find((l) => l.state === info.state)!.label}</Pill>
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
              <span key={l.state} className="flex items-center gap-2 text-[13px] text-ink-2">
                <KindMark state={l.state} />
                {l.label}
              </span>
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
        <span className="status-mark bg-violet" aria-hidden />
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
          <span className="status-mark bg-mint" aria-hidden />
          <span className="font-mono text-[12px] font-medium text-ink">NO OPEN EVENT</span>
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
        <span className={`status-mark ${TONE[tone].dot}`} aria-hidden />
        <span className="font-mono text-[12px] font-medium text-ink" data-testid="focus-label">
          {focusLabel(e)}
        </span>
        {e.isSimulated && <SimTag />}
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
          <dd className="mt-1">
            <Pill tone={ack.tone}>{ack.text}</Pill>
          </dd>
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

function KeyMetrics({ ds, focus, t }: { ds: Dataset; focus: Focus; t: Telemetry }) {
  const { hr, recent, c, steps, check, rings, e, series } = t
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
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
      <Kpi
        testId="strip-hr"
        label={hr && !recent ? 'Last recorded heart rate' : 'Latest heart rate'}
        value={hr ? hr.value : '--'}
        unit={hr ? 'bpm' : undefined}
        mark={hr ? <Pill tone={recent ? hr.modeTone : 'muted'}>{recent ? hr.mode : 'No recent data'}</Pill> : undefined}
        sub={hr ? `${utcStamp(hr.at).slice(5)} · ${hr.source}` : 'No valid heart-rate reading on record'}
      >
        <Spark data={series} tone="cyan" ariaLabel={`Valid heart-rate readings in this check: ${series.length}`} />
      </Kpi>
      <Kpi
        label="Recovery − rest"
        value={c?.observedDelta != null ? signed(c.observedDelta) : '--'}
        unit={c?.observedDelta != null ? 'bpm' : undefined}
        sub={c?.observedDelta != null ? `This check · medians ${c.recoveryMedian} and ${c.restMedian}` : 'Too few readings in this check'}
        mark={<CornerLink href={href.crew} label="Open recovery history" />}
      >
        <Bars data={bars} height={96} ariaLabel={`Recovery minus rest for the last ${plural(bars.length, 'check')}`} onSelect={(d) => d.href && navigate(d.href)} />
      </Kpi>
      <Kpi label="Protocol steps" value={steps ? `${steps.done} / ${steps.total}` : '--'} sub={steps ? `${check.value} · ${check.sub}` : check.sub}>
        <Progress value={rings.completeness} tone="mint" label="Protocol steps in the record" />
      </Kpi>
      <Kpi label="Review checklist" value={rings.review ? `${rings.review.numerator} / ${rings.review.denominator}` : '--'} sub={e ? `${REVIEW_META[e.review.state].label} · checklist v${REVIEW_CHECKLIST.version}` : 'No event to review'}>
        <Progress value={rings.review} tone="neutral" label="Review checklist items" />
      </Kpi>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 3. Timeline

const TL_MARK: Record<TimelineItem['tone'], string> = {
  neutral: 'bg-line-strong',
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
        <span className="font-mono text-[12px] text-ink-3">{items.length ? `${utcStamp(items[0].at).slice(0, 10)} UTC` : ''}</span>
      </header>
      {items.length ? (
        <ol className="flex flex-col px-2 pb-3">
          {items.map((i, idx) => {
            const sym = i.kind === 'SYMPTOM' ? symptomFor(i.at) : null
            const linked = sym ? symptomRegion(sym) : null
            const active = linked !== null && linked === selectedRegion
            return (
              <li key={`${i.kind}-${idx}`}>
                <button
                  className={`grid w-full grid-cols-[72px_10px_minmax(0,1fr)] items-baseline gap-x-3 rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-panel-2 ${active ? 'bg-raised' : ''}`}
                  onClick={() => act(i)}
                  data-testid={`tl-${i.kind}`}
                >
                  <span className="font-mono text-[12px] text-ink-3">{utcTime(i.at).replace(' UTC', '')}</span>
                  <span className={`status-mark ${TL_MARK[i.tone]}`} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-[14px] text-ink">{i.label}</span>
                    {i.detail && <span className="block truncate text-[13px] text-ink-2">{i.detail}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="px-5 pb-5 text-[14px] text-ink-2">No recorded activity for this crew member.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 4. Record details: every reading, its quality and where it came from

function Row({ label, value, detail, testId }: { label: string; value: ReactNode; detail?: string; testId?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-hair px-5 py-3 last:border-b-0" data-testid={testId}>
      <span className="text-[14px] text-ink-2">{label}</span>
      <span className="text-right text-[14px] text-ink tnum">{value}</span>
      {detail && (
        <span className="col-span-2 mt-0.5 truncate text-[13px] text-ink-3" title={detail}>
          {detail}
        </span>
      )}
    </div>
  )
}

function RecordDetails({ t, nowMs, session, mode, hrCount }: { t: Telemetry; nowMs: number; session: StoredSession | null; mode: string | null; hrCount: number }) {
  const { s, e, rings, c, recorded, valid, check, steps, excluded, extFlags, device, link, latestSession } = t
  const phase = (p: NonNullable<typeof c>['rest']) => `${p.valid.length} / ${p.valid.length + p.excluded.length}`
  return (
    <section className="panel min-w-0" aria-label="Mission telemetry" data-testid="telemetry">
      <header className="pane-head">
        <h2 className="label">Record details</h2>
        {s && <CornerLink href={href.session(s.sessionId)} label="Open the session readings" />}
      </header>
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-hair" data-testid="measurement-strip">
        <div>
          <Row label="HR coverage" value={rings.coverage ? `${rings.coverage.numerator} / ${rings.coverage.denominator}` : 'N/A'} detail={rings.coverage ? '10 s intervals with a valid reading' : s ? 'Phase times incomplete' : 'No check recorded'} />
          <Row label="Valid heart-rate readings" value={s ? `${valid} / ${recorded}` : '--'} detail={s ? 'Valid of recorded readings' : 'No check recorded'} />
          <Row label="Rest phase, valid" value={c ? phase(c.rest) : '--'} />
          <Row label="Recovery phase, valid" value={c ? phase(c.recovery) : '--'} />
          <Row
            label="Source quality"
            value={!s ? '--' : <Pill tone={excluded.length || extFlags ? 'amber' : 'mint'}>{excluded.length || extFlags ? `${excluded.length + extFlags} flagged` : 'All valid'}</Pill>}
            detail={
              !s
                ? 'No check recorded'
                : excluded.length
                  ? `${plural(excluded.length, 'reading')} left out of the medians${extFlags ? ` · ${plural(extFlags, 'external flag')}` : ''}`
                  : extFlags
                    ? `${plural(extFlags, 'external reading')} flagged for source review`
                    : 'Every heart-rate reading used'
            }
          />
        </div>
        <div>
          <Row testId="strip-check" label="Session progress" value={check.value} detail={steps ? `${steps.done} of ${steps.total} protocol steps · ${check.sub}` : check.sub} />
          <Row
            label="Review state"
            value={e ? <Pill tone={REVIEW_META[e.review.state].tone}>{REVIEW_META[e.review.state].label}</Pill> : '--'}
            detail={e ? (e.review.reviewer ? `Reviewer: ${e.review.reviewer}` : `${STATUS_META[e.status].label} · ${ackLabel(e).text}`) : 'No event for this check'}
          />
          <Row
            label="Last assessment"
            value={latestSession ? <span className="font-mono text-[13px]">{utcStamp(latestSession.startedAt).slice(5, 16)}Z</span> : '--'}
            detail={latestSession ? `${latestSession.summary ? `Watch summary: ${latestSession.summary.status.replace(/_/g, ' ').toLowerCase()}` : 'No watch summary'} · ${ago(latestSession.startedAt, nowMs)}` : 'No assessment recorded'}
          />
          <Row
            label="Watch reachability"
            value={<Pill tone={LINK_META[link].tone}>{LINK_META[link].label}</Pill>}
            detail={device ? `${device.deviceModel ?? device.deviceId} · last contact ${ago(device.lastSeenAt, nowMs)}` : 'No watch has checked in for this crew member'}
          />
          <div data-testid="provenance">
            <Row
              label="Sensor provenance"
              value={session ? (session.measurements[0]?.source.device ?? session.provenance.deviceId ?? 'Unknown device') : '--'}
              detail={session ? `${mode} · ${plural(hrCount, 'heart-rate reading')}, ${valid} valid · received ${session.provenance.receivedAt ? utcStamp(session.provenance.receivedAt).slice(5) : '--'}` : 'No session recorded for this crew member.'}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 5. Event queue (the search filters it; it matches text in stored events, nothing more)

function EventQueue({ ds, focusId }: { ds: Dataset; focusId: string | null }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => sortEvents(Object.values(ds.events)), [ds])
  const open = all.filter(isOpen).length
  const needle = q.trim().toLowerCase()
  const events = needle
    ? all.filter((e) => [e.eventId, e.sessionId ?? '', subjectLabel(e.subjectId), CATEGORY_META[e.category].label, STATUS_META[e.status].label, ORIGIN_LABEL[e.origin.kind], ...e.reasonCodes].some((f) => f.toLowerCase().includes(needle)))
    : all.slice(0, 8)
  return (
    <section className="panel min-w-0 overflow-hidden" aria-label="Health event queue">
      <header className="pane-head flex-wrap">
        <h2 className="label">Health event queue</h2>
        <div className="flex flex-wrap items-center gap-4">
          <Pill tone={open ? 'coral' : 'muted'}>{open} open</Pill>
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
              <th className="hidden lg:table-cell">Reason</th>
              <th className="hidden lg:table-cell">On the watch</th>
              <th className="hidden xl:table-cell">Review</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody data-testid="event-feed">
            {events.map((e) => {
              const cat = CATEGORY_META[e.category]
              const st = STATUS_META[e.status]
              const ack = ackLabel(e)
              const rv = REVIEW_META[e.review.state]
              return (
                <tr key={e.eventId} className="row-link" data-selected={e.eventId === focusId} onClick={() => navigate(href.event(e.eventId))}>
                  <td>
                    <a href={href.event(e.eventId)} data-testid={`event-row-${e.eventId}`} className="flex min-w-0 items-center gap-2.5" onClick={(ev) => ev.stopPropagation()}>
                      <span className={`status-mark ${isOpen(e) ? TONE[cat.tone].dot : 'bg-line-strong'}`} aria-hidden />
                      <span className="truncate font-medium text-ink">{cat.label}</span>
                      {e.isSimulated && <SimTag />}
                    </a>
                    <span className="mt-1 block truncate pl-[18px] text-[13px] text-ink-2 md:hidden">
                      {subjectLabel(e.subjectId)} · {utcStamp(e.createdAt).slice(5)} · {ack.text}
                    </span>
                  </td>
                  <td className="hidden text-ink-2 md:table-cell">{subjectLabel(e.subjectId)}</td>
                  <td className="hidden font-mono text-[13px] text-ink-2 md:table-cell">{utcStamp(e.createdAt).slice(5)}</td>
                  <td className="hidden max-w-[260px] truncate font-mono text-[12px] text-ink-2 lg:table-cell">{e.reasonCodes.join(', ')}</td>
                  <td className="hidden max-w-[260px] truncate text-ink-2 lg:table-cell">{ack.text}</td>
                  <td className="hidden text-ink-2 xl:table-cell">{rv.label}</td>
                  <td>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </td>
                </tr>
              )
            })}
            {!events.length && (
              <tr>
                <td colSpan={7} className="text-ink-2">
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
      <div>
        <div className="eyebrow">Mission overview</div>
        <h1 className="display mt-3 text-[40px] text-ink">Mission health</h1>
        <p className="mt-2 text-[14px] text-ink-2">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'} · onboard health monitoring and evidence review</p>
      </div>
      {workspace === 'mission' ? (
        <Empty
          title="No mission records yet"
          action={
            <div className="flex flex-wrap gap-3">
              <a className="btn btn-primary" href={href.system}>
                <FileUp size={16} /> Connect or import a watch
              </a>
              <button className="btn btn-sim" onClick={() => setWorkspace('demo')}>
                <span className="status-mark bg-violet" aria-hidden />
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
              <span className="status-mark bg-violet" aria-hidden />
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
  const otherOpen = sortEvents(Object.values(ds.events))
    .filter(isOpen)
    .filter((e) => e.eventId !== focus.event?.eventId).length
  const hrCount = session ? session.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const sessionMode = session ? recordSourceMode(session, session.provenance.deviceId ? (links[session.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED') : null
  const regions = regionsFor(session, session ? linkedReadings(ds, session.sessionId) : [])
  const crew = focus.subjectId ? subjectLabel(focus.subjectId) : null

  return (
    <div className="flex flex-col gap-6">
      <section className="grid items-center gap-x-10 gap-y-6 lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <div className="eyebrow">Mission overview</div>
            <h1 className="display mt-3 text-[40px] text-ink">Mission health</h1>
            <p className="mt-2 text-[14px] text-ink-2">
              {crew ?? 'No crew selected'} · gravity recovery check · latest <span className="font-mono text-[13px]">{session ? utcStamp(session.startedAt).slice(5, 16) + 'Z' : '--'}</span> · {workspace === 'demo' ? 'simulated demo' : (sessionMode ?? 'no records')}
              {focus.scenario && <span> · scenario {focus.scenario.id}</span>}
            </p>
          </div>
          <ReviewFocus ds={ds} focus={focus} otherOpen={otherOpen} nowIso={serverTime} />
          {workspace === 'demo' && <TriggerButton />}
        </div>
        <div className="relative min-w-0">
          <BodyMap regions={regions} selected={region} onSelect={setRegion} label={`Evidence map for ${crew ?? 'crew member'}`} size="hero" />
        </div>
      </section>

      <KeyMetrics ds={ds} focus={focus} t={t} />

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Evidence by region"
          meta={
            crew ? (
              <span className="flex items-center gap-3 text-[13px] text-ink-2">
                {crew}
                {session?.isSimulated && <SimTag />}
              </span>
            ) : undefined
          }
          bodyClassName="flex flex-col gap-4 px-2 pb-5"
        >
          <EvidenceList regions={regions} selected={region} onSelect={setRegion} title={null} />
          <div className="px-3">
            <RegionDetail info={region ? regions[region] : null} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
          </div>
        </Panel>
        <MissionTimeline focus={focus} onSymptom={(r) => setRegion(r)} selectedRegion={region} />
      </section>

      <RecordDetails t={t} nowMs={nowMs} session={session} mode={sessionMode} hrCount={hrCount} />

      <EventQueue ds={ds} focusId={focus.event?.eventId ?? null} />
    </div>
  )
}
