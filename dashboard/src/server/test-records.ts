/**
 * Test-only builders for server tests: records in the shape the watch app sends (JSON as Swift's
 * JSONEncoder writes it, so some nil optionals are left out). Only *.test.ts files import this.
 * The values are invented for tests and never leave the temporary test data directories.
 */
import { BUNDLE_SCHEMA, EVENT_SCHEMA, SESSION_SCHEMA } from '../shared/contract'

type Json = Record<string, unknown>

export interface SessionSpec {
  sessionId?: string
  subjectId?: string
  deviceId?: string
  simulated?: boolean
}

function heartRate(spec: Required<SessionSpec>, n: number, phase: 'REST' | 'RECOVERY', at: string, value: number | null): Json {
  const m: Json = {
    measurementId: `${spec.sessionId}-m${n}`,
    subjectId: spec.subjectId,
    sessionId: spec.sessionId,
    indicator: 'HEART_RATE',
    unit: 'bpm',
    measuredAt: at,
    phase,
    source: spec.simulated
      ? { kind: 'SIMULATOR', device: 'Simulated watch', sensor: 'Simulated heart-rate values' }
      : { kind: 'APPLE_WATCH', device: 'Apple Watch', sensor: 'Optical heart sensor' },
    isSimulated: spec.simulated,
    quality: value === null ? 'MISSING' : 'VALID',
  }
  // Swift leaves out a nil Double, so a missing reading has no "value" key at all.
  if (value !== null) m.value = value
  return m
}

/** A completed recovery check with six readings; reading m3 has no value (left out, as Swift does). */
export function watchSession(spec: SessionSpec = {}, extra: Json = {}): Json & { measurements: Json[] } {
  const s: Required<SessionSpec> = {
    sessionId: spec.sessionId ?? 'ses-1',
    subjectId: spec.subjectId ?? 'crew-a',
    deviceId: spec.deviceId ?? 'watch-1',
    simulated: spec.simulated ?? false,
  }
  return {
    schemaVersion: SESSION_SCHEMA,
    sessionId: s.sessionId,
    subjectId: s.subjectId,
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: s.simulated ? 'SIMULATED_DEMO' : 'DEVICE_RECORDING',
    isSimulated: s.simulated,
    startedAt: '2026-11-14T19:30:00Z',
    endedAt: '2026-11-14T19:32:00Z',
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: '2026-11-14T19:30:05Z', endedAt: '2026-11-14T19:30:50Z' },
      { phase: 'RECOVERY', startedAt: '2026-11-14T19:31:05Z', endedAt: '2026-11-14T19:31:50Z', confirmedAt: '2026-11-14T19:31:05Z', confirmedBy: 'WEARER' },
    ],
    measurements: [
      heartRate(s, 1, 'REST', '2026-11-14T19:30:10Z', 70),
      heartRate(s, 2, 'REST', '2026-11-14T19:30:20Z', 72),
      heartRate(s, 3, 'REST', '2026-11-14T19:30:30Z', null),
      heartRate(s, 4, 'RECOVERY', '2026-11-14T19:31:10Z', 82),
      heartRate(s, 5, 'RECOVERY', '2026-11-14T19:31:20Z', 84),
      heartRate(s, 6, 'RECOVERY', '2026-11-14T19:31:30Z', 86),
    ],
    symptomCheck: { status: 'REPORTED', answeredAt: '2026-11-14T19:31:55Z' },
    symptoms: [{ symptomId: `${s.sessionId}-sym1`, code: 'DIZZY', reportedAt: '2026-11-14T19:31:55Z', phase: 'RECOVERY', reportedBy: 'SELF_REPORTED' }],
    provenance: { origin: s.simulated ? 'DEMO_FIXTURE' : 'WATCH_APP', appVersion: '0.1.0', deviceId: s.deviceId },
    ...extra,
  }
}

/** A review event the watch created and presented itself (WATCH_LOCAL, PRESENTED). */
export function watchEvent(extra: Json = {}): Json {
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
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: 'ses-1-sym1' }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: { channel: 'WATCH_LOCAL', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', hapticRequested: true, confirmedBy: 'WATCH_APP' },
    isSimulated: false,
    provenance: { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' },
    ...extra,
  }
}

/** A stand-alone blood-pressure reading typed in from a cuff. Questionable, so a data check flags it. */
export function cuffReading(extra: Json = {}): Json {
  return {
    measurementId: 'cuff-1',
    subjectId: 'crew-a',
    sessionId: null,
    indicator: 'BLOOD_PRESSURE_SYSTOLIC',
    value: 121,
    unit: 'mmHg',
    measuredAt: '2026-11-14T19:35:00Z',
    phase: null,
    source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff', sensor: null },
    provenance: { origin: 'EXTERNAL_SYSTEM' },
    isSimulated: false,
    quality: 'QUESTIONABLE',
    ...extra,
  }
}

export function watchBundle(sessions: Json[], events: Json[]): Json {
  return {
    schemaVersion: BUNDLE_SCHEMA,
    exportedAt: '2026-11-14T19:35:00Z',
    producer: { app: 'gravityguard-watch', appVersion: '0.1.0', deviceId: 'watch-1', deviceModel: 'Apple Watch' },
    sessions,
    events,
  }
}

export function heartbeat(extra: Json = {}): Json {
  return { deviceId: 'watch-1', subjectId: 'crew-a', sentAt: '2026-11-14T19:39:59Z', appVersion: '0.1.0', deviceModel: 'Apple Watch', pendingRecords: 0, ...extra }
}
