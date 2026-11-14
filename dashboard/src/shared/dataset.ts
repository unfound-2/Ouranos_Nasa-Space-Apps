/**
 * The mission computer's record store, as pure functions over plain data.
 *
 * The server keeps two datasets on disk: "mission" (real records only) and "demo"
 * (simulated records only). A record's isSimulated flag decides where it goes, and an id
 * that exists in one dataset can never be written into the other, so a simulated record
 * can never be re-sent as a real one.
 *
 * Nothing here makes a clinical decision. Events record what a rule saw and what people did.
 */
import { externalReadingFindings, type QualityFinding } from './analysis'
import {
  BUNDLE_SCHEMA,
  deriveEventStatus,
  EVENT_SCHEMA,
  parseMeasurement,
  parseReviewEvent,
  parseSession,
  SESSION_SCHEMA,
  type Heartbeat,
  type IngestPathT,
  type Measurement,
  type PhaseRecord,
  type Provenance,
  type RecoverySession,
  type ReviewAction,
  type ReviewEvent,
  type ReviewRecord,
  type StatusChange,
  type StoredEvent,
  type StoredMeasurement,
  type StoredSession,
  type Symptom,
} from './contract'

export type Workspace = 'mission' | 'demo'

export interface DeviceRecord {
  deviceId: string
  subjectId: string | null
  isSimulated: boolean
  firstSeenAt: string
  /** Last authenticated contact (heartbeat or live-synced record), stamped with this computer's clock. */
  lastSeenAt: string
  /** Last record received over live sync. */
  lastSyncAt: string | null
  appVersion: string | null
  deviceModel: string | null
  pendingRecords: number | null
}

export type Outcome = 'CREATED' | 'DUPLICATE' | 'UPDATED' | 'STALE_IGNORED' | 'CONFLICT' | 'REJECTED'
export type RecordKind = 'SESSION' | 'EVENT' | 'MEASUREMENT'

export interface LogEntry {
  at: string
  kind: RecordKind | 'HEARTBEAT' | 'ACTION' | 'CHECK'
  id: string | null
  outcome: Outcome | 'APPLIED'
  path: IngestPathT | null
  detail: string | null
}

export interface Dataset {
  workspace: Workspace
  formatVersion: 1
  sessions: Record<string, StoredSession>
  events: Record<string, StoredEvent>
  /** Stand-alone readings (external instruments, manual entry), linked to a session by sessionId. */
  readings: Record<string, StoredMeasurement>
  devices: Record<string, DeviceRecord>
  /** Producer-content fingerprints used to tell a repeat from a changed record. */
  fingerprints: Record<string, string>
  log: LogEntry[]
}

export interface Datasets {
  mission: Dataset
  demo: Dataset
}

export interface IngestContext {
  /** This computer's clock when the records arrived. */
  now: string
  path: IngestPathT
  fileName?: string | null
}

export interface IngestResult {
  kind: RecordKind | null
  id: string | null
  workspace: Workspace | null
  outcome: Outcome
  detail: string | null
}

export class ActionError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'ActionError'
  }
}

export const LINK_FRESH_SECONDS = 60
export const DELIVERY_CONFIRM_TIMEOUT_SECONDS = 120
const LOG_LIMIT = 300

export const REVIEW_CHECKLIST = {
  id: 'GG-REVIEW-CHECKLIST',
  version: '1.0',
  title: 'Health review checklist',
  disclaimer:
    'Educational checklist for this prototype. It is not a clinical protocol, does not prescribe treatment, and a completed review is not a medical clearance.',
  items: [
    { id: 'symptoms-reviewed', text: 'Review the recorded symptoms and their timestamps.' },
    { id: 'source-verified', text: 'Verify the source and quality of the measurements.' },
    { id: 'missing-data-identified', text: 'Identify relevant instrument data that is missing.' },
    { id: 'escalation-considered', text: 'Escalate concerning symptoms to the responsible crew medical professional.' },
    { id: 'review-documented', text: 'Document whether the record has been reviewed.' },
  ],
} as const

export const DEFAULT_REVIEW: ReviewRecord = {
  state: 'NOT_STARTED',
  checklistId: null,
  checklistVersion: null,
  checkedItems: [],
  reviewer: null,
  reviewedAt: null,
  closedAt: null,
  notes: null,
  updatedAt: null,
}

export function emptyDataset(workspace: Workspace): Dataset {
  return { workspace, formatVersion: 1, sessions: {}, events: {}, readings: {}, devices: {}, fingerprints: {}, log: [] }
}

// ---------------------------------------------------------------------------
// Helpers

const t = (iso: string) => Date.parse(iso)

/** Own-property lookup: ids such as "constructor" are valid and must not find Object.prototype members. */
const own = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined)

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

const blankIngest = (p: Provenance): Provenance => ({ ...p, ingestPath: null, receivedAt: null, importFileName: null })

function producerContent(kind: RecordKind, r: RecoverySession | ReviewEvent | Measurement): string {
  if (kind === 'SESSION') {
    const s = r as RecoverySession
    return stableStringify({
      ...s,
      provenance: blankIngest(s.provenance),
      measurements: s.measurements.map((m) => ({ ...m, receivedAt: null, provenance: m.provenance ? blankIngest(m.provenance) : undefined })),
    })
  }
  const m = r as Measurement
  return stableStringify({ ...m, receivedAt: null, provenance: m.provenance ? blankIngest(m.provenance) : undefined })
}

function log(ds: Dataset, entry: LogEntry) {
  ds.log.push(entry)
  if (ds.log.length > LOG_LIMIT) ds.log.splice(0, ds.log.length - LOG_LIMIT)
}

function resolvePath(ctx: IngestContext, origin: Provenance['origin']): IngestPathT {
  if (ctx.path === 'FILE_IMPORT' && origin === 'WATCH_APP') return 'SAVED_DEVICE_FILE'
  return ctx.path
}

function stamp(p: Provenance, ctx: IngestContext): Provenance {
  return { ...p, ingestPath: resolvePath(ctx, p.origin), receivedAt: ctx.now, importFileName: ctx.fileName ?? null }
}

function actorForChannel(channel: StoredEvent['delivery']['channel']): StatusChange['actor'] {
  if (channel === 'SIMULATED_WATCH') return 'SIMULATION'
  if (channel === 'COMPUTER_TO_WATCH') return 'MISSION_COMPUTER'
  return 'WATCH'
}

/** Rebuild the facts a producer reported as a time-ordered history. */
function historyFromProducer(e: ReviewEvent): StatusChange[] {
  const h: StatusChange[] = [
    { status: 'CREATED', at: e.createdAt, actor: e.origin.kind === 'MISSION_COMPUTER_CHECK' ? 'MISSION_COMPUTER' : actorForChannel(e.delivery.channel), note: null },
  ]
  const d = e.delivery
  const at = d.lastAttemptAt ?? e.createdAt
  if (d.state === 'QUEUED') h.push({ status: 'QUEUED', at, actor: actorForChannel(d.channel), note: null })
  if (d.state === 'WATCH_UNREACHABLE') h.push({ status: 'WATCH_UNREACHABLE', at, actor: 'MISSION_COMPUTER', note: null })
  if (d.state === 'UNCONFIRMED') h.push({ status: 'DELIVERY_UNCONFIRMED', at, actor: actorForChannel(d.channel), note: null })
  if (d.state === 'PRESENTED' && d.presentedAt)
    h.push({ status: 'DELIVERED', at: d.presentedAt, actor: d.confirmedBy === 'SIMULATION' ? 'SIMULATION' : 'WATCH', note: 'presented on the watch' })
  if (e.acknowledgement)
    h.push({
      status: 'ACKNOWLEDGED',
      at: e.acknowledgement.acknowledgedAt,
      actor: e.acknowledgement.via === 'SIMULATED_WATCH' ? 'SIMULATION' : 'WATCH',
      note: 'acknowledged on the watch',
    })
  return h
}

// ---------------------------------------------------------------------------
// Classification

type Classified =
  | { kind: 'SESSION'; record: RecoverySession }
  | { kind: 'EVENT'; record: ReviewEvent }
  | { kind: 'MEASUREMENT'; record: Measurement }
  | { kind: null; id: string | null; errors: string[] }

function rawId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = o.sessionId && o.schemaVersion === SESSION_SCHEMA ? o.sessionId : (o.eventId ?? o.measurementId ?? o.sessionId)
  return typeof id === 'string' ? id : null
}

export function classify(raw: unknown): Classified {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { kind: null, id: null, errors: ['expected a JSON object (a recovery session, review event or measurement)'] }
  const o = raw as Record<string, unknown>
  if (o.schemaVersion === SESSION_SCHEMA) {
    const r = parseSession(raw)
    return r.ok ? { kind: 'SESSION', record: r.value } : { kind: null, id: rawId(raw), errors: r.errors }
  }
  if (o.schemaVersion === EVENT_SCHEMA) {
    const r = parseReviewEvent(raw)
    return r.ok ? { kind: 'EVENT', record: r.value } : { kind: null, id: rawId(raw), errors: r.errors }
  }
  if ('measurementId' in o && 'indicator' in o) {
    const r = parseMeasurement(raw)
    return r.ok ? { kind: 'MEASUREMENT', record: r.value } : { kind: null, id: rawId(raw), errors: r.errors }
  }
  return {
    kind: null,
    id: rawId(raw),
    errors: [
      `unrecognised record: schemaVersion must be "${SESSION_SCHEMA}" or "${EVENT_SCHEMA}", or the object must be a measurement`,
    ],
  }
}

/** Accepts a bundle, an array of records, or one record, and returns the records inside. */
export function expandPayload(payload: unknown): { records: unknown[]; errors: string[] } {
  if (Array.isArray(payload)) return { records: payload, errors: [] }
  if (payload && typeof payload === 'object' && (payload as Record<string, unknown>).schemaVersion === BUNDLE_SCHEMA) {
    const b = payload as Record<string, unknown>
    const errors: string[] = []
    for (const key of ['sessions', 'events'] as const)
      if (!Array.isArray(b[key])) errors.push(`${key}: a bundle needs a "${key}" array (it may be empty)`)
    if (b.measurements !== undefined && !Array.isArray(b.measurements)) errors.push('measurements: must be an array when present')
    const allowed = new Set(['schemaVersion', 'exportedAt', 'producer', 'sessions', 'events', 'measurements'])
    const unknown = Object.keys(b).filter((k) => !allowed.has(k))
    if (unknown.length) errors.push(`(bundle): unknown field(s) ${unknown.join(', ')}`)
    if (errors.length) return { records: [], errors }
    return {
      records: [...(b.sessions as unknown[]), ...((b.measurements as unknown[]) ?? []), ...(b.events as unknown[])],
      errors: [],
    }
  }
  return { records: [payload], errors: [] }
}

// ---------------------------------------------------------------------------
// Ingest

function idOf(c: Exclude<Classified, { kind: null }>): string {
  if (c.kind === 'SESSION') return c.record.sessionId
  if (c.kind === 'EVENT') return c.record.eventId
  return c.record.measurementId
}

function exists(ds: Dataset, kind: RecordKind, id: string): boolean {
  if (kind === 'SESSION') return Object.hasOwn(ds.sessions, id)
  if (kind === 'EVENT') return Object.hasOwn(ds.events, id)
  return Object.hasOwn(ds.readings, id)
}

function touchDevice(ds: Dataset, deviceId: string | null, subjectId: string, isSimulated: boolean, now: string, synced: boolean) {
  if (!deviceId) return
  const prev = own(ds.devices, deviceId)
  ds.devices[deviceId] = {
    deviceId,
    subjectId: prev?.subjectId ?? subjectId,
    isSimulated,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastSyncAt: synced ? now : (prev?.lastSyncAt ?? null),
    appVersion: prev?.appVersion ?? null,
    deviceModel: prev?.deviceModel ?? null,
    pendingRecords: prev?.pendingRecords ?? null,
  }
}

function ingestSession(ds: Dataset, s: RecoverySession, ctx: IngestContext): { outcome: Outcome; detail: string | null } {
  const key = `session:${s.sessionId}`
  const fp = producerContent('SESSION', s)
  const existing = own(ds.sessions, s.sessionId)
  const provenance = stamp(s.provenance, ctx)
  const normalize = (receivedFor: (id: string) => string): StoredSession => ({
    ...s,
    provenance,
    measurements: s.measurements.map((m) => ({
      ...m,
      sessionId: s.sessionId,
      receivedAt: receivedFor(m.measurementId),
      provenance: m.provenance ? stamp(m.provenance, ctx) : provenance,
    })),
  })
  if (!existing) {
    ds.sessions[s.sessionId] = normalize(() => ctx.now)
    ds.fingerprints[key] = fp
    return { outcome: 'CREATED', detail: null }
  }
  if (ds.fingerprints[key] === fp) return { outcome: 'DUPLICATE', detail: 'identical session already stored' }
  const sameIdentity =
    existing.subjectId === s.subjectId &&
    existing.isSimulated === s.isSimulated &&
    existing.mode === s.mode &&
    existing.startedAt === s.startedAt &&
    stableStringify(existing.protocol) === stableStringify(s.protocol)
  const incomingIds = new Set(s.measurements.map((m) => m.measurementId))
  const keepsAll = existing.measurements.every((m) => incomingIds.has(m.measurementId))
  if (existing.endReason === 'IN_PROGRESS' && sameIdentity && keepsAll) {
    const prevReceived = new Map(existing.measurements.map((m) => [m.measurementId, m.receivedAt ?? ctx.now]))
    ds.sessions[s.sessionId] = normalize((id) => prevReceived.get(id) ?? ctx.now)
    ds.fingerprints[key] = fp
    return { outcome: 'UPDATED', detail: 'in-progress session extended' }
  }
  const differing = (Object.keys(s) as (keyof RecoverySession)[]).filter(
    (k) => k !== 'provenance' && stableStringify((s as Record<string, unknown>)[k]) !== stableStringify(k === 'measurements' ? existing.measurements.map((m) => ({ ...m, receivedAt: null, provenance: undefined })) : (existing as Record<string, unknown>)[k]),
  )
  return {
    outcome: 'CONFLICT',
    detail: `session ${s.sessionId} already exists with different content (${differing.join(', ') || 'provenance'}); the stored copy was kept`,
  }
}

function ingestReading(ds: Dataset, m: Measurement, ctx: IngestContext): { outcome: Outcome; detail: string | null } {
  const key = `reading:${m.measurementId}`
  const fp = producerContent('MEASUREMENT', m)
  if (own(ds.readings, m.measurementId)) {
    return ds.fingerprints[key] === fp
      ? { outcome: 'DUPLICATE', detail: 'identical reading already stored' }
      : { outcome: 'CONFLICT', detail: `reading ${m.measurementId} already exists with different content; the stored copy was kept` }
  }
  const linked = m.sessionId ? own(ds.sessions, m.sessionId) : undefined
  if (linked && linked.subjectId !== m.subjectId)
    return { outcome: 'REJECTED', detail: `reading ${m.measurementId} names session ${m.sessionId}, which belongs to a different subject` }
  const provenance = stamp(
    m.provenance ?? { origin: 'EXTERNAL_SYSTEM', appVersion: null, deviceId: null, ingestPath: null, receivedAt: null, importFileName: null },
    ctx,
  )
  ds.readings[m.measurementId] = { ...m, receivedAt: ctx.now, provenance }
  ds.fingerprints[key] = fp
  return { outcome: 'CREATED', detail: null }
}

const IMMUTABLE_EVENT_KEYS = [
  'subjectId',
  'sessionId',
  'createdAt',
  'origin',
  'category',
  'severity',
  'reasonCodes',
  'evidence',
  'watchMessage',
  'isSimulated',
] as const

const DELIVERY_RANK: Record<StoredEvent['delivery']['state'], number> = {
  NOT_ATTEMPTED: 0,
  QUEUED: 1,
  UNCONFIRMED: 2,
  WATCH_UNREACHABLE: 2,
  PRESENTED: 3,
}

function ingestEvent(ds: Dataset, e: ReviewEvent, ctx: IngestContext): { outcome: Outcome; detail: string | null } {
  const existing = own(ds.events, e.eventId)
  if (!existing) {
    const stored: StoredEvent = {
      ...e,
      provenance: stamp(e.provenance, ctx),
      review: { ...DEFAULT_REVIEW },
      statusHistory: historyFromProducer(e),
    }
    stored.status = deriveEventStatus(stored)
    ds.events[e.eventId] = stored
    return { outcome: 'CREATED', detail: null }
  }
  const changed = IMMUTABLE_EVENT_KEYS.filter((k) => stableStringify(existing[k]) !== stableStringify(e[k]))
  if (changed.length)
    return { outcome: 'CONFLICT', detail: `event ${e.eventId} already exists with different ${changed.join(', ')}; the stored copy was kept` }
  if (stableStringify([existing.delivery, existing.acknowledgement]) === stableStringify([e.delivery, e.acknowledgement]))
    return { outcome: 'DUPLICATE', detail: 'identical event already stored' }
  const dIn = DELIVERY_RANK[e.delivery.state]
  const dEx = DELIVERY_RANK[existing.delivery.state]
  const aIn = e.acknowledgement ? 1 : 0
  const aEx = existing.acknowledgement ? 1 : 0
  if (dIn >= dEx && aIn >= aEx && (dIn > dEx || aIn > aEx)) {
    const history = [...existing.statusHistory]
    if (dIn > dEx && e.delivery.state === 'PRESENTED' && e.delivery.presentedAt)
      history.push({ status: 'DELIVERED', at: e.delivery.presentedAt, actor: e.delivery.confirmedBy === 'SIMULATION' ? 'SIMULATION' : 'WATCH', note: 'presented on the watch' })
    if (aIn > aEx && e.acknowledgement)
      history.push({
        status: 'ACKNOWLEDGED',
        at: e.acknowledgement.acknowledgedAt,
        actor: e.acknowledgement.via === 'SIMULATED_WATCH' ? 'SIMULATION' : 'WATCH',
        note: 'acknowledged on the watch',
      })
    const updated: StoredEvent = { ...existing, delivery: e.delivery, acknowledgement: e.acknowledgement ?? existing.acknowledgement, statusHistory: history }
    updated.status = deriveEventStatus(updated)
    ds.events[e.eventId] = updated
    return { outcome: 'UPDATED', detail: 'delivery or acknowledgement advanced' }
  }
  return { outcome: 'STALE_IGNORED', detail: 'an older copy of this event; the newer stored state was kept' }
}

/**
 * Validate and store a batch of records. A batch is all-or-nothing for validation: if any
 * record is malformed, or the batch mixes simulated and real records, nothing is stored.
 */
export function ingestRecords(ds: Datasets, raws: unknown[], ctx: IngestContext): { results: IngestResult[] } {
  const classified = raws.map(classify)
  const invalid = classified.filter((c) => c.kind === null)
  if (invalid.length) {
    return {
      results: classified.map((c) =>
        c.kind === null
          ? { kind: null, id: c.id, workspace: null, outcome: 'REJECTED' as const, detail: c.errors.join('; ') }
          : { kind: c.kind, id: idOf(c), workspace: null, outcome: 'REJECTED' as const, detail: 'not stored because another record in this batch is invalid' },
      ),
    }
  }
  const valid = classified as Exclude<Classified, { kind: null }>[]
  const flags = new Set(valid.map((c) => c.record.isSimulated))
  if (flags.size > 1) {
    return {
      results: valid.map((c) => ({
        kind: c.kind,
        id: idOf(c),
        workspace: null,
        outcome: 'REJECTED' as const,
        detail: 'a batch cannot mix simulated and real records; send them separately',
      })),
    }
  }
  const results: IngestResult[] = []
  for (const c of valid) {
    const id = idOf(c)
    const sim = c.record.isSimulated
    const ws: Workspace = sim ? 'demo' : 'mission'
    const target = ds[ws]
    const other = ds[sim ? 'mission' : 'demo']
    const base = { kind: c.kind, id, workspace: ws }
    let res: { outcome: Outcome; detail: string | null }
    if ((ctx.path === 'DEMO_FIXTURE' || ctx.path === 'DEMO_TRIGGER') && !sim)
      res = { outcome: 'REJECTED', detail: 'the demo pathway only accepts records with isSimulated = true' }
    else if (ctx.path === 'MANUAL_ENTRY' && (c.kind !== 'MEASUREMENT' || !['MANUAL_ENTRY', 'EXTERNAL_INSTRUMENT'].includes(c.record.source.kind)))
      res = { outcome: 'REJECTED', detail: 'manual entry is only for readings from an external instrument or typed in by hand' }
    else if (exists(other, c.kind, id))
      res = {
        outcome: 'CONFLICT',
        detail: sim
          ? `${id} already exists as a real record; it cannot be re-sent as simulated`
          : `${id} already exists as a simulated record; a simulated record cannot become real`,
      }
    else if (c.kind === 'SESSION') res = ingestSession(target, c.record, ctx)
    else if (c.kind === 'EVENT') res = ingestEvent(target, c.record, ctx)
    else res = ingestReading(target, c.record, ctx)

    if (ctx.path === 'LIVE_SYNC' && (res.outcome === 'CREATED' || res.outcome === 'UPDATED' || res.outcome === 'DUPLICATE')) {
      const deviceId = c.kind === 'MEASUREMENT' ? (c.record.provenance?.deviceId ?? null) : c.record.provenance.deviceId
      touchDevice(target, deviceId, c.record.subjectId, sim, ctx.now, true)
    }
    log(target, { at: ctx.now, kind: c.kind, id, outcome: res.outcome, path: ctx.path, detail: res.detail })
    results.push({ ...base, ...res })
  }
  return { results }
}

// ---------------------------------------------------------------------------
// Devices and labels

export type LinkState = 'VERIFIED' | 'WATCH_UNREACHABLE' | 'NOT_PAIRED' | 'SIMULATED'

export function applyHeartbeat(ds: Dataset, hb: Heartbeat, now: string): DeviceRecord {
  const prev = own(ds.devices, hb.deviceId)
  const device: DeviceRecord = {
    deviceId: hb.deviceId,
    subjectId: hb.subjectId ?? prev?.subjectId ?? null,
    isSimulated: false,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastSyncAt: prev?.lastSyncAt ?? null,
    appVersion: hb.appVersion ?? prev?.appVersion ?? null,
    deviceModel: hb.deviceModel ?? prev?.deviceModel ?? null,
    pendingRecords: hb.pendingRecords,
  }
  ds.devices[hb.deviceId] = device
  log(ds, { at: now, kind: 'HEARTBEAT', id: hb.deviceId, outcome: 'APPLIED', path: 'LIVE_SYNC', detail: null })
  return device
}

/** A link is verified only by an authenticated contact within the last LINK_FRESH_SECONDS. */
export function linkState(device: DeviceRecord | null | undefined, now: string): LinkState {
  if (!device) return 'NOT_PAIRED'
  if (device.isSimulated) return 'SIMULATED'
  return t(now) - t(device.lastSeenAt) <= LINK_FRESH_SECONDS * 1000 ? 'VERIFIED' : 'WATCH_UNREACHABLE'
}

export function subjectDevice(ds: Dataset, subjectId: string): DeviceRecord | null {
  let best: DeviceRecord | null = null
  for (const d of Object.values(ds.devices))
    if (d.subjectId === subjectId && (!best || t(d.lastSeenAt) > t(best.lastSeenAt))) best = d
  return best
}

export type SourceMode = 'LIVE DEVICE' | 'SAVED DEVICE DATA' | 'MANUALLY ENTERED' | 'IMPORTED' | 'SIMULATED DEMO' | 'UNAVAILABLE'

/** The label a record carries on screen. Simulated always wins; LIVE needs a verified link right now. */
export function recordSourceMode(record: { isSimulated: boolean; provenance: { ingestPath: IngestPathT | null } }, link: LinkState): SourceMode {
  if (record.isSimulated) return 'SIMULATED DEMO'
  switch (record.provenance.ingestPath) {
    case 'LIVE_SYNC':
      return link === 'VERIFIED' ? 'LIVE DEVICE' : 'SAVED DEVICE DATA'
    case 'SAVED_DEVICE_FILE':
      return 'SAVED DEVICE DATA'
    case 'MANUAL_ENTRY':
      return 'MANUALLY ENTERED'
    default:
      return 'IMPORTED'
  }
}

// ---------------------------------------------------------------------------
// Actions on events

const withStatus = (e: StoredEvent): StoredEvent => ({ ...e, status: deriveEventStatus(e) })

export function applyAck(
  event: StoredEvent,
  req: { acknowledgedAt: string; via: 'WATCH' | 'SIMULATED_WATCH' },
  actor: 'DEVICE' | 'LOCAL_USER',
): StoredEvent {
  if (event.acknowledgement) {
    if (event.acknowledgement.acknowledgedAt === req.acknowledgedAt && event.acknowledgement.via === req.via) return event
    throw new ActionError('ALREADY_ACKNOWLEDGED', 409, 'This alert was already acknowledged.')
  }
  if (event.delivery.state !== 'PRESENTED')
    throw new ActionError('NOT_PRESENTED', 409, 'The alert was never presented on the watch, so it cannot have been acknowledged there.')
  if (req.via === 'WATCH') {
    if (actor !== 'DEVICE') throw new ActionError('WATCH_ACK_REQUIRES_DEVICE', 403, 'Only the watch app can report a watch acknowledgement.')
    if (event.isSimulated) throw new ActionError('SIMULATED_EVENT', 409, 'A simulated event cannot be acknowledged by a real watch.')
  } else if (!event.isSimulated) {
    throw new ActionError('REAL_EVENT', 409, 'A real event cannot receive a simulated acknowledgement.')
  }
  if (event.delivery.presentedAt && t(req.acknowledgedAt) < t(event.delivery.presentedAt))
    throw new ActionError('ACK_BEFORE_PRESENTED', 422, 'acknowledgedAt is earlier than the time the alert was presented.')
  return withStatus({
    ...event,
    acknowledgement: { acknowledgedAt: req.acknowledgedAt, via: req.via },
    statusHistory: [
      ...event.statusHistory,
      {
        status: 'ACKNOWLEDGED',
        at: req.acknowledgedAt,
        actor: req.via === 'WATCH' ? 'WATCH' : 'SIMULATION',
        note: req.via === 'WATCH' ? 'acknowledged on the watch' : 'simulated acknowledgement (demo)',
      },
    ],
  })
}

export function applyDeliveryReport(
  event: StoredEvent,
  req: { presentedAt: string; hapticRequested: boolean | null },
  actor: 'DEVICE' | 'LOCAL_USER',
): StoredEvent {
  if (actor !== 'DEVICE')
    throw new ActionError(
      'WATCH_CONFIRMATION_REQUIRED',
      403,
      'Only the watch app can confirm that it displayed an alert. A successful send is not proof of delivery.',
    )
  if (event.isSimulated) throw new ActionError('SIMULATED_EVENT', 409, 'A real watch cannot confirm a simulated alert.')
  if (event.delivery.state === 'PRESENTED') return event
  return withStatus({
    ...event,
    delivery: { ...event.delivery, state: 'PRESENTED', presentedAt: req.presentedAt, hapticRequested: req.hapticRequested, confirmedBy: 'WATCH_APP' },
    statusHistory: [...event.statusHistory, { status: 'DELIVERED', at: req.presentedAt, actor: 'WATCH', note: 'watch app confirmed it displayed the alert' }],
  })
}

export function applyReviewAction(event: StoredEvent, action: ReviewAction, now: string): StoredEvent {
  const review = event.review
  if (review.state === 'CLOSED') throw new ActionError('EVENT_CLOSED', 409, 'This event is closed.')
  const known = new Set<string>(REVIEW_CHECKLIST.items.map((i) => i.id))
  if (action.action !== 'CLOSE') {
    const unknown = action.checkedItems.filter((i) => !known.has(i))
    if (unknown.length) throw new ActionError('UNKNOWN_CHECKLIST_ITEM', 422, `Unknown checklist item(s): ${unknown.join(', ')}`)
  }
  const base = { checklistId: REVIEW_CHECKLIST.id, checklistVersion: REVIEW_CHECKLIST.version, updatedAt: now }
  switch (action.action) {
    case 'SAVE_PROGRESS': {
      if (review.state === 'REVIEWED') throw new ActionError('ALREADY_REVIEWED', 409, 'Already marked reviewed. Close it when the follow-up is done.')
      return withStatus({
        ...event,
        review: {
          ...review,
          ...base,
          state: 'IN_PROGRESS',
          checkedItems: [...new Set(action.checkedItems)],
          reviewer: action.reviewer ?? review.reviewer,
          notes: action.notes ?? review.notes,
        },
      })
    }
    case 'MARK_REVIEWED': {
      if (review.state === 'REVIEWED') throw new ActionError('ALREADY_REVIEWED', 409, 'Already marked reviewed.')
      const missing = REVIEW_CHECKLIST.items.map((i) => i.id).filter((id) => !action.checkedItems.includes(id))
      if (missing.length) throw new ActionError('CHECKLIST_INCOMPLETE', 422, `Checklist incomplete: ${missing.join(', ')}`)
      return withStatus({
        ...event,
        review: { ...review, ...base, state: 'REVIEWED', checkedItems: [...new Set(action.checkedItems)], reviewer: action.reviewer, reviewedAt: now, notes: action.notes ?? review.notes },
        statusHistory: [...event.statusHistory, { status: 'REVIEWED', at: now, actor: 'REVIEWER', note: `reviewed by ${action.reviewer}` }],
      })
    }
    case 'CLOSE': {
      if (review.state !== 'REVIEWED') throw new ActionError('NOT_REVIEWED', 409, 'Only a reviewed event can be closed.')
      return withStatus({
        ...event,
        review: { ...review, ...base, state: 'CLOSED', closedAt: now, notes: action.notes ?? review.notes },
        statusHistory: [...event.statusHistory, { status: 'CLOSED', at: now, actor: 'REVIEWER', note: `closed by ${action.reviewer}` }],
      })
    }
  }
}

/** Alerts queued for a watch that never confirmed them become DELIVERY_UNCONFIRMED. */
export function expireDeliveries(ds: Dataset, now: string): string[] {
  const changed: string[] = []
  for (const e of Object.values(ds.events)) {
    if (e.delivery.state !== 'QUEUED' || !e.delivery.lastAttemptAt) continue
    if (t(now) - t(e.delivery.lastAttemptAt) <= DELIVERY_CONFIRM_TIMEOUT_SECONDS * 1000) continue
    ds.events[e.eventId] = withStatus({
      ...e,
      delivery: { ...e.delivery, state: 'UNCONFIRMED' },
      statusHistory: [
        ...e.statusHistory,
        { status: 'DELIVERY_UNCONFIRMED', at: now, actor: 'MISSION_COMPUTER', note: `no confirmation from the watch within ${DELIVERY_CONFIRM_TIMEOUT_SECONDS} s` },
      ],
    })
    changed.push(e.eventId)
  }
  return changed
}

/** Alerts this computer created that a given watch should present. */
export function outboxFor(ds: Dataset, deviceId: string): StoredEvent[] {
  const device = own(ds.devices, deviceId)
  if (!device?.subjectId) return []
  return Object.values(ds.events).filter(
    (e) => e.subjectId === device.subjectId && e.delivery.channel === 'COMPUTER_TO_WATCH' && e.delivery.state === 'QUEUED',
  )
}

// ---------------------------------------------------------------------------
// Computer-side checks

const UNSENT_NOTE: Record<LinkState, string> = {
  VERIFIED: 'queued for the watch',
  WATCH_UNREACHABLE: 'not sent: the watch has not checked in recently',
  NOT_PAIRED: 'not sent: no watch has checked in with this computer',
  SIMULATED: 'not sent: simulated watch, no real device link',
}

/**
 * Create VERIFY_SOURCE events for stand-alone readings with quality or staleness problems.
 * Flagged readings of one session share one event; a reading is never cited twice.
 */
export function runDataChecks(ds: Dataset, now: string): string[] {
  const cited = new Set<string>()
  for (const e of Object.values(ds.events))
    if (e.origin.kind === 'MISSION_COMPUTER_CHECK') for (const ev of e.evidence) if (ev.kind === 'MEASUREMENT' && ev.refId) cited.add(ev.refId)
  const groups = new Map<string, { sessionId: string | null; subjectId: string; isSimulated: boolean; first: string; findings: QualityFinding[] }>()
  for (const reading of Object.values(ds.readings).sort((a, b) => a.measurementId.localeCompare(b.measurementId))) {
    if (cited.has(reading.measurementId)) continue
    const session = reading.sessionId ? (own(ds.sessions, reading.sessionId) ?? null) : null
    const findings = externalReadingFindings(session, [reading])
    if (!findings.length) continue
    const key = reading.sessionId ? `s:${reading.sessionId}` : `m:${reading.measurementId}`
    const group = groups.get(key) ?? {
      sessionId: reading.sessionId,
      subjectId: reading.subjectId,
      isSimulated: reading.isSimulated,
      first: reading.measurementId,
      findings: [],
    }
    group.findings.push(...findings)
    groups.set(key, group)
  }
  const created: string[] = []
  for (const g of groups.values()) {
    const baseId = `dq-${g.sessionId ?? g.first}`
    const eventId = ds.events[baseId] ? `${baseId}-${g.first}` : baseId
    if (ds.events[eventId]) continue
    const findings = g.findings
    const link = linkState(subjectDevice(ds, g.subjectId), now)
    const queued = link === 'VERIFIED'
    const event: StoredEvent = {
      schemaVersion: EVENT_SCHEMA,
      eventId,
      subjectId: g.subjectId,
      sessionId: g.sessionId,
      createdAt: now,
      origin: { kind: 'MISSION_COMPUTER_CHECK', ruleSet: 'computer-checks 1.0', deviceId: null },
      category: 'VERIFY_SOURCE',
      severity: 'NOTICE',
      reasonCodes: [...new Set(findings.map((f) => f.reasonCode))],
      evidence: findings.map((f) => ({ reasonCode: f.reasonCode, kind: 'MEASUREMENT' as const, refId: f.measurementId, note: f.detail })),
      watchMessage: { title: 'VERIFY SOURCE', body: 'CHECK MISSION COMPUTER' },
      status: 'CREATED',
      delivery: {
        channel: 'COMPUTER_TO_WATCH',
        state: queued ? 'QUEUED' : 'WATCH_UNREACHABLE',
        presentedAt: null,
        hapticRequested: null,
        lastAttemptAt: now,
        confirmedBy: null,
      },
      acknowledgement: null,
      review: { ...DEFAULT_REVIEW },
      statusHistory: [
        { status: 'CREATED', at: now, actor: 'MISSION_COMPUTER', note: 'created by the mission computer data check' },
        { status: queued ? 'QUEUED' : 'WATCH_UNREACHABLE', at: now, actor: 'MISSION_COMPUTER', note: UNSENT_NOTE[link] },
      ],
      isSimulated: g.isSimulated,
      provenance: { origin: 'MISSION_COMPUTER', appVersion: null, deviceId: null, ingestPath: null, receivedAt: now, importFileName: null },
    }
    event.status = deriveEventStatus(event)
    ds.events[eventId] = event
    log(ds, { at: now, kind: 'CHECK', id: eventId, outcome: 'CREATED', path: null, detail: event.reasonCodes.join(', ') })
    created.push(eventId)
  }
  return created
}

// ---------------------------------------------------------------------------
// Evidence

export type ResolvedEvidence =
  | { ref: ReviewEvent['evidence'][number]; found: true; kind: 'SYMPTOM'; symptom: Symptom }
  | { ref: ReviewEvent['evidence'][number]; found: true; kind: 'MEASUREMENT'; measurement: StoredMeasurement; standalone: boolean }
  | { ref: ReviewEvent['evidence'][number]; found: true; kind: 'PHASE'; phase: PhaseRecord }
  | { ref: ReviewEvent['evidence'][number]; found: true; kind: 'SESSION'; session: StoredSession }
  | { ref: ReviewEvent['evidence'][number]; found: true; kind: 'DEVICE'; device: DeviceRecord }
  | { ref: ReviewEvent['evidence'][number]; found: false; kind: ReviewEvent['evidence'][number]['kind']; reason: 'SESSION_NOT_RECEIVED' | 'NOT_FOUND' }

/** Look up every record an event cites. Missing records are reported, never invented. */
export function resolveEvidence(event: ReviewEvent, ds: Dataset): ResolvedEvidence[] {
  const session = event.sessionId ? own(ds.sessions, event.sessionId) : undefined
  const missing = (ref: ReviewEvent['evidence'][number]): ResolvedEvidence => ({
    ref,
    found: false,
    kind: ref.kind,
    reason: event.sessionId && !session && ref.kind !== 'DEVICE' ? 'SESSION_NOT_RECEIVED' : 'NOT_FOUND',
  })
  return event.evidence.map((ref): ResolvedEvidence => {
    switch (ref.kind) {
      case 'SYMPTOM': {
        const symptom = session?.symptoms.find((s) => s.symptomId === ref.refId)
        return symptom ? { ref, found: true, kind: 'SYMPTOM', symptom } : missing(ref)
      }
      case 'MEASUREMENT': {
        const inSession = session?.measurements.find((m) => m.measurementId === ref.refId)
        if (inSession) return { ref, found: true, kind: 'MEASUREMENT', measurement: inSession, standalone: false }
        const standalone = ref.refId ? own(ds.readings, ref.refId) : undefined
        return standalone ? { ref, found: true, kind: 'MEASUREMENT', measurement: standalone, standalone: true } : missing(ref)
      }
      case 'PHASE': {
        const phase = session?.phases.find((p) => p.phase === ref.refId)
        return phase ? { ref, found: true, kind: 'PHASE', phase } : missing(ref)
      }
      case 'SESSION': {
        const s = own(ds.sessions, ref.refId ?? event.sessionId ?? '')
        return s ? { ref, found: true, kind: 'SESSION', session: s } : missing(ref)
      }
      case 'DEVICE': {
        const d = ref.refId ? own(ds.devices, ref.refId) : undefined
        return d ? { ref, found: true, kind: 'DEVICE', device: d } : missing(ref)
      }
    }
  })
}

/** Readings from other instruments linked to a session. */
export function linkedReadings(ds: Dataset, sessionId: string): StoredMeasurement[] {
  return Object.values(ds.readings)
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => t(a.measuredAt) - t(b.measuredAt))
}
