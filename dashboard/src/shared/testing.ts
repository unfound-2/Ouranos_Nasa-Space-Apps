/**
 * Test-only builders. They produce stored records directly (already normalised) so the
 * analysis and ingest tests can describe a scenario in one line. Nothing in src/client or
 * src/server imports this file.
 */
import type { StoredEvent, StoredMeasurement, StoredSession } from './contract'
import { EVENT_SCHEMA, SESSION_SCHEMA } from './contract'

type Q = 'VALID' | 'QUESTIONABLE' | 'INVALID' | 'MISSING'
export type Sample = number | null | { v: number | null; q: Q } | { at: string; v: number | null; q?: Q }

const addSeconds = (iso: string, s: number) => new Date(Date.parse(iso) + s * 1000).toISOString().replace('.000Z', 'Z')

export interface SessionSpec {
  sessionId?: string
  subjectId?: string
  startedAt?: string
  rest?: Sample[]
  recovery?: Sample[]
  isSimulated?: boolean
  protocolId?: 'GRAVITY_RECOVERY_CHECK' | 'TRAINING_DEMO'
  protocolVersion?: string
  endReason?: StoredSession['endReason']
  symptoms?: StoredSession['symptoms']
  symptomStatus?: StoredSession['symptomCheck']['status']
  /** Omit a phase record entirely, or leave its end open. */
  restPhase?: 'complete' | 'open' | 'absent'
  recoveryPhase?: 'complete' | 'open' | 'absent'
}

/**
 * Layout: rest phase runs start+5s..start+50s with samples at start+8s, +13s, ...;
 * recovery runs start+65s..start+110s with samples at start+68s, +73s, ...
 */
export function buildSession(spec: SessionSpec = {}): StoredSession {
  const sessionId = spec.sessionId ?? 'ses-1'
  const subjectId = spec.subjectId ?? 'crew-a'
  const startedAt = spec.startedAt ?? '2026-11-14T19:30:00Z'
  const isSimulated = spec.isSimulated ?? false
  const provenance = {
    origin: isSimulated ? ('DEMO_FIXTURE' as const) : ('WATCH_APP' as const),
    appVersion: '0.1.0',
    deviceId: 'watch-1',
    ingestPath: isSimulated ? ('DEMO_FIXTURE' as const) : ('LIVE_SYNC' as const),
    receivedAt: addSeconds(startedAt, 130),
    importFileName: null,
  }
  let n = 0
  const toMeasurement = (phase: 'REST' | 'RECOVERY', base: number) => (s: Sample, i: number): StoredMeasurement => {
    let at = addSeconds(startedAt, base + i * 5)
    let value: number | null
    let quality: Q
    if (s === null) {
      value = null
      quality = 'MISSING'
    } else if (typeof s === 'number') {
      value = s
      quality = 'VALID'
    } else {
      if ('at' in s) at = s.at
      value = s.v
      quality = s.q ?? (s.v === null ? 'MISSING' : 'VALID')
    }
    n += 1
    return {
      measurementId: `${sessionId}-m${n}`,
      subjectId,
      sessionId,
      indicator: 'HEART_RATE',
      value,
      unit: 'bpm',
      measuredAt: at,
      receivedAt: provenance.receivedAt,
      phase,
      source: { kind: isSimulated ? 'SIMULATOR' : 'APPLE_WATCH', device: 'Apple Watch SE', sensor: 'Optical heart sensor' },
      provenance,
      isSimulated,
      quality,
    }
  }
  const phases: StoredSession['phases'] = []
  const restPhase = spec.restPhase ?? 'complete'
  const recoveryPhase = spec.recoveryPhase ?? 'complete'
  if (restPhase !== 'absent')
    phases.push({
      phase: 'REST',
      startedAt: addSeconds(startedAt, 5),
      endedAt: restPhase === 'complete' ? addSeconds(startedAt, 50) : null,
      confirmedAt: null,
      confirmedBy: null,
    })
  if (recoveryPhase !== 'absent')
    phases.push({
      phase: 'RECOVERY',
      startedAt: addSeconds(startedAt, 65),
      endedAt: recoveryPhase === 'complete' ? addSeconds(startedAt, 110) : null,
      confirmedAt: addSeconds(startedAt, 65),
      confirmedBy: 'WEARER',
    })
  const symptoms = spec.symptoms ?? []
  const symptomStatus = spec.symptomStatus ?? (symptoms.length ? 'REPORTED' : 'NONE_REPORTED')
  const endReason = spec.endReason ?? 'COMPLETED'
  return {
    schemaVersion: SESSION_SCHEMA,
    sessionId,
    subjectId,
    protocol: { id: spec.protocolId ?? 'GRAVITY_RECOVERY_CHECK', version: spec.protocolVersion ?? '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: isSimulated ? 'SIMULATED_DEMO' : 'DEVICE_RECORDING',
    isSimulated,
    startedAt,
    endedAt: endReason === 'IN_PROGRESS' ? null : addSeconds(startedAt, 120),
    endReason,
    phases,
    measurements: [...(spec.rest ?? []).map(toMeasurement('REST', 8)), ...(spec.recovery ?? []).map(toMeasurement('RECOVERY', 68))],
    symptomCheck: {
      status: symptomStatus,
      answeredAt: symptomStatus === 'REPORTED' || symptomStatus === 'NONE_REPORTED' ? addSeconds(startedAt, 115) : null,
    },
    symptoms,
    summary: null,
    provenance,
  }
}

export function buildExternalReading(spec: {
  measurementId: string
  sessionId: string | null
  measuredAt: string
  value: number | null
  quality?: Q
  subjectId?: string
  isSimulated?: boolean
}): StoredMeasurement {
  const isSimulated = spec.isSimulated ?? false
  return {
    measurementId: spec.measurementId,
    subjectId: spec.subjectId ?? 'crew-a',
    sessionId: spec.sessionId,
    indicator: 'BLOOD_PRESSURE_SYSTOLIC',
    value: spec.value,
    unit: 'mmHg',
    measuredAt: spec.measuredAt,
    receivedAt: spec.measuredAt,
    phase: null,
    source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff', sensor: null },
    provenance: {
      origin: isSimulated ? 'DEMO_FIXTURE' : 'EXTERNAL_SYSTEM',
      appVersion: null,
      deviceId: null,
      ingestPath: isSimulated ? 'DEMO_FIXTURE' : 'FILE_IMPORT',
      receivedAt: spec.measuredAt,
      importFileName: null,
    },
    isSimulated,
    quality: spec.quality ?? (spec.value === null ? 'MISSING' : 'VALID'),
  }
}

export function buildEvent(spec: Partial<StoredEvent> & { eventId?: string } = {}): StoredEvent {
  const isSimulated = spec.isSimulated ?? false
  return {
    schemaVersion: EVENT_SCHEMA,
    eventId: 'evt-1',
    subjectId: 'crew-a',
    sessionId: 'ses-1',
    createdAt: '2026-11-14T19:31:56Z',
    origin: { kind: 'WATCH_RULES', ruleSet: 'watch-rules 0.1', deviceId: 'watch-1' },
    category: 'REVIEW_SUGGESTED',
    severity: 'REVIEW',
    reasonCodes: ['SYMPTOM_REPORTED'],
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: 'sym-1', note: null }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: {
      channel: 'WATCH_LOCAL',
      state: 'PRESENTED',
      presentedAt: '2026-11-14T19:31:57Z',
      hapticRequested: true,
      lastAttemptAt: '2026-11-14T19:31:57Z',
      confirmedBy: 'WATCH_APP',
    },
    acknowledgement: null,
    review: {
      state: 'NOT_STARTED',
      checklistId: null,
      checklistVersion: null,
      checkedItems: [],
      reviewer: null,
      reviewedAt: null,
      closedAt: null,
      notes: null,
      updatedAt: null,
    },
    statusHistory: [{ status: 'DELIVERED', at: '2026-11-14T19:31:57Z', actor: 'WATCH', note: null }],
    isSimulated,
    provenance: {
      origin: 'WATCH_APP',
      appVersion: '0.1.0',
      deviceId: 'watch-1',
      ingestPath: 'LIVE_SYNC',
      receivedAt: '2026-11-14T19:32:00Z',
      importFileName: null,
    },
    ...spec,
  }
}
