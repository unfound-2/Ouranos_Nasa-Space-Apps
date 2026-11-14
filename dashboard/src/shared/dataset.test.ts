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

  it('stores and finds records whose ids are also Object.prototype property names', () => {
    // "constructor", "toString" and "valueOf" are valid ids under the contract.
    const ds = fresh()
    const session = watchSession(false, { sessionId: 'constructor', measurements: [] })
    const reading = { ...hr('valueOf', 'REST', '2026-11-14T19:30:40Z', 71), sessionId: 'constructor', provenance: { origin: 'WATCH_APP', deviceId: 'watch-1' } }
    const event = watchEvent({ eventId: 'toString', sessionId: 'constructor' })
    const r = ingestRecords(ds, [session, reading, event], live)
    expect(r.results.map((x) => x.outcome)).toEqual(['CREATED', 'CREATED', 'CREATED'])
    const [ev] = resolveEvidence(ds.mission.events['toString'], ds.mission)
    expect(ev.found && ev.kind === 'SYMPTOM' && ev.symptom.symptomId).toBe('sym-1')
    const cites = buildEvent({ evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'DEVICE', refId: 'constructor', note: null }] })
    expect(resolveEvidence(cites, ds.mission)[0].found).toBe(false)
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

const thrown = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected an error')
}
const boundTo = (deviceId: string, subjectId: string) => ({
  deviceId,
  subjectId,
  isSimulated: false,
  firstSeenAt: NOW,
  lastSeenAt: NOW,
  lastSyncAt: null,
  appVersion: null,
  deviceModel: null,
  pendingRecords: null,
})
const ACKED = { status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH' } }
const FILE = { now: NOW, path: 'FILE_IMPORT' as const, fileName: 'watch-export.json' }

describe('links between subjects', () => {
  const cuffFor = (subjectId: string) => ({
    ...hr('bp-x', 'REST', '2026-11-14T19:30:40Z', 118),
    subjectId,
    indicator: 'BLOOD_PRESSURE_SYSTOLIC',
    unit: 'mmHg',
    phase: null,
    source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff', sensor: null },
    provenance: { origin: 'EXTERNAL_SYSTEM' },
  })

  it('rejects an event that names a stored session of another subject', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], live)
    const r = ingestRecords(ds, [watchEvent({ subjectId: 'crew-b' })], live)
    expect(r.results[0].outcome).toBe('REJECTED')
    expect(r.results[0].detail).toMatch(/ses-1.*different subject/)
    expect(Object.keys(ds.mission.events)).toEqual([])
  })

  it('rejects a session that stored readings or events already link to under another subject', () => {
    const viaEvent = fresh()
    expect(ingestRecords(viaEvent, [watchEvent({ subjectId: 'crew-b' })], live).results[0].outcome).toBe('CREATED')
    const s = ingestRecords(viaEvent, [watchSession()], live)
    expect(s.results[0].outcome).toBe('REJECTED')
    expect(s.results[0].detail).toMatch(/different subject/)
    expect(Object.keys(viaEvent.mission.sessions)).toEqual([])

    const viaReading = fresh()
    expect(ingestRecords(viaReading, [cuffFor('crew-b')], live).results[0].outcome).toBe('CREATED')
    expect(ingestRecords(viaReading, [watchSession()], live).results[0].outcome).toBe('REJECTED')
  })

  it('never stores a cross-subject link, whichever record arrives first', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], live)
    expect(ingestRecords(ds, [cuffFor('crew-b')], live).results[0].outcome).toBe('REJECTED')
    expect(ingestRecords(ds, [watchEvent({ subjectId: 'crew-b' })], live).results[0].outcome).toBe('REJECTED')
    expect(ingestRecords(ds, [cuffFor('crew-a')], live).results[0].outcome).toBe('CREATED')
  })
})

describe('what a file import may change', () => {
  const notShown = { channel: 'WATCH_LOCAL', state: 'NOT_ATTEMPTED', presentedAt: null, hapticRequested: null, lastAttemptAt: null, confirmedBy: null }
  const ONLY_THE_WATCH = 'delivery and acknowledgement of a stored event can only be reported by the watch over the device API'

  it('refuses a file copy that advances the delivery of a stored event', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent({ status: 'CREATED', delivery: notShown })], live)
    const r = ingestRecords(ds, [watchEvent()], FILE)
    expect(r.results[0]).toMatchObject({ outcome: 'CONFLICT', detail: ONLY_THE_WATCH })
    expect(ds.mission.events['evt-1'].delivery.state).toBe('NOT_ATTEMPTED')
  })

  it('refuses a file copy that adds an acknowledgement, but applies the same copy sent live by the watch', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    expect(ingestRecords(ds, [watchEvent(ACKED)], FILE).results[0]).toMatchObject({ outcome: 'CONFLICT', detail: ONLY_THE_WATCH })
    expect(ds.mission.events['evt-1'].acknowledgement).toBeNull()
    expect(ingestRecords(ds, [watchEvent(ACKED)], live).results[0].outcome).toBe('UPDATED')
  })

  it('keeps the delivery and acknowledgement a brand-new event in a file carries', () => {
    const ds = fresh()
    expect(ingestRecords(ds, [watchEvent(ACKED)], FILE).results[0].outcome).toBe('CREATED')
    expect(ds.mission.events['evt-1'].status).toBe('ACKNOWLEDGED')
    expect(ingestRecords(ds, [watchEvent(ACKED)], FILE).results[0].outcome).toBe('DUPLICATE')
  })
})

describe('computer checks only trust events this computer created', () => {
  it('a stored check event that this computer did not create does not hide a stale reading', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], FILE)
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
    ds.mission.events.forged = buildEvent({
      eventId: 'forged',
      origin: { kind: 'MISSION_COMPUTER_CHECK', ruleSet: 'computer-checks 1.0', deviceId: null },
      reasonCodes: ['SENSOR_DATA_STALE'],
      evidence: [{ reasonCode: 'SENSOR_DATA_STALE', kind: 'MEASUREMENT', refId: 'bp-1', note: null }],
    })
    expect(runDataChecks(ds.mission, NOW)).toEqual(['dq-ses-1'])
  })
})

describe('which device reported', () => {
  it('records the device that acknowledged and refuses a device bound to another crew member', () => {
    const e = buildEvent()
    const acked = applyAck(e, { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-1' }, 'DEVICE', boundTo('watch-1', 'crew-a'))
    expect(acked.acknowledgement).toEqual({ acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-1' })
    expect(acked.statusHistory.at(-1)?.note).toMatch(/watch-1/)
    expect(thrown(() => applyAck(e, { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-2' }, 'DEVICE', boundTo('watch-2', 'crew-b')))).toMatchObject({
      code: 'DEVICE_SUBJECT_MISMATCH',
      httpStatus: 409,
    })
    // A device this computer has not bound to anyone yet may report.
    expect(applyAck(e, { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-3' }, 'DEVICE', null).acknowledgement?.deviceId).toBe('watch-3')
  })

  it('records the device that confirmed a delivery and refuses a device bound to another crew member', () => {
    const queued = buildEvent({
      status: 'QUEUED',
      delivery: { channel: 'COMPUTER_TO_WATCH', state: 'QUEUED', presentedAt: null, hapticRequested: null, lastAttemptAt: NOW, confirmedBy: null },
    })
    const shown = applyDeliveryReport(queued, { presentedAt: NOW, hapticRequested: true, deviceId: 'watch-1' }, 'DEVICE', boundTo('watch-1', 'crew-a'))
    expect(shown.delivery).toMatchObject({ state: 'PRESENTED', confirmedBy: 'WATCH_APP', confirmedByDeviceId: 'watch-1' })
    expect(shown.statusHistory.at(-1)?.note).toMatch(/watch-1/)
    expect(
      thrown(() => applyDeliveryReport(queued, { presentedAt: NOW, hapticRequested: true, deviceId: 'watch-2' }, 'DEVICE', boundTo('watch-2', 'crew-b'))),
    ).toMatchObject({ code: 'DEVICE_SUBJECT_MISMATCH', httpStatus: 409 })
  })

  it('fills the confirming device from the producer provenance and still recognises a re-send', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent(ACKED)], live)
    const e = ds.mission.events['evt-1']
    expect(e.delivery.confirmedByDeviceId).toBe('watch-1')
    expect(e.acknowledgement?.deviceId).toBe('watch-1')
    const reported = e.statusHistory.filter((h) => h.status === 'DELIVERED' || h.status === 'ACKNOWLEDGED')
    expect(reported).toHaveLength(2)
    for (const h of reported) expect(h.note).toMatch(/watch-1/)
    expect(ingestRecords(ds, [watchEvent(ACKED)], live).results[0].outcome).toBe('DUPLICATE')
    // An event stored before these fields existed is still recognised.
    delete (e.delivery as { confirmedByDeviceId?: string | null }).confirmedByDeviceId
    delete (e.acknowledgement as { deviceId?: string | null }).deviceId
    expect(ingestRecords(ds, [watchEvent(ACKED)], live).results[0].outcome).toBe('DUPLICATE')
  })

  it('does not let a live re-send report for an alert from a device bound to another crew member', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    applyHeartbeat(ds.mission, { deviceId: 'watch-9', subjectId: 'crew-b', sentAt: NOW, appVersion: null, deviceModel: null, pendingRecords: null }, NOW)
    const other = watchEvent({ ...ACKED, provenance: { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-9' } })
    const r = ingestRecords(ds, [other], live)
    expect(r.results[0].outcome).toBe('CONFLICT')
    expect(r.results[0].detail).toMatch(/watch-9/)
    expect(ds.mission.events['evt-1'].acknowledgement).toBeNull()
  })
})

describe('re-sent copies', () => {
  it('ignores an older in-progress copy of a session that arrives late', () => {
    const ds = fresh()
    const finished = watchSession()
    const copy = (n: number) =>
      watchSession(false, { endedAt: null, endReason: 'IN_PROGRESS', measurements: finished.measurements.slice(0, n), symptomCheck: { status: 'NOT_ASKED', answeredAt: null }, symptoms: [] })
    expect(ingestRecords(ds, [copy(3)], live).results[0].outcome).toBe('CREATED')
    expect(ingestRecords(ds, [copy(5)], live).results[0].outcome).toBe('UPDATED')
    expect(ingestRecords(ds, [copy(3)], live).results[0].outcome).toBe('STALE_IGNORED')
    expect(ingestRecords(ds, [finished], live).results[0].outcome).toBe('UPDATED')
    for (const n of [3, 5]) expect(ingestRecords(ds, [copy(n)], live).results[0].outcome).toBe('STALE_IGNORED')
    expect(ds.mission.sessions['ses-1'].endReason).toBe('COMPLETED')
    expect(ds.mission.sessions['ses-1'].measurements).toHaveLength(6)
    const withNewReading = copy(3)
    withNewReading.measurements = [...withNewReading.measurements, hr('m9', 'RECOVERY', '2026-11-14T19:31:40Z', 90)]
    expect(ingestRecords(ds, [withNewReading], live).results[0].outcome).toBe('CONFLICT')
  })

  it('reports a re-sent event that differs only in provenance or extensions as a duplicate, keeping the first copy', () => {
    const ds = fresh()
    ingestRecords(ds, [watchEvent()], live)
    expect(ingestRecords(ds, [watchEvent()], live).results[0].detail).toBe('identical event already stored')
    const r = ingestRecords(ds, [watchEvent({ provenance: { origin: 'WATCH_APP', appVersion: '0.2.0', deviceId: 'watch-1' }, extensions: { build: 7 } })], live)
    expect(r.results[0]).toMatchObject({ outcome: 'DUPLICATE', detail: 'already stored; provenance and extensions are kept from the first copy' })
    expect(ds.mission.events['evt-1'].provenance.appVersion).toBe('0.1.0')
    expect(ds.mission.events['evt-1'].extensions).toBeUndefined()
  })

  it('still recognises a re-sent session stored before heartRateAccess existed', () => {
    const ds = fresh()
    ingestRecords(ds, [watchSession()], live)
    delete (ds.mission.sessions['ses-1'] as { heartRateAccess?: unknown }).heartRateAccess
    ds.mission.fingerprints['session:ses-1'] = ds.mission.fingerprints['session:ses-1'].replace(/"heartRateAccess":null,?/, '')
    expect(ingestRecords(ds, [watchSession()], live).results[0].outcome).toBe('DUPLICATE')
    expect(ingestRecords(ds, [watchSession(false, { heartRateAccess: null })], live).results[0].outcome).toBe('DUPLICATE')
  })
})

describe('simulated records are described as simulated', () => {
  const simEvent = (extra: Record<string, unknown> = {}) =>
    watchEvent({
      isSimulated: true,
      delivery: { channel: 'SIMULATED_WATCH', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', hapticRequested: true, confirmedBy: 'SIMULATION' },
      provenance: { origin: 'DEMO_FIXTURE', appVersion: 'demo', deviceId: 'sim-watch-a' },
      ...extra,
    })

  it('says "simulated watch" and "simulated acknowledgement" in the history, never "on the watch"', () => {
    const ds = fresh()
    ingestRecords(ds, [simEvent()], { now: NOW, path: 'DEMO_FIXTURE' })
    const later = simEvent({ status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'SIMULATED_WATCH' } })
    expect(ingestRecords(ds, [later], { now: NOW, path: 'DEMO_FIXTURE' }).results[0].outcome).toBe('UPDATED')
    const fresh2 = fresh()
    ingestRecords(fresh2, [later], { now: NOW, path: 'DEMO_FIXTURE' })
    for (const e of [ds.demo.events['evt-1'], fresh2.demo.events['evt-1']]) {
      const notes = Object.fromEntries(e.statusHistory.map((h) => [h.status, h.note]))
      expect(notes.DELIVERED).toBe('presented on the simulated watch (simulation)')
      expect(notes.ACKNOWLEDGED).toBe('simulated acknowledgement')
    }
  })

  it('stores a simulated heartbeat as a simulated device', () => {
    const ds = fresh()
    const d = applyHeartbeat(
      ds.demo,
      { deviceId: 'sim-watch-z', subjectId: 'sim-crew-a', sentAt: NOW, appVersion: null, deviceModel: null, pendingRecords: null, isSimulated: true },
      NOW,
    )
    expect(d.isSimulated).toBe(true)
    expect(linkState(d, NOW)).toBe('SIMULATED')
  })
})
