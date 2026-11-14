/**
 * Deterministic explanations built only from recorded facts: the event's own reason codes,
 * the session's readings and timestamps, and the computer's descriptive analysis.
 * No sentence here may diagnose, estimate risk, or say anyone is fit or cleared.
 */
import {
  comparePhases,
  EXCLUSION_LABEL,
  formatDuration,
  freshnessAt,
  hrCoverage,
  personalBaseline,
  RULES,
  sessionCompleteness,
  type BaselineResult,
  type PhaseComparison,
} from './analysis'
import type { StoredEvent, StoredMeasurement, StoredSession } from './contract'
import {
  linkedReadings,
  linkState,
  recordSourceMode,
  resolveEvidence,
  type Dataset,
  type LinkState,
  type ResolvedEvidence,
  type SourceMode,
} from './dataset'
import { listJoin, plural, signed, SYMPTOM_NOUN, utcDate, utcTime } from './format'

export const REASON_CODES: Record<string, { label: string; meaning: string }> = {
  WATCH_TELEMETRY_FLAG: { label: 'Watch telemetry flag', meaning: 'The watch reported flagged readings for verification.' },
  SYMPTOM_REPORTED: { label: 'Symptom reported', meaning: 'A symptom was reported during the check.' },
  SESSION_STOPPED_UNWELL: { label: 'Stopped: wearer unwell', meaning: "The wearer ended the check early with Stop / I'm unwell." },
  SESSION_STOPPED_BY_WEARER: { label: 'Check stopped by wearer', meaning: 'The wearer ended the check early.' },
  INSUFFICIENT_HR_SAMPLES: { label: 'Insufficient heart-rate samples', meaning: `A phase has fewer than ${RULES.minValidSamplesPerPhase} valid heart-rate readings.` },
  SENSOR_DATA_STALE: { label: 'Sensor data stale', meaning: 'A reading was taken too long before or after the check to describe it.' },
  MISSING_BASELINE: { label: 'Missing baseline', meaning: `Fewer than ${RULES.minBaselineSessions} earlier comparable sessions exist, so there is no personal baseline.` },
  SOURCE_REVIEW_REQUIRED: { label: 'Source review required', meaning: 'An instrument marked a reading questionable or invalid.' },
  PHASE_INCOMPLETE: { label: 'Phase incomplete', meaning: 'A phase is missing its start or end time.' },
  HR_UNAVAILABLE: { label: 'Heart rate unavailable', meaning: 'The watch could not read heart rate, for example because permission was not granted.' },
  SYMPTOM_CHECK_UNANSWERED: { label: 'Symptom check unanswered', meaning: 'The symptom question was not answered.' },
}

export function reasonInfo(code: string): { code: string; label: string; meaning: string; known: boolean } {
  const r = REASON_CODES[code]
  return r
    ? { code, ...r, known: true }
    : { code, label: code, meaning: 'Not a code this computer recognises. It is shown exactly as the watch sent it.', known: false }
}

export interface EventContext {
  event: StoredEvent
  session: StoredSession | null
  comparison: PhaseComparison | null
  baseline: BaselineResult | null
  readings: StoredMeasurement[]
  evidence: ResolvedEvidence[]
  link: LinkState
  sourceMode: SourceMode
  now: string
}

/** Own-property lookup: ids such as "constructor" must never find Object.prototype members. */
const own = <T,>(map: Record<string, T>, key: string | null): T | null => (key !== null && Object.hasOwn(map, key) ? map[key] : null)

/**
 * The data-source label of an event. A computer check has no ingest path of its own, so it takes
 * the label of the reading it cites; a watch event takes the link of the device that sent it.
 */
function eventSourceMode(event: StoredEvent, ds: Dataset, session: StoredSession | null, now: string, link: LinkState): SourceMode {
  if (event.isSimulated) return 'SIMULATED DEMO'
  if (event.origin.kind !== 'MISSION_COMPUTER_CHECK') return recordSourceMode(event, link)
  for (const ref of event.evidence) {
    if (ref.kind !== 'MEASUREMENT') continue
    const r = own(ds.readings, ref.refId) ?? session?.measurements.find((m) => m.measurementId === ref.refId) ?? null
    if (r) return recordSourceMode(r, linkState(own(ds.devices, r.provenance.deviceId), now))
  }
  return 'UNAVAILABLE'
}

export function buildEventContext(event: StoredEvent, ds: Dataset, now: string): EventContext {
  const stored = own(ds.sessions, event.sessionId)
  // A session that belongs to someone else is never used to explain this crew member's event.
  const session = stored && stored.subjectId === event.subjectId ? stored : null
  const link = linkState(own(ds.devices, event.provenance.deviceId), now)
  return {
    event,
    session,
    comparison: session ? comparePhases(session) : null,
    baseline: session ? personalBaseline(session, Object.values(ds.sessions)) : null,
    readings: session ? linkedReadings(ds, session.sessionId) : [],
    evidence: resolveEvidence(event, ds),
    link,
    sourceMode: eventSourceMode(event, ds, session, now, link),
    now,
  }
}

const reporter = (symptoms: { reportedBy: 'SELF_REPORTED' | 'CREW_OBSERVED' }[]) =>
  symptoms.every((s) => s.reportedBy === 'SELF_REPORTED')
    ? 'self-reported'
    : symptoms.every((s) => s.reportedBy === 'CREW_OBSERVED')
      ? 'reported by a crew observer'
      : 'reported'

const symptomPhrase = (codes: string[]) => {
  const nouns = [...new Set(codes)].map((c) => SYMPTOM_NOUN[c as keyof typeof SYMPTOM_NOUN] ?? c.toLowerCase())
  return `${listJoin(nouns)} ${nouns.length > 1 ? 'were' : 'was'}`
}

function leadSentence(ctx: EventContext): string {
  const { event, session } = ctx
  const symptoms = ctx.evidence.flatMap((e) => (e.found && e.kind === 'SYMPTOM' ? [e.symptom] : []))
  if (event.category === 'REVIEW_SUGGESTED' && event.reasonCodes.includes('SYMPTOM_REPORTED')) {
    if (symptoms.length) {
      const first = symptoms[0]
      const phase = first.phase ? `, reported for the ${first.phase.toLowerCase()} phase` : ''
      const who = first.reportedBy === 'SELF_REPORTED' ? 'self-reported' : 'reported by a crew observer'
      return `Review suggested because ${symptomPhrase(symptoms.map((s) => s.code))} ${who} at ${utcTime(first.reportedAt)} on ${utcDate(first.reportedAt)}${phase}.`
    }
    return session
      ? 'Review suggested because the watch reported a symptom, but the cited symptom is not in the session record.'
      : 'Review suggested because the watch reported a symptom. The session record with the symptom has not been received yet.'
  }
  if (event.category === 'VERIFY_SOURCE') {
    const cited = new Set(event.evidence.filter((e) => e.kind === 'MEASUREMENT').map((e) => e.refId)).size
    const who = event.origin.kind === 'MISSION_COMPUTER_CHECK' ? 'The mission computer flagged' : 'The watch flagged'
    const what = cited ? plural(cited, 'reading') : 'this record'
    return `${who} ${what} for source verification: ${listJoin(event.reasonCodes.map((c) => reasonInfo(c).label.toLowerCase()))}.`
  }
  const labels = event.reasonCodes.map((c) => reasonInfo(c).label.toLowerCase())
  if (event.category === 'RECORDING_INCOMPLETE') return `The watch flagged this recording as incomplete: ${listJoin(labels)}.`
  return `Review suggested: ${listJoin(labels)}.`
}

function comparisonSentences(ctx: EventContext): string[] {
  const c = ctx.comparison
  if (!ctx.session || !c)
    return [
      ctx.event.sessionId === null
        ? 'This event is not linked to a recovery session, so there is no heart-rate comparison.'
        : 'The session record for this event has not been received, so no heart-rate comparison is possible.',
    ]
  const out: string[] = []
  if (c.status === 'CALCULATED') {
    out.push(
      `Heart-rate data was sufficient for a phase comparison: rest median ${c.restMedian} bpm (${plural(c.rest.valid.length, 'valid reading')}), recovery median ${c.recoveryMedian} bpm (${plural(c.recovery.valid.length, 'valid reading')}), an observed difference of ${signed(c.observedDelta)} bpm. This is a descriptive difference, not a clinical threshold.`,
    )
  } else {
    out.push(
      `Heart-rate data was insufficient for a phase comparison (rest: ${plural(c.rest.valid.length, 'valid reading')}, recovery: ${plural(c.recovery.valid.length, 'valid reading')}; at least ${RULES.minValidSamplesPerPhase} are needed in each).`,
    )
  }
  for (const p of [c.rest, c.recovery]) {
    if (!p.excluded.length) continue
    const why = [...new Set(p.excluded.map((x) => EXCLUSION_LABEL[x.reason].toLowerCase()))]
    out.push(`${plural(p.excluded.length, `${p.phase.toLowerCase()} reading was`, `${p.phase.toLowerCase()} readings were`)} left out (${why.join('; ')}).`)
  }
  return out
}

function baselineSentence(ctx: EventContext): string | null {
  const b = ctx.baseline
  if (!b) return null
  if (b.status === 'ESTABLISHED' && b.baselineDelta !== null) {
    const basis = baselineBasis(b)
    if (b.differenceFromBaseline === null)
      return `A personal baseline exists (median ${signed(b.baselineDelta)} bpm, ${basis}), but this session cannot be compared with it.`
    const d = b.differenceFromBaseline
    const rel = d === 0 ? 'the same as it' : `${signed(d)} bpm ${d > 0 ? 'above' : 'below'} it`
    return `Against this crew member's baseline of ${signed(b.baselineDelta)} bpm (median of ${basis.replace(/^from /, '')}), this session's difference is ${rel}.`
  }
  return `No personal baseline yet: ${b.compatibleCount} of ${b.required} earlier comparable sessions.`
}

/** "3 earlier comparable sessions", or "the 5 most recent of 7 ..." when the median uses only some. */
export function baselineBasis(b: BaselineResult): string {
  return b.used.length === b.compatibleCount
    ? `from ${plural(b.compatibleCount, 'earlier comparable session')}`
    : `from the ${b.used.length} most recent of ${b.compatibleCount} earlier comparable sessions`
}

function deliverySentence(ctx: EventContext): string {
  const { event } = ctx
  const d = event.delivery
  const sim = d.channel === 'SIMULATED_WATCH' ? 'simulated watch' : 'watch'
  const ack = event.acknowledgement ? ` and acknowledged there at ${utcTime(event.acknowledgement.acknowledgedAt)}` : ' and has not been acknowledged'
  switch (d.state) {
    case 'PRESENTED':
      return `The alert was presented on the ${sim} at ${utcTime(d.presentedAt ?? event.createdAt)}${ack}.`
    case 'WATCH_UNREACHABLE':
      return 'The alert was not sent to the watch: no watch link was verified when this computer created it.'
    case 'UNCONFIRMED':
      return 'The alert was queued for the watch, but the watch never confirmed showing it.'
    case 'QUEUED':
      return 'The alert is queued for the watch and has not been confirmed as shown.'
    default:
      return 'No alert delivery to the watch was attempted.'
  }
}

/** Sentences answering "why was this flagged, and what supports it". */
export function explainEvent(ctx: EventContext): string[] {
  const out = [leadSentence(ctx), ...comparisonSentences(ctx)]
  const b = baselineSentence(ctx)
  if (b) out.push(b)
  out.push(deliverySentence(ctx))
  return out
}

export interface Fact {
  id: string
  text: string
  /** known: established by the record. gap: missing or unconfirmed. limit: never measured by this system. */
  kind: 'known' | 'gap' | 'limit'
}

/** The "WHAT WE KNOW / WHAT WE DON'T KNOW" lists. */
export function knownsAndUnknowns(ctx: EventContext): { known: Fact[]; unknown: Fact[] } {
  const facts: Fact[] = []
  const { session, comparison: c, event } = ctx
  if (!session || !c) {
    facts.push(
      event.sessionId === null
        ? { id: 'session', kind: 'known', text: 'This event is not linked to a recovery session.' }
        : { id: 'session', kind: 'gap', text: 'The session record for this event has not been received.' },
    )
  } else {
    const hr = session.measurements.filter((m) => m.indicator === 'HEART_RATE' && m.value !== null && m.quality === 'VALID')
    const untagged = hr.filter((m) => m.phase === null).length
    const tagged = `${c.rest.valid.length} rest, ${c.recovery.valid.length} recovery${untagged ? `; ${untagged} have no phase tag` : ''}`
    facts.push(
      hr.length > 0
        ? { id: 'readings', kind: 'known', text: `${plural(hr.length, 'valid heart-rate reading')} recorded (${tagged}).` }
        : { id: 'readings', kind: 'gap', text: 'No valid heart-rate readings in this record.' },
    )
    const access = session.heartRateAccess ?? null
    if (access === 'AUTHORIZED') facts.push({ id: 'hr-access', kind: 'known', text: 'The watch reported that heart-rate permission was granted.' })
    else if (access === 'DENIED') facts.push({ id: 'hr-access', kind: 'gap', text: 'Heart-rate permission was denied on the watch, so it could not record heart rate.' })
    else if (access === 'NOT_DETERMINED') facts.push({ id: 'hr-access', kind: 'gap', text: 'Heart-rate permission had not been decided on the watch, so it could not record heart rate.' })
    else if (access === 'UNAVAILABLE') facts.push({ id: 'hr-access', kind: 'gap', text: 'The watch reported heart rate as unavailable during this check.' })
    // Freshness is judged against the moment the watch raised the event. A computer check runs
    // whenever records are imported, so its creation time says nothing about the readings.
    const fresh = freshnessAt(session, event.createdAt)
    if (fresh.ageSeconds !== null && event.origin.kind !== 'MISSION_COMPUTER_CHECK')
      facts.push(
        fresh.fresh
          ? {
              id: 'freshness',
              kind: 'known',
              text: `The latest valid reading before the event was taken ${formatDuration(fresh.ageSeconds)} before it was created${fresh.laterValidReadings ? `; ${plural(fresh.laterValidReadings, 'more reading was', 'more readings were')} taken after` : ''}.`,
            }
          : { id: 'freshness', kind: 'gap', text: `Heart rate at the time of the event: the latest valid reading before it is ${formatDuration(fresh.ageSeconds)} older than the event.` },
      )
    facts.push(
      c.status === 'CALCULATED'
        ? { id: 'samples', kind: 'known', text: `At least ${RULES.minValidSamplesPerPhase} valid readings in each phase (${c.rest.valid.length} rest, ${c.recovery.valid.length} recovery).` }
        : {
            id: 'samples',
            kind: 'gap',
            text: `Not enough valid readings for a phase comparison (rest ${c.rest.valid.length}, recovery ${c.recovery.valid.length}; ${RULES.minValidSamplesPerPhase} needed in each).`,
          },
    )
    const missingTimes: string[] = []
    for (const phase of ['REST', 'RECOVERY'] as const) {
      const p = session.phases.find((x) => x.phase === phase)
      if (!p) missingTimes.push(`${phase.toLowerCase()} phase`)
      else if (!p.endedAt) missingTimes.push(`${phase.toLowerCase()} end`)
    }
    facts.push(
      missingTimes.length
        ? { id: 'phases', kind: 'gap', text: `Missing phase times: ${listJoin(missingTimes)}.` }
        : { id: 'phases', kind: 'known', text: 'Both phases have recorded start and end times.' },
    )
    const st = session.symptomCheck
    if (st.status === 'REPORTED')
      facts.push({
        id: 'symptoms',
        kind: 'known',
        text: `${symptomPhrase(session.symptoms.map((s) => s.code)).replace(/^./, (m) => m.toUpperCase())} ${reporter(session.symptoms)} at ${utcTime(session.symptoms[0].reportedAt)}.`,
      })
    else if (st.status === 'NONE_REPORTED')
      facts.push({ id: 'symptoms', kind: 'known', text: `No symptoms were reported (answered ${st.answeredAt ? utcTime(st.answeredAt) : 'at an unrecorded time'}).` })
    else facts.push({ id: 'symptoms', kind: 'gap', text: st.status === 'NO_RESPONSE' ? 'The symptom question was not answered.' : 'No symptom check was recorded.' })

    const bp = ctx.readings.filter((r) => r.indicator !== 'HEART_RATE')
    if (bp.length) {
      const sys = bp.find((r) => r.indicator === 'BLOOD_PRESSURE_SYSTOLIC')
      const dia = bp.find((r) => r.indicator === 'BLOOD_PRESSURE_DIASTOLIC')
      const value = sys && dia ? `${sys.value ?? '--'}/${dia.value ?? '--'} mmHg` : `${(sys ?? dia)?.value ?? '--'} mmHg`
      const flagged = bp.filter((r) => r.quality !== 'VALID')
      facts.push({
        id: 'blood-pressure',
        kind: flagged.length ? 'gap' : 'known',
        text: `External cuff reading ${value}${bp[0].isSimulated ? ' (simulated)' : ''} from ${bp[0].source.device ?? 'an external instrument'}, measured ${utcTime(bp[0].measuredAt)} on ${utcDate(bp[0].measuredAt)}${flagged.length ? `; its instrument marked it ${flagged[0].quality.toLowerCase()}` : ''}. Not measured by the watch.`,
      })
    } else {
      facts.push({ id: 'blood-pressure', kind: 'limit', text: 'Blood pressure: the watch cannot measure it, and no external reading is linked to this session.' })
    }
    const b = ctx.baseline
    if (b)
      facts.push(
        b.status === 'ESTABLISHED'
          ? { id: 'baseline', kind: 'known', text: `Personal baseline ${baselineBasis(b)} (median ${signed(b.baselineDelta ?? 0)} bpm).` }
          : { id: 'baseline', kind: 'gap', text: `No personal baseline: ${b.compatibleCount} of ${b.required} earlier comparable sessions.` },
      )
  }

  const p = event.provenance
  if (event.isSimulated) facts.push({ id: 'sync', kind: 'known', text: 'Simulated record from the demo pathway. No device sync took place.' })
  else if (p.ingestPath === 'LIVE_SYNC') facts.push({ id: 'sync', kind: 'known', text: `Received over authenticated live sync at ${p.receivedAt ? utcTime(p.receivedAt) : 'an unrecorded time'}.` })
  else if (p.ingestPath === 'SAVED_DEVICE_FILE')
    facts.push({ id: 'sync', kind: 'known', text: `Imported from a saved watch file${p.importFileName ? ` (${p.importFileName})` : ''}. This was not a live connection.` })
  else if (event.origin.kind === 'MISSION_COMPUTER_CHECK') facts.push({ id: 'sync', kind: 'known', text: 'Created on this computer by its data check.' })
  else facts.push({ id: 'sync', kind: 'known', text: `Imported${p.importFileName ? ` from ${p.importFileName}` : ''}. This was not a live connection.` })

  const d = event.delivery
  if (d.state === 'PRESENTED')
    facts.push({ id: 'delivery', kind: 'known', text: `Presented on the ${d.channel === 'SIMULATED_WATCH' ? 'simulated watch' : 'watch'} at ${utcTime(d.presentedAt ?? event.createdAt)} (reported by ${d.confirmedBy === 'SIMULATION' ? 'the simulation' : 'the watch app'}).` })
  else if (d.state === 'WATCH_UNREACHABLE')
    facts.push({ id: 'delivery', kind: 'gap', text: 'Not delivered: no watch link was verified when the alert was created, so it was never sent or shown on the wrist.' })
  else if (d.state === 'UNCONFIRMED') facts.push({ id: 'delivery', kind: 'gap', text: 'Queued for the watch, but the watch never confirmed showing it.' })
  else facts.push({ id: 'delivery', kind: 'gap', text: 'Delivery to the watch is not confirmed.' })
  facts.push(
    event.acknowledgement
      ? { id: 'acknowledgement', kind: 'known', text: `Acknowledged on the ${event.acknowledgement.via === 'WATCH' ? 'watch' : 'simulated watch'} at ${utcTime(event.acknowledgement.acknowledgedAt)}. An acknowledgement is not a medical review.` }
      : { id: 'acknowledgement', kind: 'gap', text: 'Not acknowledged on the watch.' },
  )
  facts.push({ id: 'cause', kind: 'limit', text: 'The cause of any symptom. This system organises evidence; it does not diagnose.' })
  facts.push({ id: 'posture', kind: 'limit', text: 'Posture during each phase. It is not measured, and wrist data cannot confirm it.' })
  return { known: facts.filter((f) => f.kind === 'known'), unknown: facts.filter((f) => f.kind !== 'known') }
}

export type TimelineKind =
  | 'SESSION_STARTED'
  | 'REST_RECORDED'
  | 'RECOVERY_CONFIRMED'
  | 'RECOVERY_RECORDED'
  | 'SYMPTOM'
  | 'SESSION_SAVED'
  | 'EVENT_CREATED'
  | 'QUEUED'
  | 'DELIVERED'
  | 'UNREACHABLE'
  | 'UNCONFIRMED'
  | 'ACKNOWLEDGED'
  | 'REVIEWED'
  | 'CLOSED'

export interface TimelineItem {
  at: string
  kind: TimelineKind
  label: string
  detail: string | null
  tone: 'neutral' | 'data' | 'symptom' | 'event' | 'review' | 'warning'
}

const KIND_ORDER: TimelineKind[] = [
  'SESSION_STARTED',
  'REST_RECORDED',
  'RECOVERY_CONFIRMED',
  'RECOVERY_RECORDED',
  'SYMPTOM',
  'EVENT_CREATED',
  'QUEUED',
  'DELIVERED',
  'UNREACHABLE',
  'UNCONFIRMED',
  'SESSION_SAVED',
  'ACKNOWLEDGED',
  'REVIEWED',
  'CLOSED',
]

/** The chronological record of what actually happened. Missing steps are simply absent. */
export function timelineFor(event: StoredEvent | null, session: StoredSession | null): TimelineItem[] {
  const items: TimelineItem[] = []
  if (session) {
    items.push({ at: session.startedAt, kind: 'SESSION_STARTED', label: 'Recovery check started', detail: `Protocol ${session.protocol.id.replace(/_/g, ' ').toLowerCase()} v${session.protocol.version}`, tone: 'neutral' })
    const rest = session.phases.find((p) => p.phase === 'REST')
    if (rest?.endedAt) {
      const s = comparePhases(session).rest
      items.push({ at: rest.endedAt, kind: 'REST_RECORDED', label: 'Rest phase recorded', detail: `${formatDuration((Date.parse(rest.endedAt) - Date.parse(rest.startedAt)) / 1000)} · ${plural(s.valid.length, 'valid reading')}`, tone: 'data' })
    }
    const rec = session.phases.find((p) => p.phase === 'RECOVERY')
    if (rec?.confirmedAt)
      items.push({ at: rec.confirmedAt, kind: 'RECOVERY_CONFIRMED', label: 'Recovery phase confirmed', detail: rec.confirmedBy === 'SUPERVISOR' ? 'Confirmed by a supervisor' : 'Confirmed by the wearer', tone: 'neutral' })
    if (rec?.endedAt) {
      const s = comparePhases(session).recovery
      items.push({ at: rec.endedAt, kind: 'RECOVERY_RECORDED', label: 'Recovery phase recorded', detail: `${formatDuration((Date.parse(rec.endedAt) - Date.parse(rec.startedAt)) / 1000)} · ${plural(s.valid.length, 'valid reading')}`, tone: 'data' })
    }
    for (const s of session.symptoms)
      items.push({ at: s.reportedAt, kind: 'SYMPTOM', label: `Symptom logged: ${SYMPTOM_NOUN[s.code]}`, detail: s.reportedBy === 'SELF_REPORTED' ? 'Self-reported on the watch' : 'Reported by a crew observer', tone: 'symptom' })
    if (session.endedAt)
      items.push({ at: session.endedAt, kind: 'SESSION_SAVED', label: session.endReason === 'COMPLETED' ? 'Session saved' : `Session ended (${session.endReason.replace(/_/g, ' ').toLowerCase()})`, detail: null, tone: 'neutral' })
  }
  if (event) {
    items.push({
      at: event.createdAt,
      kind: 'EVENT_CREATED',
      label: 'Review event created',
      detail: event.origin.kind === 'MISSION_COMPUTER_CHECK' ? 'By the mission computer data check' : event.origin.kind === 'WATCH_RULES' ? 'By the watch rules' : 'By the simulated watch',
      tone: 'event',
    })
    for (const h of event.statusHistory) {
      const map: Partial<Record<typeof h.status, [TimelineKind, string, TimelineItem['tone']]>> = {
        QUEUED: ['QUEUED', 'Alert queued for the watch', 'neutral'],
        DELIVERED: ['DELIVERED', h.actor === 'SIMULATION' ? 'Alert presented on the simulated watch' : 'Alert presented on the watch', 'event'],
        WATCH_UNREACHABLE: ['UNREACHABLE', 'Alert not delivered: watch unreachable', 'warning'],
        DELIVERY_UNCONFIRMED: ['UNCONFIRMED', 'Alert delivery not confirmed', 'warning'],
        ACKNOWLEDGED: ['ACKNOWLEDGED', h.actor === 'SIMULATION' ? 'Acknowledgement received (simulated watch)' : 'Acknowledgement received from the watch', 'event'],
        REVIEWED: ['REVIEWED', 'Computer report reviewed', 'review'],
        CLOSED: ['CLOSED', 'Event closed', 'review'],
      }
      const m = map[h.status]
      if (m) items.push({ at: h.at, kind: m[0], label: m[1], detail: h.note, tone: m[2] })
    }
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

/** Numbers for the three rings, each with the counts behind it. */
export function ringMetrics(session: StoredSession | null, event: StoredEvent | null, checklistSize: number) {
  const completeness = session ? sessionCompleteness(session) : null
  const coverage = session ? hrCoverage(session) : null
  const checked = event ? event.review.checkedItems.length : null
  return {
    completeness: completeness ? { fraction: completeness.fraction, numerator: completeness.done, denominator: completeness.total } : null,
    coverage: coverage && coverage.fraction !== null ? { fraction: coverage.fraction, numerator: coverage.coveredIntervals, denominator: coverage.totalIntervals, intervalSeconds: coverage.intervalSeconds } : null,
    review: event && checked !== null ? { fraction: checked / checklistSize, numerator: checked, denominator: checklistSize, state: event.review.state } : null,
  }
}
