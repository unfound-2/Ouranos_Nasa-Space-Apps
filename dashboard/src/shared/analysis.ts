/**
 * Computer-side analysis. Pure, deterministic functions over stored records.
 *
 * Everything here is descriptive. The thresholds in RULES are product rules chosen for this
 * prototype (completeness, freshness, display intervals). None of them is a clinical threshold,
 * and nothing here estimates risk, diagnoses a condition or clears anyone for duty.
 */
import type { PhaseT, StoredMeasurement, StoredSession } from './contract.js'

export const RULES = {
  /** Valid samples needed in a phase before its median is reported (PRD product rule). */
  minValidSamplesPerPhase: 3,
  /** Prior comparable sessions needed before a personal baseline is shown (PRD product rule). */
  minBaselineSessions: 3,
  /** The baseline uses at most this many of the most recent comparable sessions. */
  baselineWindow: 5,
  /** Width of the intervals used for the heart-rate coverage ring. */
  coverageIntervalSeconds: 10,
  /** A reading may sit this far outside its phase's recorded window (clock jitter). */
  phaseWindowToleranceSeconds: 2,
  /** Latest valid heart rate older than this at event time is called stale. */
  eventFreshnessSeconds: 300,
  /** The overview shows "NO RECENT DATA" when the latest reading is older than this. */
  recentReadingSeconds: 600,
  /** An external reading this far from the session window is called stale. */
  externalReadingMaxGapSeconds: 1800,
  /** A phase window longer than this cannot be a real phase (for example a reset watch clock). */
  maxPhaseSeconds: 3600,
} as const

const t = (iso: string) => Date.parse(iso)
const seconds = (a: string, b: string) => (t(b) - t(a)) / 1000

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export type ExclusionReason =
  | 'NO_VALUE'
  | 'QUALITY_INVALID'
  | 'QUALITY_QUESTIONABLE'
  | 'OUTSIDE_PHASE_WINDOW'
  | 'PHASE_NOT_RECORDED'

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  NO_VALUE: 'No value recorded',
  QUALITY_INVALID: 'Source marked it invalid',
  QUALITY_QUESTIONABLE: 'Source marked it questionable',
  OUTSIDE_PHASE_WINDOW: 'Timestamp outside the recorded phase',
  PHASE_NOT_RECORDED: 'Phase start was not recorded',
}

export interface PhaseSummary {
  phase: PhaseT
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  /** Heart-rate readings tagged with this phase, valid or not. */
  recorded: StoredMeasurement[]
  valid: StoredMeasurement[]
  excluded: { measurement: StoredMeasurement; reason: ExclusionReason }[]
  /** null unless at least RULES.minValidSamplesPerPhase valid readings exist. */
  median: number | null
  sufficient: boolean
  latestValidAt: string | null
}

export function heartRateReadings(session: StoredSession): StoredMeasurement[] {
  return session.measurements.filter((m) => m.indicator === 'HEART_RATE')
}

export function summarizePhase(session: StoredSession, phase: PhaseT): PhaseSummary {
  const record = session.phases.find((p) => p.phase === phase) ?? null
  const recorded = heartRateReadings(session)
    .filter((m) => m.phase === phase)
    .sort((a, b) => t(a.measuredAt) - t(b.measuredAt))
  const tol = RULES.phaseWindowToleranceSeconds * 1000
  const valid: StoredMeasurement[] = []
  const excluded: PhaseSummary['excluded'] = []
  for (const m of recorded) {
    let reason: ExclusionReason | null = null
    if (m.value === null) reason = 'NO_VALUE'
    else if (m.quality === 'INVALID') reason = 'QUALITY_INVALID'
    else if (m.quality === 'QUESTIONABLE') reason = 'QUALITY_QUESTIONABLE'
    else if (!record) reason = 'PHASE_NOT_RECORDED'
    else {
      const at = t(m.measuredAt)
      if (at < t(record.startedAt) - tol || (record.endedAt && at > t(record.endedAt) + tol)) reason = 'OUTSIDE_PHASE_WINDOW'
    }
    if (reason) excluded.push({ measurement: m, reason })
    else valid.push(m)
  }
  const sufficient = valid.length >= RULES.minValidSamplesPerPhase
  return {
    phase,
    startedAt: record?.startedAt ?? null,
    endedAt: record?.endedAt ?? null,
    durationSeconds: record?.endedAt ? seconds(record.startedAt, record.endedAt) : null,
    recorded,
    valid,
    excluded,
    median: sufficient ? median(valid.map((m) => m.value as number)) : null,
    sufficient,
    latestValidAt: valid.length ? valid[valid.length - 1].measuredAt : null,
  }
}

export type PhaseComparison =
  | {
      status: 'CALCULATED'
      rest: PhaseSummary
      recovery: PhaseSummary
      restMedian: number
      recoveryMedian: number
      observedDelta: number
    }
  | {
      status: 'INSUFFICIENT_SAMPLES'
      rest: PhaseSummary
      recovery: PhaseSummary
      restMedian: null
      recoveryMedian: null
      observedDelta: null
    }

/** recoveryMedian - restMedian, in bpm, only when both phases have enough valid readings. */
export function comparePhases(session: StoredSession): PhaseComparison {
  const rest = summarizePhase(session, 'REST')
  const recovery = summarizePhase(session, 'RECOVERY')
  if (rest.median === null || recovery.median === null)
    return { status: 'INSUFFICIENT_SAMPLES', rest, recovery, restMedian: null, recoveryMedian: null, observedDelta: null }
  return {
    status: 'CALCULATED',
    rest,
    recovery,
    restMedian: rest.median,
    recoveryMedian: recovery.median,
    observedDelta: recovery.median - rest.median,
  }
}

export interface Coverage {
  status: 'CALCULATED' | 'NOT_AVAILABLE'
  coveredIntervals: number
  totalIntervals: number
  fraction: number | null
  intervalSeconds: number
  /** Phases left out because their recorded window is implausibly long. */
  implausiblePhases: PhaseT[]
}

/** Share of fixed-width intervals in the rest and recovery phases that contain a valid reading. */
export function hrCoverage(session: StoredSession): Coverage {
  const width = RULES.coverageIntervalSeconds * 1000
  let covered = 0
  let total = 0
  const implausiblePhases: PhaseT[] = []
  for (const phase of ['REST', 'RECOVERY'] as const) {
    const s = summarizePhase(session, phase)
    if (!s.startedAt || !s.endedAt) continue
    const start = t(s.startedAt)
    const end = t(s.endedAt)
    if (end - start > RULES.maxPhaseSeconds * 1000) {
      implausiblePhases.push(phase)
      continue
    }
    const bins = Math.ceil((end - start) / width)
    // One pass over the readings: each lands in exactly one interval (the last one is closed).
    const hit = new Set<number>()
    for (const m of s.valid) {
      const x = t(m.measuredAt)
      if (x < start || x > end) continue
      hit.add(Math.min(bins - 1, Math.floor((x - start) / width)))
    }
    covered += hit.size
    total += bins
  }
  const base = { intervalSeconds: RULES.coverageIntervalSeconds, implausiblePhases }
  if (total === 0) return { status: 'NOT_AVAILABLE', coveredIntervals: 0, totalIntervals: 0, fraction: null, ...base }
  return { status: 'CALCULATED', coveredIntervals: covered, totalIntervals: total, fraction: covered / total, ...base }
}

export interface CompletenessStep {
  id: 'STARTED' | 'REST_RECORDED' | 'RECOVERY_RECORDED' | 'SYMPTOM_CHECK' | 'ENDED'
  label: string
  done: boolean
  at: string | null
}

/** Protocol steps present in the record, out of five. */
export function sessionCompleteness(session: StoredSession) {
  const rest = session.phases.find((p) => p.phase === 'REST')
  const recovery = session.phases.find((p) => p.phase === 'RECOVERY')
  const answered = session.symptomCheck.status === 'REPORTED' || session.symptomCheck.status === 'NONE_REPORTED'
  const steps: CompletenessStep[] = [
    { id: 'STARTED', label: 'Check started', done: true, at: session.startedAt },
    { id: 'REST_RECORDED', label: 'Rest phase recorded', done: !!rest?.endedAt, at: rest?.endedAt ?? null },
    { id: 'RECOVERY_RECORDED', label: 'Recovery phase recorded', done: !!recovery?.endedAt, at: recovery?.endedAt ?? null },
    { id: 'SYMPTOM_CHECK', label: 'Symptom check answered', done: answered, at: answered ? session.symptomCheck.answeredAt : null },
    { id: 'ENDED', label: 'Session saved', done: session.endedAt !== null, at: session.endedAt },
  ]
  const done = steps.filter((s) => s.done).length
  return { steps, done, total: steps.length, fraction: done / steps.length }
}

export type BaselineExclusion =
  | 'SIMULATION_MISMATCH'
  | 'DIFFERENT_PROTOCOL'
  | 'NOT_EARLIER'
  | 'NOT_COMPLETED'
  | 'INSUFFICIENT_SAMPLES'

export const BASELINE_EXCLUSION_LABEL: Record<BaselineExclusion, string> = {
  SIMULATION_MISMATCH: 'Simulated and real sessions are never compared',
  DIFFERENT_PROTOCOL: 'Different protocol or version',
  NOT_EARLIER: 'Recorded after this session',
  NOT_COMPLETED: 'Session did not complete',
  INSUFFICIENT_SAMPLES: 'Too few valid readings for a phase comparison',
}

export interface BaselineResult {
  status: 'ESTABLISHED' | 'NOT_ESTABLISHED'
  required: number
  compatibleCount: number
  used: { sessionId: string; startedAt: string; observedDelta: number }[]
  baselineDelta: number | null
  currentDelta: number | null
  differenceFromBaseline: number | null
  excluded: { sessionId: string; startedAt: string; reason: BaselineExclusion }[]
}

/**
 * Median observed delta of the subject's earlier comparable sessions. Comparable means same
 * subject, same protocol and version, same simulated flag, completed, and with enough samples.
 */
export function personalBaseline(current: StoredSession, sessions: StoredSession[]): BaselineResult {
  const compatible: BaselineResult['used'] = []
  const excluded: BaselineResult['excluded'] = []
  for (const s of sessions) {
    if (s.subjectId !== current.subjectId || s.sessionId === current.sessionId) continue
    let reason: BaselineExclusion | null = null
    if (s.isSimulated !== current.isSimulated) reason = 'SIMULATION_MISMATCH'
    else if (s.protocol.id !== current.protocol.id || s.protocol.version !== current.protocol.version) reason = 'DIFFERENT_PROTOCOL'
    else if (t(s.startedAt) >= t(current.startedAt)) reason = 'NOT_EARLIER'
    else if (s.endReason !== 'COMPLETED') reason = 'NOT_COMPLETED'
    const c = reason ? null : comparePhases(s)
    if (c && c.status !== 'CALCULATED') reason = 'INSUFFICIENT_SAMPLES'
    if (reason || !c || c.status !== 'CALCULATED') excluded.push({ sessionId: s.sessionId, startedAt: s.startedAt, reason: reason ?? 'INSUFFICIENT_SAMPLES' })
    else compatible.push({ sessionId: s.sessionId, startedAt: s.startedAt, observedDelta: c.observedDelta })
  }
  compatible.sort((a, b) => t(b.startedAt) - t(a.startedAt))
  const used = compatible.slice(0, RULES.baselineWindow)
  const cur = comparePhases(current)
  const currentDelta = cur.status === 'CALCULATED' ? cur.observedDelta : null
  const established = compatible.length >= RULES.minBaselineSessions
  const baselineDelta = established ? median(used.map((u) => u.observedDelta)) : null
  return {
    status: established ? 'ESTABLISHED' : 'NOT_ESTABLISHED',
    required: RULES.minBaselineSessions,
    compatibleCount: compatible.length,
    used: established ? used : compatible,
    baselineDelta,
    currentDelta,
    differenceFromBaseline: baselineDelta !== null && currentDelta !== null ? currentDelta - baselineDelta : null,
    excluded,
  }
}

export interface QualityFinding {
  measurementId: string
  reasonCode: 'SOURCE_REVIEW_REQUIRED' | 'SENSOR_DATA_STALE'
  detail: string
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(Math.abs(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h} h ${m} min`
  if (m) return `${m} min ${sec} s`
  return `${sec} s`
}

/** Checks on readings from instruments other than the watch (cuff, manual entry). */
export function externalReadingFindings(session: StoredSession | null, readings: StoredMeasurement[]): QualityFinding[] {
  const out: QualityFinding[] = []
  for (const r of readings) {
    if (r.quality === 'INVALID' || r.quality === 'QUESTIONABLE')
      out.push({ measurementId: r.measurementId, reasonCode: 'SOURCE_REVIEW_REQUIRED', detail: `The instrument marked this reading ${r.quality}.` })
    if (session) {
      const at = t(r.measuredAt)
      const start = t(session.startedAt)
      // An unfinished session has no end yet, so only a reading before its start can be judged.
      const end = session.endedAt ? t(session.endedAt) : Number.POSITIVE_INFINITY
      const gap = at < start ? (start - at) / 1000 : at > end ? (at - end) / 1000 : 0
      if (gap > RULES.externalReadingMaxGapSeconds)
        out.push({
          measurementId: r.measurementId,
          reasonCode: 'SENSOR_DATA_STALE',
          detail: `Measured ${formatDuration(gap)} ${at < start ? 'before the session started' : 'after the session ended'}.`,
        })
    }
  }
  return out
}

/** The newest valid heart-rate reading across the given sessions. */
export function latestValidHeartRate(sessions: StoredSession[]): StoredMeasurement | null {
  let best: StoredMeasurement | null = null
  for (const s of sessions)
    for (const m of heartRateReadings(s))
      if (m.value !== null && m.quality === 'VALID' && (!best || t(m.measuredAt) > t(best.measuredAt))) best = m
  return best
}

/**
 * How old the newest valid heart rate taken at or before a moment was at that moment.
 * Readings taken after it are counted separately and never used for its age.
 */
export function freshnessAt(session: StoredSession, atIso: string) {
  const at = t(atIso)
  const valid = heartRateReadings(session).filter((m) => m.value !== null && m.quality === 'VALID')
  const before = valid.filter((m) => t(m.measuredAt) <= at).sort((a, b) => t(a.measuredAt) - t(b.measuredAt))
  const laterValidReadings = valid.length - before.length
  const latest = before[before.length - 1]
  if (!latest) return { latestValidAt: null, ageSeconds: null, fresh: null as boolean | null, laterValidReadings }
  const age = seconds(latest.measuredAt, atIso)
  return { latestValidAt: latest.measuredAt, ageSeconds: age, fresh: age <= RULES.eventFreshnessSeconds, laterValidReadings }
}
