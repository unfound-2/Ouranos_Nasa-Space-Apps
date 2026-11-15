/**
 * SIMULATED demo data. Every value in this file is invented for demonstration and every
 * record carries isSimulated = true. Nothing here was measured on a person.
 *
 * Scenarios (see fixtures/simulated/README.md):
 *   A  normal recording, no symptoms (with two earlier normal sessions, so B has a baseline)
 *   B  dizziness self-reported during a recovery check -> watch-rule event REVIEW_SUGGESTED
 *   C  one valid heart-rate sample per phase -> no phase comparison is calculated
 *   D  an imported cuff reading that is stale and marked questionable -> VERIFY_SOURCE
 *   E  the computer's VERIFY_SOURCE alert cannot be delivered: WATCH_UNREACHABLE
 *   F  an event acknowledged on the (simulated) watch but not reviewed by a medical officer
 */
import { BUNDLE_SCHEMA, EVENT_SCHEMA, SESSION_SCHEMA } from './contract.js'
import { emptyDataset, expandPayload, ingestRecords, runDataChecks, type Datasets, type DeviceRecord } from './dataset.js'

type Q = 'VALID' | 'QUESTIONABLE' | 'INVALID' | 'MISSING'
type V = number | null | { v: number; q: Q }

export const DEMO_SUBJECT_LABELS: Record<string, string> = {
  'sim-crew-a': 'Crew Member A',
  'sim-crew-b': 'Crew Member B',
}

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
const plus = (at: string, s: number) => iso(Date.parse(at) + s * 1000)

const SIM_SOURCE = { kind: 'SIMULATOR', device: 'Simulated watch', sensor: 'Simulated heart-rate values' } as const
const SIM_PROVENANCE: { origin: 'DEMO_FIXTURE'; appVersion: string; deviceId: string | null } = {
  origin: 'DEMO_FIXTURE',
  appVersion: 'demo-fixtures 1.0',
  deviceId: null,
}

interface SessionPlan {
  sessionId: string
  subjectId: string
  deviceId: string
  startedAt: string
  rest: V[]
  recovery: V[]
  symptoms?: { code: 'DIZZY' | 'WEAK' | 'NAUSEATED' | 'OTHER'; bodyRegion?: 'HEAD' | 'CHEST' | 'ARMS' | 'LEGS'; note?: string }[]
  summary: Record<string, unknown>
  provenanceOrigin?: 'DEMO_FIXTURE'
}

/** Phases: rest start+5s..start+50s, recovery start+65s..start+110s, symptom check at start+115s. */
function plannedSession(p: SessionPlan) {
  const samples = (phase: 'REST' | 'RECOVERY', phaseStart: string, values: V[]) =>
    values.map((raw, i) => {
      const n = values.length
      const offset = 3 + Math.round((i * 40) / Math.max(1, n - 1)) + (i % 2)
      const value = raw === null ? null : typeof raw === 'number' ? raw : raw.v
      const quality: Q = raw === null ? 'MISSING' : typeof raw === 'number' ? 'VALID' : raw.q
      return {
        measurementId: `${p.sessionId}-${phase === 'REST' ? 'r' : 'v'}${String(i + 1).padStart(2, '0')}`,
        subjectId: p.subjectId,
        sessionId: p.sessionId,
        indicator: 'HEART_RATE',
        value,
        unit: 'bpm',
        measuredAt: plus(phaseStart, offset),
        phase,
        source: SIM_SOURCE,
        isSimulated: true,
        quality,
      }
    })
  const restStart = plus(p.startedAt, 5)
  const recoveryStart = plus(p.startedAt, 65)
  const checkAt = plus(p.startedAt, 115)
  const symptoms = (p.symptoms ?? []).map((s, i) => ({
    symptomId: `${p.sessionId}-s${i + 1}`,
    code: s.code,
    reportedAt: checkAt,
    phase: 'RECOVERY',
    bodyRegion: s.bodyRegion ?? null,
    reportedBy: 'SELF_REPORTED',
    note: s.note ?? null,
  }))
  return {
    schemaVersion: SESSION_SCHEMA,
    sessionId: p.sessionId,
    subjectId: p.subjectId,
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: 'SIMULATED_DEMO',
    isSimulated: true,
    startedAt: p.startedAt,
    endedAt: plus(p.startedAt, 120),
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: restStart, endedAt: plus(restStart, 45), confirmedAt: null, confirmedBy: null },
      { phase: 'RECOVERY', startedAt: recoveryStart, endedAt: plus(recoveryStart, 45), confirmedAt: recoveryStart, confirmedBy: 'WEARER' },
    ],
    measurements: [...samples('REST', restStart, p.rest), ...samples('RECOVERY', recoveryStart, p.recovery)],
    symptomCheck: { status: symptoms.length ? 'REPORTED' : 'NONE_REPORTED', answeredAt: checkAt },
    symptoms,
    summary: p.summary,
    provenance: { ...SIM_PROVENANCE, deviceId: p.deviceId },
  }
}

function simulatedWatchEvent(e: {
  eventId: string
  session: ReturnType<typeof plannedSession>
  deviceId: string
  category: 'REVIEW_SUGGESTED' | 'RECORDING_INCOMPLETE'
  severity: 'NOTICE' | 'REVIEW'
  reasonCodes: string[]
  evidence: { reasonCode: string; kind: 'SYMPTOM' | 'PHASE' | 'SESSION'; refId: string; note?: string }[]
  acknowledgedAfterSeconds?: number
  origin?: 'DEMO_FIXTURE' | 'DEMO_TRIGGER'
  createdAt?: string
}) {
  const createdAt = e.createdAt ?? plus(e.session.startedAt, 116)
  const presentedAt = plus(createdAt, 1)
  const acknowledgement =
    e.acknowledgedAfterSeconds !== undefined ? { acknowledgedAt: plus(presentedAt, e.acknowledgedAfterSeconds), via: 'SIMULATED_WATCH' } : null
  return {
    schemaVersion: EVENT_SCHEMA,
    eventId: e.eventId,
    subjectId: e.session.subjectId,
    sessionId: e.session.sessionId,
    createdAt,
    origin: { kind: e.origin ?? 'DEMO_FIXTURE', ruleSet: 'simulated watch rules 1.0', deviceId: e.deviceId },
    category: e.category,
    severity: e.severity,
    reasonCodes: e.reasonCodes,
    evidence: e.evidence.map((x) => ({ ...x, note: x.note ?? null })),
    watchMessage: e.category === 'REVIEW_SUGGESTED' ? { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' } : { title: 'CHECK INCOMPLETE', body: 'OPEN MISSION COMPUTER' },
    status: acknowledgement ? 'ACKNOWLEDGED' : 'DELIVERED',
    delivery: { channel: 'SIMULATED_WATCH', state: 'PRESENTED', presentedAt, hapticRequested: true, lastAttemptAt: presentedAt, confirmedBy: 'SIMULATION' },
    acknowledgement,
    isSimulated: true,
    provenance: { ...SIM_PROVENANCE, deviceId: e.deviceId },
  }
}

/** The deterministic demo bundle written to fixtures/simulated/demo-bundle.json. */
export function buildDemoBundle() {
  const a1 = plannedSession({
    sessionId: 'sim-a-20261109',
    subjectId: 'sim-crew-a',
    deviceId: 'sim-watch-a',
    startedAt: '2026-11-09T14:00:00Z',
    rest: [68, 69, 70, 70, 71, 70, 69, 70, 71],
    recovery: [77, 78, 79, 80, 79, 80, 78, 79, 79],
    summary: { status: 'RECORDED', restMedianBpm: 70, recoveryMedianBpm: 79, deltaBpm: 9, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  const a2 = plannedSession({
    sessionId: 'sim-a-20261110',
    subjectId: 'sim-crew-a',
    deviceId: 'sim-watch-a',
    startedAt: '2026-11-10T14:05:00Z',
    rest: [70, 71, 71, 72, 70, 71, 72, 71, 70],
    recovery: [81, 82, 83, 82, 81, 82, 83, 82, 81],
    summary: { status: 'RECORDED', restMedianBpm: 71, recoveryMedianBpm: 82, deltaBpm: 11, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  // Scenario A
  const a3 = plannedSession({
    sessionId: 'sim-a-20261111',
    subjectId: 'sim-crew-a',
    deviceId: 'sim-watch-a',
    startedAt: '2026-11-11T14:02:00Z',
    rest: [69, 70, 71, 70, 72, 71, 70, 71, 70],
    recovery: [80, 82, 83, 82, 81, 82, 83, 82, 84],
    summary: { status: 'RECORDED', restMedianBpm: 70, recoveryMedianBpm: 82, deltaBpm: 12, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  // Scenario B
  const b = plannedSession({
    sessionId: 'sim-a-20261112',
    subjectId: 'sim-crew-a',
    deviceId: 'sim-watch-a',
    startedAt: '2026-11-12T14:10:00Z',
    rest: [71, 72, 70, 71, 73, 72, 71, 72, 71],
    recovery: [88, 92, null, 95, 97, 96, { v: 131, q: 'QUESTIONABLE' }, 94, 93, 95, 94],
    symptoms: [{ code: 'DIZZY' }],
    summary: { status: 'REVIEW_SUGGESTED', restMedianBpm: 71, recoveryMedianBpm: 94, deltaBpm: 23, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  // Scenario C
  const c = plannedSession({
    sessionId: 'sim-b-20261112',
    subjectId: 'sim-crew-b',
    deviceId: 'sim-watch-b',
    startedAt: '2026-11-12T16:20:00Z',
    rest: [null, 74, null, { v: 0, q: 'INVALID' }],
    recovery: [null, null, 86, null],
    summary: { status: 'INCOMPLETE', restMedianBpm: null, recoveryMedianBpm: null, deltaBpm: null, restValidSamples: 1, recoveryValidSamples: 1 },
  })
  // Scenario F
  const f = plannedSession({
    sessionId: 'sim-b-20261113a',
    subjectId: 'sim-crew-b',
    deviceId: 'sim-watch-b',
    startedAt: '2026-11-13T09:30:00Z',
    rest: [76, 77, 75, 76, 78, 77, 76, 77, 76],
    recovery: [90, 93, 95, 94, 96, 95, 94, 93, 95],
    symptoms: [{ code: 'WEAK', bodyRegion: 'LEGS', note: 'Legs felt weak (simulated self-report)' }],
    summary: { status: 'REVIEW_SUGGESTED', restMedianBpm: 76, recoveryMedianBpm: 94, deltaBpm: 18, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  // Scenario D (the cuff reading below is linked to this session)
  const d = plannedSession({
    sessionId: 'sim-b-20261113b',
    subjectId: 'sim-crew-b',
    deviceId: 'sim-watch-b',
    startedAt: '2026-11-13T15:45:00Z',
    rest: [74, 75, 75, 76, 74, 75, 76, 75, 74],
    recovery: [86, 88, 87, 89, 88, 87, 88, 89, 87],
    summary: { status: 'RECORDED', restMedianBpm: 75, recoveryMedianBpm: 88, deltaBpm: 13, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  const cuff = (measurementId: string, indicator: 'BLOOD_PRESSURE_SYSTOLIC' | 'BLOOD_PRESSURE_DIASTOLIC', value: number) => ({
    measurementId,
    subjectId: 'sim-crew-b',
    sessionId: d.sessionId,
    indicator,
    value,
    unit: 'mmHg',
    measuredAt: '2026-11-13T09:05:00Z',
    phase: null,
    source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff (simulated)', sensor: 'Oscillometric cuff' },
    provenance: { origin: 'DEMO_FIXTURE', appVersion: 'demo-fixtures 1.0', deviceId: null },
    isSimulated: true,
    quality: 'QUESTIONABLE',
  })
  const events = [
    simulatedWatchEvent({
      eventId: 'sim-evt-20261112-a',
      session: b,
      deviceId: 'sim-watch-a',
      category: 'REVIEW_SUGGESTED',
      severity: 'REVIEW',
      reasonCodes: ['SYMPTOM_REPORTED'],
      evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: `${b.sessionId}-s1` }],
    }),
    simulatedWatchEvent({
      eventId: 'sim-evt-20261112-b',
      session: c,
      deviceId: 'sim-watch-b',
      category: 'RECORDING_INCOMPLETE',
      severity: 'NOTICE',
      reasonCodes: ['INSUFFICIENT_HR_SAMPLES', 'MISSING_BASELINE'],
      evidence: [
        { reasonCode: 'INSUFFICIENT_HR_SAMPLES', kind: 'PHASE', refId: 'REST' },
        { reasonCode: 'INSUFFICIENT_HR_SAMPLES', kind: 'PHASE', refId: 'RECOVERY' },
        { reasonCode: 'MISSING_BASELINE', kind: 'SESSION', refId: c.sessionId },
      ],
    }),
    simulatedWatchEvent({
      eventId: 'sim-evt-20261113-b',
      session: f,
      deviceId: 'sim-watch-b',
      category: 'REVIEW_SUGGESTED',
      severity: 'REVIEW',
      reasonCodes: ['SYMPTOM_REPORTED', 'MISSING_BASELINE'],
      evidence: [
        { reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: `${f.sessionId}-s1` },
        { reasonCode: 'MISSING_BASELINE', kind: 'SESSION', refId: f.sessionId },
      ],
      acknowledgedAfterSeconds: 42,
    }),
  ]
  return {
    schemaVersion: BUNDLE_SCHEMA,
    exportedAt: '2026-11-13T16:00:00Z',
    producer: { app: 'gravityguard-demo-fixtures', appVersion: '1.0', deviceId: null, deviceModel: 'Simulated watch' },
    sessions: [a1, a2, a3, b, c, f, d],
    events,
    measurements: [cuff('sim-cuff-20261113-sys', 'BLOOD_PRESSURE_SYSTOLIC', 142), cuff('sim-cuff-20261113-dia', 'BLOOD_PRESSURE_DIASTOLIC', 91)],
  }
}

/** Simulated watch records for the demo workspace. Their last contact times are fixed in the past. */
export const DEMO_DEVICES: DeviceRecord[] = [
  {
    deviceId: 'sim-watch-a',
    subjectId: 'sim-crew-a',
    isSimulated: true,
    firstSeenAt: '2026-11-09T13:58:00Z',
    lastSeenAt: '2026-11-12T14:13:00Z',
    lastSyncAt: '2026-11-12T14:13:00Z',
    appVersion: 'simulated',
    deviceModel: 'Simulated watch',
    pendingRecords: 0,
  },
  {
    deviceId: 'sim-watch-b',
    subjectId: 'sim-crew-b',
    isSimulated: true,
    firstSeenAt: '2026-11-12T16:18:00Z',
    lastSeenAt: '2026-11-13T15:48:00Z',
    lastSyncAt: '2026-11-13T15:48:00Z',
    appVersion: 'simulated',
    deviceModel: 'Simulated watch',
    pendingRecords: 0,
  },
]

const compact = (at: string) => at.replace(/[-:]/g, '').replace(/\.\d+/, '')

/**
 * A simulated watch check generated when someone presses "Trigger simulated watch event".
 * The event is created at the press time; the simulated readings span the two minutes before it.
 */
export function buildTriggeredDemo(now: string) {
  const startedAt = plus(now, -118)
  const id = `sim-trigger-${compact(now)}`
  const session = plannedSession({
    sessionId: id,
    subjectId: 'sim-crew-a',
    deviceId: 'sim-watch-a',
    startedAt,
    rest: [71, 72, 70, 71, 73, 72, 71, 72, 71],
    recovery: [88, 92, 95, 97, 96, 94, 93, 95, 94],
    symptoms: [{ code: 'DIZZY' }],
    summary: { status: 'REVIEW_SUGGESTED', restMedianBpm: 71, recoveryMedianBpm: 94, deltaBpm: 23, restValidSamples: 9, recoveryValidSamples: 9 },
  })
  // plannedSession puts the symptom check at start+115s and ends at start+120s; pull them in
  // so nothing is timestamped after the press.
  session.endedAt = now
  session.symptomCheck.answeredAt = plus(now, -2)
  for (const s of session.symptoms) s.reportedAt = plus(now, -2)
  session.provenance = { ...session.provenance, appVersion: 'demo-trigger 1.0' }
  const event = simulatedWatchEvent({
    eventId: `${id}-evt`,
    session,
    deviceId: 'sim-watch-a',
    category: 'REVIEW_SUGGESTED',
    severity: 'REVIEW',
    reasonCodes: ['SYMPTOM_REPORTED'],
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: `${id}-s1` }],
    origin: 'DEMO_TRIGGER',
    createdAt: plus(now, -1),
  })
  return { session, event }
}

/**
 * Replace the demo workspace with the fixture bundle, run through the same ingest pipeline and
 * computer-side checks as real data. Only the demo workspace is touched.
 */
export function loadDemo(datasets: Datasets, bundle: unknown, now: string) {
  datasets.demo = emptyDataset('demo')
  const { records, errors } = expandPayload(bundle)
  if (errors.length) throw new Error(`demo bundle is malformed: ${errors.join('; ')}`)
  const { results } = ingestRecords(datasets, records, { now, path: 'DEMO_FIXTURE', fileName: 'fixtures/simulated/demo-bundle.json' })
  const bad = results.filter((r) => r.outcome !== 'CREATED')
  if (bad.length) throw new Error(`demo bundle did not load cleanly: ${bad.map((r) => `${r.id}: ${r.outcome} ${r.detail ?? ''}`).join('; ')}`)
  for (const d of DEMO_DEVICES) datasets.demo.devices[d.deviceId] = { ...d }
  const createdEvents = runDataChecks(datasets.demo, now)
  return { results, createdEvents }
}
