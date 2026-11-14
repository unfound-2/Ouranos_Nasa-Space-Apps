/**
 * GRAVITYGUARD shared data contract, version 1.
 *
 * This file is the single source of truth for the records exchanged between the
 * watch app, the mission-computer API and the dashboard. The JSON Schema files in
 * /contracts/v1 are generated from it (npm run contracts).
 *
 * Conventions:
 * - Every timestamp is UTC ISO-8601 with a trailing "Z" (2026-11-14T19:30:05Z).
 * - A nullable field may be sent as null or left out; both are stored as null.
 *   (Swift's JSONEncoder leaves out nil optionals.) Missing data is never zero.
 * - Objects are strict: an unknown key is rejected, so a misspelled field is caught.
 */
import { z } from 'zod'

export const SESSION_SCHEMA = 'gravityguard.recovery-session.v1' as const
export const EVENT_SCHEMA = 'gravityguard.review-event.v1' as const
export const BUNDLE_SCHEMA = 'gravityguard.export-bundle.v1' as const

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

// ---------------------------------------------------------------------------
// Primitives

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/

export function isStrictUtcIso(s: string): boolean {
  if (typeof s !== 'string') return false
  const m = ISO_UTC.exec(s)
  if (!m) return false
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number)
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return false
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** A field that may be null or omitted by the producer. Always stored as null when absent. */
function nullable<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((v): z.output<T> | null => (v ?? null) as z.output<T> | null)
}

const text = (max: number) => z.string().max(max)

export const Id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'identifiers use letters, digits, ".", "_", ":" or "-" (max 128 characters)')

export const UtcTimestamp = z
  .string()
  .refine(isStrictUtcIso, 'must be a UTC ISO-8601 timestamp such as 2026-11-14T19:30:05Z')

export const ReasonCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/, 'reason codes are UPPER_SNAKE_CASE, 2-64 characters')

// ---------------------------------------------------------------------------
// Vocabularies

export const Indicator = z.enum(['HEART_RATE', 'BLOOD_PRESSURE_SYSTOLIC', 'BLOOD_PRESSURE_DIASTOLIC'])
export const Unit = z.enum(['bpm', 'mmHg'])
export const UNIT_FOR = {
  HEART_RATE: 'bpm',
  BLOOD_PRESSURE_SYSTOLIC: 'mmHg',
  BLOOD_PRESSURE_DIASTOLIC: 'mmHg',
} as const satisfies Record<z.infer<typeof Indicator>, z.infer<typeof Unit>>

export const Quality = z.enum(['VALID', 'QUESTIONABLE', 'INVALID', 'MISSING'])
export const Phase = z.enum(['REST', 'RECOVERY'])
export const SourceKind = z.enum(['APPLE_WATCH', 'EXTERNAL_INSTRUMENT', 'MANUAL_ENTRY', 'SIMULATOR'])
export const Origin = z.enum(['WATCH_APP', 'MISSION_COMPUTER', 'EXTERNAL_SYSTEM', 'DEMO_FIXTURE'])
/** How a record reached this computer. Always set by the mission computer, never by the producer. */
export const IngestPath = z.enum([
  'LIVE_SYNC',
  'SAVED_DEVICE_FILE',
  'FILE_IMPORT',
  'MANUAL_ENTRY',
  'DEMO_FIXTURE',
  'DEMO_TRIGGER',
])
export const SymptomCode = z.enum(['DIZZY', 'WEAK', 'NAUSEATED', 'OTHER'])
export const BodyRegion = z.enum(['HEAD', 'CHEST', 'ARMS', 'LEGS'])
export const SessionMode = z.enum(['DEVICE_RECORDING', 'MANUAL_ENTRY', 'SIMULATED_DEMO'])
export const EndReason = z.enum(['COMPLETED', 'STOPPED_BY_WEARER', 'STOPPED_UNWELL', 'INTERRUPTED', 'IN_PROGRESS'])
export const EventCategory = z.enum(['REVIEW_SUGGESTED', 'VERIFY_SOURCE', 'RECORDING_INCOMPLETE'])
/** How soon the creating rule asks a person to look. Not a diagnosis or a clinical grade. */
export const Severity = z.enum(['NOTICE', 'REVIEW', 'PRIORITY_REVIEW'])
export const EventStatus = z.enum([
  'CREATED',
  'QUEUED',
  'DELIVERED',
  'ACKNOWLEDGED',
  'REVIEWED',
  'CLOSED',
  'DELIVERY_UNCONFIRMED',
  'WATCH_UNREACHABLE',
])
export const DeliveryChannel = z.enum(['WATCH_LOCAL', 'COMPUTER_TO_WATCH', 'SIMULATED_WATCH', 'NONE'])
export const DeliveryState = z.enum(['NOT_ATTEMPTED', 'QUEUED', 'PRESENTED', 'UNCONFIRMED', 'WATCH_UNREACHABLE'])
export const ReviewState = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'REVIEWED', 'CLOSED'])
export const Actor = z.enum(['WATCH', 'MISSION_COMPUTER', 'REVIEWER', 'SIMULATION'])

// ---------------------------------------------------------------------------
// Records

export const MeasurementSourceSchema = z.strictObject({
  kind: SourceKind,
  device: nullable(text(120)),
  sensor: nullable(text(120)),
})

export const ProvenanceSchema = z.strictObject({
  origin: Origin,
  appVersion: nullable(text(40)),
  deviceId: nullable(Id),
  // Set by the mission computer on receipt. Anything a producer sends here is replaced.
  ingestPath: nullable(IngestPath),
  receivedAt: nullable(UtcTimestamp),
  importFileName: nullable(text(200)),
})

const MeasurementObject = z.strictObject({
  measurementId: Id,
  subjectId: Id,
  sessionId: nullable(Id),
  indicator: Indicator,
  /** null means the device attempted a reading and got none. It is never treated as 0. */
  value: nullable(z.number().min(0).max(1000)),
  unit: Unit,
  measuredAt: UtcTimestamp,
  /** Set by the mission computer when the reading arrives. */
  receivedAt: nullable(UtcTimestamp),
  phase: nullable(Phase),
  source: MeasurementSourceSchema,
  /** Optional on readings inside a session: the session's provenance is copied in. */
  provenance: ProvenanceSchema.optional(),
  isSimulated: z.boolean(),
  quality: Quality,
})

type MeasurementOut = z.output<typeof MeasurementObject>
type Issue = { message: string; path: (string | number)[] }
type IssueSink = { addIssue: (issue: { code: 'custom'; message: string; path: (string | number)[] }) => void }

function measurementIssues(m: MeasurementOut, path: (string | number)[]): Issue[] {
  const out: Issue[] = []
  const expected = UNIT_FOR[m.indicator]
  if (m.unit !== expected) out.push({ path: [...path, 'unit'], message: `unit for ${m.indicator} must be "${expected}", got "${m.unit}"` })
  if (m.value === null && m.quality !== 'MISSING')
    out.push({ path: [...path, 'quality'], message: 'a reading with no value must have quality "MISSING"' })
  if (m.value !== null && m.quality === 'MISSING')
    out.push({ path: [...path, 'quality'], message: 'quality "MISSING" requires value to be null' })
  if (m.source.kind === 'SIMULATOR' && !m.isSimulated)
    out.push({ path: [...path, 'isSimulated'], message: 'readings from the SIMULATOR source must have isSimulated = true' })
  if (m.provenance?.origin === 'DEMO_FIXTURE' && !m.isSimulated)
    out.push({ path: [...path, 'isSimulated'], message: 'demo fixture readings must have isSimulated = true' })
  return out
}

function report(ctx: IssueSink, issues: Issue[]) {
  for (const i of issues) ctx.addIssue({ code: 'custom', message: i.message, path: i.path })
}

export const MeasurementSchema = MeasurementObject.superRefine((m, ctx) => report(ctx, measurementIssues(m, [])))

export const PhaseRecordSchema = z.strictObject({
  phase: Phase,
  startedAt: UtcTimestamp,
  endedAt: nullable(UtcTimestamp),
  /** When the wearer or a supervisor tapped "Phase confirmed". */
  confirmedAt: nullable(UtcTimestamp),
  confirmedBy: nullable(z.enum(['WEARER', 'SUPERVISOR'])),
})

export const SymptomSchema = z.strictObject({
  symptomId: Id,
  code: SymptomCode,
  reportedAt: UtcTimestamp,
  phase: nullable(Phase),
  /** Only when the person indicated a location. The dashboard never infers one except DIZZY -> head. */
  bodyRegion: nullable(BodyRegion),
  reportedBy: z.enum(['SELF_REPORTED', 'CREW_OBSERVED']),
  note: nullable(text(280)),
})

export const SymptomCheckSchema = z.strictObject({
  status: z.enum(['NONE_REPORTED', 'REPORTED', 'NO_RESPONSE', 'NOT_ASKED']),
  answeredAt: nullable(UtcTimestamp),
})

export const ProtocolSchema = z.strictObject({
  id: z.enum(['GRAVITY_RECOVERY_CHECK', 'TRAINING_DEMO']),
  version: z.string().regex(/^\d{1,3}\.\d{1,3}$/, 'protocol version looks like "1.0"'),
  plannedRestSeconds: nullable(z.number().int().min(5).max(3600)),
  plannedRecoverySeconds: nullable(z.number().int().min(5).max(3600)),
})

/** What the watch itself computed. Shown next to the computer's own recalculation, never merged into it. */
export const WatchSummarySchema = z.strictObject({
  status: z.enum(['RECORDED', 'INCOMPLETE', 'REVIEW_SUGGESTED']),
  restMedianBpm: nullable(z.number().min(0).max(1000)),
  recoveryMedianBpm: nullable(z.number().min(0).max(1000)),
  deltaBpm: nullable(z.number().min(-1000).max(1000)),
  restValidSamples: nullable(z.number().int().min(0)),
  recoveryValidSamples: nullable(z.number().int().min(0)),
})

const ms = (iso: string) => Date.parse(iso)

const SessionObject = z.strictObject({
  schemaVersion: z.literal(SESSION_SCHEMA),
  sessionId: Id,
  subjectId: Id,
  protocol: ProtocolSchema,
  mode: SessionMode,
  isSimulated: z.boolean(),
  startedAt: UtcTimestamp,
  endedAt: nullable(UtcTimestamp),
  endReason: EndReason,
  phases: z.array(PhaseRecordSchema).max(10),
  measurements: z.array(MeasurementObject).max(5000),
  symptomCheck: SymptomCheckSchema,
  symptoms: z.array(SymptomSchema).max(50),
  summary: nullable(WatchSummarySchema),
  provenance: ProvenanceSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export const SessionSchema = SessionObject.superRefine((s, ctx) => {
  const issues: Issue[] = []
  if (s.isSimulated !== (s.mode === 'SIMULATED_DEMO'))
    issues.push({ path: ['isSimulated'], message: 'isSimulated must be true exactly when mode is "SIMULATED_DEMO"' })
  if ((s.endReason === 'IN_PROGRESS') !== (s.endedAt === null))
    issues.push({ path: ['endedAt'], message: 'endedAt must be null exactly when endReason is "IN_PROGRESS"' })
  if (s.endedAt && ms(s.endedAt) < ms(s.startedAt)) issues.push({ path: ['endedAt'], message: 'endedAt is before startedAt' })
  if (s.provenance.origin === 'DEMO_FIXTURE' && !s.isSimulated)
    issues.push({ path: ['provenance', 'origin'], message: 'demo fixtures must be simulated' })

  const seenPhases = new Set<string>()
  s.phases.forEach((p, i) => {
    if (seenPhases.has(p.phase)) issues.push({ path: ['phases', i, 'phase'], message: `phase ${p.phase} appears twice` })
    seenPhases.add(p.phase)
    if (p.endedAt && ms(p.endedAt) < ms(p.startedAt)) issues.push({ path: ['phases', i, 'endedAt'], message: 'phase ends before it starts' })
  })

  const seenIds = new Set<string>()
  s.measurements.forEach((m, i) => {
    const path = ['measurements', i]
    issues.push(...measurementIssues(m, path))
    if (seenIds.has(m.measurementId)) issues.push({ path: [...path, 'measurementId'], message: `duplicate measurementId ${m.measurementId}` })
    seenIds.add(m.measurementId)
    if (m.sessionId !== null && m.sessionId !== s.sessionId)
      issues.push({ path: [...path, 'sessionId'], message: 'measurement belongs to a different session' })
    if (m.subjectId !== s.subjectId) issues.push({ path: [...path, 'subjectId'], message: 'measurement belongs to a different subject' })
    if (m.isSimulated !== s.isSimulated)
      issues.push({ path: [...path, 'isSimulated'], message: 'a session cannot mix simulated and real readings' })
  })

  const seenSymptoms = new Set<string>()
  s.symptoms.forEach((sym, i) => {
    if (seenSymptoms.has(sym.symptomId)) issues.push({ path: ['symptoms', i, 'symptomId'], message: `duplicate symptomId ${sym.symptomId}` })
    seenSymptoms.add(sym.symptomId)
  })
  const st = s.symptomCheck.status
  if (st === 'REPORTED' && s.symptoms.length === 0)
    issues.push({ path: ['symptoms'], message: 'symptomCheck says REPORTED but no symptoms are listed' })
  if (st !== 'REPORTED' && s.symptoms.length > 0)
    issues.push({ path: ['symptomCheck', 'status'], message: `symptomCheck says ${st} but symptoms are listed` })
  if ((st === 'REPORTED' || st === 'NONE_REPORTED') && s.symptomCheck.answeredAt === null)
    issues.push({ path: ['symptomCheck', 'answeredAt'], message: 'an answered symptom check needs answeredAt' })
  report(ctx, issues)
})

// ---------------------------------------------------------------------------
// Review events

export const EvidenceRefSchema = z.strictObject({
  reasonCode: ReasonCode,
  kind: z.enum(['SYMPTOM', 'MEASUREMENT', 'PHASE', 'SESSION', 'DEVICE']),
  /** symptomId, measurementId, phase name (REST/RECOVERY), sessionId or deviceId. */
  refId: nullable(text(128)),
  note: nullable(text(280)),
})

export const EventOriginSchema = z.strictObject({
  kind: z.enum(['WATCH_RULES', 'MISSION_COMPUTER_CHECK', 'DEMO_TRIGGER', 'DEMO_FIXTURE']),
  ruleSet: nullable(text(60)),
  deviceId: nullable(Id),
})

export const DeliverySchema = z.strictObject({
  channel: DeliveryChannel,
  state: DeliveryState,
  /** Reported by the watch app when it actually displayed the alert. An HTTP 200 is not this. */
  presentedAt: nullable(UtcTimestamp),
  /** The app asked watchOS for a haptic. watchOS does not confirm the wrist felt it. */
  hapticRequested: nullable(z.boolean()),
  lastAttemptAt: nullable(UtcTimestamp),
  confirmedBy: nullable(z.enum(['WATCH_APP', 'SIMULATION'])),
})

export const AcknowledgementSchema = z.strictObject({
  acknowledgedAt: UtcTimestamp,
  via: z.enum(['WATCH', 'SIMULATED_WATCH']),
})

export const ReviewRecordSchema = z.strictObject({
  state: ReviewState,
  checklistId: nullable(text(60)),
  checklistVersion: nullable(text(20)),
  checkedItems: z.array(text(60)).max(30),
  reviewer: nullable(text(80)),
  reviewedAt: nullable(UtcTimestamp),
  closedAt: nullable(UtcTimestamp),
  notes: nullable(text(2000)),
  updatedAt: nullable(UtcTimestamp),
})

export const StatusChangeSchema = z.strictObject({
  status: EventStatus,
  at: UtcTimestamp,
  actor: Actor,
  note: nullable(text(280)),
})

const EventObject = z.strictObject({
  schemaVersion: z.literal(EVENT_SCHEMA),
  eventId: Id,
  subjectId: Id,
  sessionId: nullable(Id),
  createdAt: UtcTimestamp,
  origin: EventOriginSchema,
  category: EventCategory,
  severity: Severity,
  reasonCodes: z.array(ReasonCode).min(1).max(20),
  evidence: z.array(EvidenceRefSchema).max(200),
  watchMessage: nullable(z.strictObject({ title: text(40), body: text(120) })),
  status: EventStatus,
  delivery: DeliverySchema,
  acknowledgement: nullable(AcknowledgementSchema),
  /** Owned by the mission computer. Producers must leave it out. */
  review: ReviewRecordSchema.optional(),
  /** Owned by the mission computer. Producers must leave it out. */
  statusHistory: z.array(StatusChangeSchema).max(200).optional(),
  isSimulated: z.boolean(),
  provenance: ProvenanceSchema,
  extensions: z.record(z.string(), z.unknown()).optional(),
})

type EventOut = z.output<typeof EventObject>

/** The event status follows from delivery, acknowledgement and review; it is never set independently. */
export function deriveEventStatus(e: {
  delivery: { state: z.infer<typeof DeliveryState> }
  acknowledgement: unknown | null
  review?: { state: z.infer<typeof ReviewState> } | null
}): z.infer<typeof EventStatus> {
  const r = e.review?.state
  if (r === 'CLOSED') return 'CLOSED'
  if (r === 'REVIEWED') return 'REVIEWED'
  if (e.acknowledgement) return 'ACKNOWLEDGED'
  switch (e.delivery.state) {
    case 'PRESENTED':
      return 'DELIVERED'
    case 'WATCH_UNREACHABLE':
      return 'WATCH_UNREACHABLE'
    case 'UNCONFIRMED':
      return 'DELIVERY_UNCONFIRMED'
    case 'QUEUED':
      return 'QUEUED'
    default:
      return 'CREATED'
  }
}

function eventIssues(e: EventOut, producer: boolean): Issue[] {
  const issues: Issue[] = []
  if (producer) {
    if (e.review !== undefined) issues.push({ path: ['review'], message: 'review is set by the mission computer; leave it out' })
    if (e.statusHistory !== undefined)
      issues.push({ path: ['statusHistory'], message: 'statusHistory is kept by the mission computer; leave it out' })
    if (e.status === 'REVIEWED' || e.status === 'CLOSED')
      issues.push({ path: ['status'], message: `${e.status} can only be set by a reviewer on the mission computer` })
  }
  const derived = deriveEventStatus(e)
  if (e.status !== derived)
    issues.push({ path: ['status'], message: `status "${e.status}" does not match delivery/acknowledgement, which imply "${derived}"` })
  const d = e.delivery
  if (d.state === 'PRESENTED' && (d.presentedAt === null || d.confirmedBy === null))
    issues.push({ path: ['delivery'], message: 'a PRESENTED alert needs presentedAt and confirmedBy from the watch' })
  if (d.state !== 'PRESENTED' && d.presentedAt !== null)
    issues.push({ path: ['delivery', 'presentedAt'], message: 'presentedAt is only allowed when state is PRESENTED' })
  if (e.acknowledgement && d.state !== 'PRESENTED')
    issues.push({ path: ['acknowledgement'], message: 'an alert that was never presented cannot be acknowledged' })
  if (e.acknowledgement && d.presentedAt && ms(e.acknowledgement.acknowledgedAt) < ms(d.presentedAt))
    issues.push({ path: ['acknowledgement', 'acknowledgedAt'], message: 'acknowledged before it was presented' })
  const simulatedOnly =
    d.channel === 'SIMULATED_WATCH' ||
    d.confirmedBy === 'SIMULATION' ||
    e.acknowledgement?.via === 'SIMULATED_WATCH' ||
    e.origin.kind === 'DEMO_TRIGGER' ||
    e.origin.kind === 'DEMO_FIXTURE' ||
    e.provenance.origin === 'DEMO_FIXTURE'
  if (simulatedOnly && !e.isSimulated)
    issues.push({ path: ['isSimulated'], message: 'simulated delivery, acknowledgement or origin requires isSimulated = true' })
  const codes = new Set(e.reasonCodes)
  e.evidence.forEach((ev, i) => {
    if (!codes.has(ev.reasonCode))
      issues.push({ path: ['evidence', i, 'reasonCode'], message: `evidence cites ${ev.reasonCode}, which is not in reasonCodes` })
  })
  return issues
}

/** Schema for events sent by a producer (watch app, import file). */
export const EventSchema = EventObject.superRefine((e, ctx) => report(ctx, eventIssues(e, true)))
/** Schema for events as the mission computer stores them (may carry review state). */
export const StoredEventSchema = EventObject.superRefine((e, ctx) => report(ctx, eventIssues(e, false)))

// ---------------------------------------------------------------------------
// Transfers

export const ProducerSchema = z.strictObject({
  app: text(60),
  appVersion: nullable(text(40)),
  deviceId: nullable(Id),
  deviceModel: nullable(text(80)),
})

/** One file a watch (or any producer) can export: sessions, events and stand-alone readings together. */
export const ExportBundleSchema = z.strictObject({
  schemaVersion: z.literal(BUNDLE_SCHEMA),
  exportedAt: UtcTimestamp,
  producer: ProducerSchema,
  sessions: z.array(SessionSchema).max(200),
  events: z.array(EventSchema).max(500),
  measurements: z.array(MeasurementSchema).max(5000).optional(),
})

export const HeartbeatSchema = z.strictObject({
  deviceId: Id,
  subjectId: nullable(Id),
  sentAt: UtcTimestamp,
  appVersion: nullable(text(40)),
  deviceModel: nullable(text(80)),
  pendingRecords: nullable(z.number().int().min(0).max(100000)),
})

export const AckRequestSchema = z.strictObject({ deviceId: Id, acknowledgedAt: UtcTimestamp })
export const DeliveryReportSchema = z.strictObject({
  deviceId: Id,
  presentedAt: UtcTimestamp,
  hapticRequested: nullable(z.boolean()),
})

export const ReviewActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('SAVE_PROGRESS'),
    reviewer: nullable(text(80)),
    checkedItems: z.array(text(60)).max(30),
    notes: nullable(text(2000)),
  }),
  z.strictObject({
    action: z.literal('MARK_REVIEWED'),
    reviewer: text(80).trim().min(1, 'a reviewer name or role is required'),
    checkedItems: z.array(text(60)).max(30),
    notes: nullable(text(2000)),
  }),
  z.strictObject({
    action: z.literal('CLOSE'),
    reviewer: text(80).trim().min(1, 'a reviewer name or role is required'),
    notes: nullable(text(2000)),
  }),
])

// ---------------------------------------------------------------------------
// Types

export type Measurement = z.output<typeof MeasurementSchema>
export type RecoverySession = z.output<typeof SessionSchema>
export type ReviewEvent = z.output<typeof EventSchema>
export type PhaseRecord = z.output<typeof PhaseRecordSchema>
export type Symptom = z.output<typeof SymptomSchema>
export type Provenance = z.output<typeof ProvenanceSchema>
export type ReviewRecord = z.output<typeof ReviewRecordSchema>
export type StatusChange = z.output<typeof StatusChangeSchema>
export type ExportBundle = z.output<typeof ExportBundleSchema>
export type Heartbeat = z.output<typeof HeartbeatSchema>
export type ReviewAction = z.output<typeof ReviewActionSchema>
export type EventStatusT = z.infer<typeof EventStatus>
export type PhaseT = z.infer<typeof Phase>
export type SymptomCodeT = z.infer<typeof SymptomCode>
export type BodyRegionT = z.infer<typeof BodyRegion>
export type IngestPathT = z.infer<typeof IngestPath>
export type SeverityT = z.infer<typeof Severity>
export type EventCategoryT = z.infer<typeof EventCategory>

/** An event as stored: the mission computer always fills review and statusHistory. */
export type StoredEvent = ReviewEvent & { review: ReviewRecord; statusHistory: StatusChange[] }
/** A reading as stored: provenance and receivedAt are always filled. */
export type StoredMeasurement = Measurement & { provenance: Provenance }
export type StoredSession = Omit<RecoverySession, 'measurements'> & { measurements: StoredMeasurement[] }

// ---------------------------------------------------------------------------
// Parsing helpers

function formatIssue(i: z.ZodError['issues'][number]): string {
  const path = i.path.length ? i.path.map(String).join('.') : '(record)'
  if (i.code === 'unrecognized_keys') return `${path}: unknown field(s) ${i.keys.join(', ')}`
  return `${path}: ${i.message}`
}

export function run<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const r = schema.safeParse(input)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.slice(0, 25).map(formatIssue) }
}

export const parseSession = (x: unknown) => run(SessionSchema, x) as ParseResult<RecoverySession>
export const parseMeasurement = (x: unknown) => run(MeasurementSchema, x) as ParseResult<Measurement>
export const parseReviewEvent = (x: unknown) => run(EventSchema, x) as ParseResult<ReviewEvent>
export const parseStoredEvent = (x: unknown) => run(StoredEventSchema, x) as ParseResult<ReviewEvent>
export const parseBundle = (x: unknown) => run(ExportBundleSchema, x) as ParseResult<ExportBundle>
export const parseHeartbeat = (x: unknown) => run(HeartbeatSchema, x) as ParseResult<Heartbeat>
export const parseReviewAction = (x: unknown) => run(ReviewActionSchema, x) as ParseResult<ReviewAction>
