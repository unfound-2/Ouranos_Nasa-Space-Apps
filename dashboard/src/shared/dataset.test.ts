import { describe, expect, it } from 'vitest'
import { EVENT_SCHEMA, SESSION_SCHEMA } from './contract'
import {
  ActionError,
  applyAck,
  applyDeliveryReport,
  applyHeartbeat,
  applyReviewAction,
  emptyDataset,
  ingestRecords,
  linkState,
  recordSourceMode,
  resolveEvidence,
  REVIEW_CHECKLIST,
  runDataChecks,
  type Datasets,
} from './dataset'
import { buildEvent } from './testing'

const NOW = '2026-11-14T19:40:00Z'
const fresh = (): Datasets => ({ mission: emptyDataset('mission'), demo: emptyDataset('demo') })

const hr = (id: string, phase: 'REST' | 'RECOVERY', at: string, value: number | null, sim = false) => ({
  measurementId: id,
  subjectId: 'crew-a',
  sessionId: 'ses-1',
  indicator: 'HEART_RATE',
  value,
  unit: 'bpm',
  measuredAt: at,
  phase,
  source: { kind: sim ? 'SIMULATOR' : 'APPLE_WATCH', device: 'Apple Watch SE', sensor: 'Optical heart sensor' },
  isSimulated: sim,
  quality: value === null ? 'MISSING' : 'VALID',
})

function watchSession(sim = false, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: SESSION_SCHEMA,
    sessionId: 'ses-1',
    subjectId: 'crew-a',
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0' },
    mode: sim ? 'SIMULATED_DEMO' : 'DEVICE_RECORDING',
    isSimulated: sim,
    startedAt: '2026-11-14T19:30:00Z',
    endedAt: '2026-11-14T19:32:00Z',
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: '2026-11-14T19:30:05Z', endedAt: '2026-11-14T19:30:50Z' },
      { phase: 'RECOVERY', startedAt: '2026-11-14T19:31:05Z', endedAt: '2026-11-14T19:31:50Z' },
    ],
    measurements: [
      hr('m1', 'REST', '2026-11-14T19:30:10Z', 70, sim),
      hr('m2', 'REST', '2026-11-14T19:30:20Z', 72, sim),
      hr('m3', 'REST', '2026-11-14T19:30:30Z', 74, sim),
      hr('m4', 'RECOVERY', '2026-11-14T19:31:10Z', 82, sim),
      hr('m5', 'RECOVERY', '2026-11-14T19:31:20Z', 84, sim),
      hr('m6', 'RECOVERY', '2026-11-14T19:31:30Z', 86, sim),
    ],
    symptomCheck: { status: 'REPORTED', answeredAt: '2026-11-14T19:31:55Z' },
    symptoms: [{ symptomId: 'sym-1', code: 'DIZZY', reportedAt: '2026-11-14T19:31:55Z', phase: 'RECOVERY', reportedBy: 'SELF_REPORTED' }],
    provenance: { origin: sim ? 'DEMO_FIXTURE' : 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' },
    ...extra,
  }
}

function watchEvent(extra: Record<string, unknown> = {}) {
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
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: 'sym-1' }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: { channel: 'WATCH_LOCAL', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', hapticRequested: true, confirmedBy: 'WATCH_APP' },
    isSimulated: false,
    provenance: { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' },
    ...extra,
  }
}

const live = { now: NOW, path: 'LIVE_SYNC' as const }

describe('ingest and deduplication', () => {
  it('stores a new session once and reports a repeat as a duplicate', () => {
    const ds = fresh()
    expect(ingestRecords(ds, [watchSession()], live).results[0].outcome).toBe('CREATED')
    const again = ingestRecords(ds, [watchSession()], { ...live, now: '2026-11-14T19:45:00Z' })
    expect(again.results[0].outcome).toBe('DUPLICATE')
    expect(Object.keys(ds.mission.sessions)).toEqual(['ses-1'])
    expect(ds.mission.sessions['ses-1'].provenance.receivedAt).toBe(NOW)
  })

  it('re-importing an existing event id does not duplicate it', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], { now: NOW, path: 'FILE_IMPORT', fileName: 'watch-export.json' })
    const again = ingestRecords(ds, [watchEvent()], { now: NOW, path: 'FILE_IMPORT', fileName: 'watch-export.json' })
    expect(again.results[0].outcome).toBe('DUPLICATE')
    expect(Object.keys(ds.mission.events)).toHaveLength(1)
  })

  it('refuses a finished session re-sent with different readings and keeps the original', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], live)
    const changed = watchSession(false, { measurements: [hr('m1', 'REST', '2026-11-14T19:30:10Z', 99)] })
    expect(ingestRecords(ds, [changed], live).results[0].outcome).toBe('CONFLICT')
    expect(ds.mission.sessions['ses-1'].measurements).toHaveLength(6)
  })

  it('stores simulated records apart from mission records', () => {
    const ds = fresh()
    const r = ingestRecords(ds, [watchSession(true)], { now: NOW, path: 'DEMO_FIXTURE' })
    expect(r.results[0].workspace).toBe('demo')
    expect(Object.keys(ds.demo.sessions)).toEqual(['ses-1'])
    expect(Object.keys(ds.mission.sessions)).toEqual([])
  })

  it('cannot relabel a simulated record as a real one by re-sending it unflagged', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession(true)], { now: NOW, path: 'DEMO_FIXTURE' })
    const r = ingestRecords(ds, [watchSession(false)], live)
    expect(r.results[0].outcome).toBe('CONFLICT')
    expect(Object.keys(ds.mission.sessions)).toEqual([])
    expect(ds.demo.sessions['ses-1'].isSimulated).toBe(true)
  })

  it('rejects a real record arriving through the demo pathway', () => {
    const ds = fresh()
    expect(ingestRecords(ds, [watchSession(false)], { now: NOW, path: 'DEMO_FIXTURE' }).results[0].outcome).toBe('REJECTED')
  })

  it('rejects a whole file that mixes simulated and real records', () => {
    const ds = fresh()
    const r = ingestRecords(ds, [watchSession(true), watchEvent()], { now: NOW, path: 'FILE_IMPORT', fileName: 'mixed.json' })
    expect(r.results.every((x) => x.outcome === 'REJECTED')).toBe(true)
    expect(Object.keys(ds.demo.sessions)).toHaveLength(0)
    expect(Object.keys(ds.mission.events)).toHaveLength(0)
  })

  it('labels a watch file import as saved device data, not a live connection', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], { now: NOW, path: 'FILE_IMPORT', fileName: 'watch-export.json' })
    const s = ds.mission.sessions['ses-1']
    expect(s.provenance.ingestPath).toBe('SAVED_DEVICE_FILE')
    expect(s.measurements[0].provenance.ingestPath).toBe('SAVED_DEVICE_FILE')
    expect(recordSourceMode(s, 'VERIFIED')).toBe('SAVED DEVICE DATA')
  })

  it('applies a later copy of an event that adds the watch acknowledgement', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    const acked = watchEvent({ status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH' } })
    expect(ingestRecords(ds, [acked], live).results[0].outcome).toBe('UPDATED')
    expect(ds.mission.events['evt-1'].status).toBe('ACKNOWLEDGED')
    // A retry queue delivering the older copy afterwards must not undo the acknowledgement.
    expect(ingestRecords(ds, [watchEvent()], live).results[0].outcome).toBe('STALE_IGNORED')
    expect(ds.mission.events['evt-1'].acknowledgement?.acknowledgedAt).toBe('2026-11-14T19:32:30Z')
  })

  it('refuses a re-sent event whose reason codes changed', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    const r = ingestRecords(ds, [watchEvent({ reasonCodes: ['SYMPTOM_REPORTED', 'SENSOR_DATA_STALE'] })], live)
    expect(r.results[0].outcome).toBe('CONFLICT')
    expect(ds.mission.events['evt-1'].reasonCodes).toEqual(['SYMPTOM_REPORTED'])
  })
})

describe('event state machine', () => {
  const allItems = REVIEW_CHECKLIST.items.map((i) => i.id)

  it('keeps acknowledgement and review as separate states', () => {
    const acked = applyAck(buildEvent(), { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH' }, 'DEVICE')
    expect(acked.status).toBe('ACKNOWLEDGED')
    expect(acked.review.state).toBe('NOT_STARTED')
    const reviewed = applyReviewAction(acked, { action: 'MARK_REVIEWED', reviewer: 'CMO', checkedItems: allItems, notes: null }, NOW)
    expect(reviewed.status).toBe('REVIEWED')
    expect(reviewed.acknowledgement?.via).toBe('WATCH')
  })

  it('lets a reviewer review an event that was never acknowledged, without inventing an acknowledgement', () => {
    const reviewed = applyReviewAction(buildEvent(), { action: 'MARK_REVIEWED', reviewer: 'CMO', checkedItems: allItems, notes: null }, NOW)
    expect(reviewed.status).toBe('REVIEWED')
    expect(reviewed.acknowledgement).toBeNull()
  })

  it('cannot record an acknowledgement for an alert that never reached an unreachable watch', () => {
    const unreachable = buildEvent({
      status: 'WATCH_UNREACHABLE',
      delivery: { channel: 'COMPUTER_TO_WATCH', state: 'WATCH_UNREACHABLE', presentedAt: null, hapticRequested: null, lastAttemptAt: NOW, confirmedBy: null },
    })
    expect(() => applyAck(unreachable, { acknowledgedAt: NOW, via: 'WATCH' }, 'DEVICE')).toThrow(ActionError)
  })

  it('does not let the dashboard mark an alert delivered on the watch\'s behalf', () => {
    const queued = buildEvent({
      status: 'QUEUED',
      delivery: { channel: 'COMPUTER_TO_WATCH', state: 'QUEUED', presentedAt: null, hapticRequested: null, lastAttemptAt: NOW, confirmedBy: null },
    })
    expect(() => applyDeliveryReport(queued, { presentedAt: NOW, hapticRequested: true }, 'LOCAL_USER')).toThrow(ActionError)
    const delivered = applyDeliveryReport(queued, { presentedAt: NOW, hapticRequested: true }, 'DEVICE')
    expect(delivered.status).toBe('DELIVERED')
    expect(delivered.delivery.confirmedBy).toBe('WATCH_APP')
  })

  it('needs every checklist item before an event can be marked reviewed', () => {
    expect(() =>
      applyReviewAction(buildEvent(), { action: 'MARK_REVIEWED', reviewer: 'CMO', checkedItems: allItems.slice(1), notes: null }, NOW),
    ).toThrow(/checklist/i)
  })

  it('only closes an event that has been reviewed', () => {
    expect(() => applyReviewAction(buildEvent(), { action: 'CLOSE', reviewer: 'CMO', notes: null }, NOW)).toThrow(ActionError)
    const reviewed = applyReviewAction(buildEvent(), { action: 'MARK_REVIEWED', reviewer: 'CMO', checkedItems: allItems, notes: null }, NOW)
    const closed = applyReviewAction(reviewed, { action: 'CLOSE', reviewer: 'CMO', notes: 'Discussed with crew medical officer.' }, '2026-11-14T19:50:00Z')
    expect(closed.status).toBe('CLOSED')
    expect(closed.statusHistory.map((h) => h.status)).toEqual(['DELIVERED', 'REVIEWED', 'CLOSED'])
  })

  it('accepts a simulated acknowledgement only on a simulated event', () => {
    expect(() => applyAck(buildEvent(), { acknowledgedAt: NOW, via: 'SIMULATED_WATCH' }, 'LOCAL_USER')).toThrow(ActionError)
    const sim = buildEvent({
      isSimulated: true,
      delivery: { channel: 'SIMULATED_WATCH', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', hapticRequested: null, lastAttemptAt: null, confirmedBy: 'SIMULATION' },
    })
    expect(applyAck(sim, { acknowledgedAt: NOW, via: 'SIMULATED_WATCH' }, 'LOCAL_USER').status).toBe('ACKNOWLEDGED')
  })

  it('does not accept a watch acknowledgement from the dashboard', () => {
    expect(() => applyAck(buildEvent(), { acknowledgedAt: NOW, via: 'WATCH' }, 'LOCAL_USER')).toThrow(ActionError)
  })
})

describe('watch link and data-source labels', () => {
  it('reports a watch that has never checked in as not paired', () => {
    expect(linkState(null, NOW)).toBe('NOT_PAIRED')
  })

  it('verifies a link only from a recent authenticated contact', () => {
    const ds = emptyDataset('mission')
    const device = applyHeartbeat(ds, { deviceId: 'watch-1', subjectId: 'crew-a', sentAt: '2026-11-14T19:39:50Z', appVersion: '0.1.0', deviceModel: 'Apple Watch SE', pendingRecords: 0 }, '2026-11-14T19:39:50Z')
    expect(linkState(device, '2026-11-14T19:40:20Z')).toBe('VERIFIED')
    expect(linkState(device, '2026-11-14T19:45:00Z')).toBe('WATCH_UNREACHABLE')
  })

  it('never calls simulated data live, even with a fresh link', () => {
    expect(recordSourceMode({ isSimulated: true, provenance: { ingestPath: 'LIVE_SYNC' } }, 'VERIFIED')).toBe('SIMULATED DEMO')
  })

  it('calls live-synced data LIVE DEVICE only while the link is verified', () => {
    const rec = { isSimulated: false, provenance: { ingestPath: 'LIVE_SYNC' as const } }
    expect(recordSourceMode(rec, 'VERIFIED')).toBe('LIVE DEVICE')
    expect(recordSourceMode(rec, 'WATCH_UNREACHABLE')).toBe('SAVED DEVICE DATA')
  })

  it('labels manual entries and other imports for what they are', () => {
    expect(recordSourceMode({ isSimulated: false, provenance: { ingestPath: 'MANUAL_ENTRY' } }, 'VERIFIED')).toBe('MANUALLY ENTERED')
    expect(recordSourceMode({ isSimulated: false, provenance: { ingestPath: 'FILE_IMPORT' } }, 'VERIFIED')).toBe('IMPORTED')
  })
})

describe('computer-side checks and evidence', () => {
  it('opens the symptom a symptom-driven event cites', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession(), watchEvent()], live)
    const resolved = resolveEvidence(ds.mission.events['evt-1'], ds.mission)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].found).toBe(true)
    if (resolved[0].found && resolved[0].kind === 'SYMPTOM') expect(resolved[0].symptom.code).toBe('DIZZY')
    else throw new Error('expected the DIZZY symptom')
  })

  it('says so when the cited session has not arrived yet', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    const [r] = resolveEvidence(ds.mission.events['evt-1'], ds.mission)
    expect(r.found).toBe(false)
    if (!r.found) expect(r.reason).toBe('SESSION_NOT_RECEIVED')
  })

  it('creates one VERIFY_SOURCE event for a stale cuff reading and cannot deliver it to an unreachable watch', () => {
    const ds = fresh()
    // Imported from a file, so no watch has checked in: there is no verified link to deliver over.
    ingestRecords(ds, [watchSession()], { now: NOW, path: 'FILE_IMPORT', fileName: 'watch-export.json' })
    const cuff = {
      measurementId: 'bp-1',
      subjectId: 'crew-a',
      sessionId: 'ses-1',
      indicator: 'BLOOD_PRESSURE_SYSTOLIC',
      value: 118,
      unit: 'mmHg',
      measuredAt: '2026-11-14T13:00:00Z',
      phase: null,
      source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff', sensor: null },
      provenance: { origin: 'EXTERNAL_SYSTEM' },
      isSimulated: false,
      quality: 'VALID',
    }
    ingestRecords(ds, [cuff], { now: NOW, path: 'FILE_IMPORT', fileName: 'cuff.json' })
    const created = runDataChecks(ds.mission, NOW)
    expect(created).toHaveLength(1)
    const e = ds.mission.events[created[0]]
    expect(e.category).toBe('VERIFY_SOURCE')
    expect(e.reasonCodes).toEqual(['SENSOR_DATA_STALE'])
    expect(e.origin.kind).toBe('MISSION_COMPUTER_CHECK')
    expect(e.status).toBe('WATCH_UNREACHABLE')
    expect(runDataChecks(ds.mission, NOW)).toHaveLength(0)
  })
})
