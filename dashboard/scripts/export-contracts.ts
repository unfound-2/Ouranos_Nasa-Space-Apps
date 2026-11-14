/**
 * Writes the v1 JSON Schemas and examples for the watch app to <repo>/contracts/v1.
 * Run: npm run contracts (or npx tsx scripts/export-contracts.ts). Do not edit the output by hand;
 * scripts/contracts.test.ts fails when the committed files differ from what this script produces.
 *
 * The schemas come from src/shared/contract.ts (zod), converted with z.toJSONSchema in "input" mode,
 * which is what a producer sends: nullable fields may be left out. JSON Schema cannot express the
 * cross-field rules (for example "value null exactly when quality is MISSING"); they are listed in
 * docs/WATCH_INTEGRATION.md and enforced by the mission computer.
 *
 * Every example record is SIMULATED (isSimulated true, mode SIMULATED_DEMO, source SIMULATOR,
 * provenance origin DEMO_FIXTURE): the values are invented, so an example can never be imported
 * as real data. The integration guide lists the fields that differ in a real recording.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  AckRequestSchema,
  BUNDLE_SCHEMA,
  DeliveryReportSchema,
  EVENT_SCHEMA,
  EventSchema,
  ExportBundleSchema,
  HeartbeatSchema,
  MeasurementSchema,
  SESSION_SCHEMA,
  SessionSchema,
  UtcTimestamp,
} from '../src/shared/contract'

export const CONTRACTS_DIR = fileURLToPath(new URL('../../contracts/v1/', import.meta.url))

/**
 * The shape of a contract timestamp. The parser also checks the calendar (no 30 February, years
 * 2000-2100); a regular expression cannot.
 */
export const UTC_TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$'

const RULES_NOTE =
  'Rules that JSON Schema cannot express (for example cross-field rules) are listed in docs/WATCH_INTEGRATION.md and enforced by the mission computer. Generated from dashboard/src/shared/contract.ts by npm run contracts; do not edit by hand.'

const SCHEMAS: { name: string; schema: z.ZodType; title: string; description: string }[] = [
  {
    name: 'session',
    schema: SessionSchema,
    title: 'GRAVITYGUARD recovery session (v1)',
    description: `One gravity-recovery heart-rate check with its readings and symptom report, sent by the watch app after the session is saved. POST /api/v1/sessions. ${RULES_NOTE}`,
  },
  {
    name: 'event',
    schema: EventSchema,
    title: 'GRAVITYGUARD review event (v1, as sent by a producer)',
    description: `A request for a person to review a record, created when a watch rule fires. It is not a diagnosis. Producers must leave out review and statusHistory. POST /api/v1/alerts. ${RULES_NOTE}`,
  },
  {
    name: 'measurement',
    schema: MeasurementSchema,
    title: 'GRAVITYGUARD measurement (v1)',
    description: `One reading. Inside a session it may leave out provenance. Stand-alone readings from other instruments go to POST /api/v1/measurements as { "measurements": [...] }. ${RULES_NOTE}`,
  },
  {
    name: 'bundle',
    schema: ExportBundleSchema,
    title: 'GRAVITYGUARD export bundle (v1)',
    description: `One file with sessions, events and optional stand-alone readings, imported on the dashboard System Status page or with POST /api/v1/import. A bundle must not mix simulated and real records. ${RULES_NOTE}`,
  },
  {
    name: 'heartbeat',
    schema: HeartbeatSchema,
    title: 'GRAVITYGUARD watch heartbeat (v1)',
    description: `"This watch app is open and can reach the computer." POST /api/v1/device/heartbeat about every 20 s while the app is open. A test or demo client sends isSimulated: true, and the device then appears only in the simulated demo workspace. ${RULES_NOTE}`,
  },
  {
    name: 'ack',
    schema: AckRequestSchema,
    title: 'GRAVITYGUARD acknowledgement report (v1)',
    description: `The wearer tapped acknowledge on the watch. POST /api/v1/alerts/{eventId}/ack. An acknowledgement is not a medical review. ${RULES_NOTE}`,
  },
  {
    name: 'delivery',
    schema: DeliveryReportSchema,
    title: 'GRAVITYGUARD delivery report (v1)',
    description: `The watch app displayed an alert the computer sent. POST /api/v1/alerts/{eventId}/delivery, only after it was actually shown. ${RULES_NOTE}`,
  },
]

function jsonSchemaFor(entry: (typeof SCHEMAS)[number]): Record<string, unknown> {
  const generated = z.toJSONSchema(entry.schema, {
    io: 'input',
    target: 'draft-2020-12',
    override: (ctx) => {
      if (ctx.zodSchema === UtcTimestamp) {
        ctx.jsonSchema.pattern = UTC_TIMESTAMP_PATTERN
        ctx.jsonSchema.format = 'date-time'
      }
    },
  }) as Record<string, unknown>
  if (entry.name === 'event') producerOnly(generated)
  if (entry.name === 'bundle') producerOnly(((generated.properties as JsonObject).events as JsonObject).items as JsonObject)
  const { $schema, ...rest } = generated
  return { $schema, $id: `urn:gravityguard:contracts:v1:${entry.name}`, title: entry.title, description: entry.description, ...rest }
}

type JsonObject = Record<string, unknown>

/**
 * The producer rules for events that JSON Schema can express: review and statusHistory belong to
 * the mission computer (with additionalProperties false, removing them means "must be left out"),
 * only a reviewer can make an event REVIEWED or CLOSED, and only this computer creates
 * MISSION_COMPUTER_CHECK events.
 */
function producerOnly(event: JsonObject) {
  const props = event.properties as JsonObject
  delete props.review
  delete props.statusHistory
  const status = props.status as { enum: string[] }
  props.status = { ...status, enum: status.enum.filter((s) => s !== 'REVIEWED' && s !== 'CLOSED') }
  const origin = props.origin as { properties: JsonObject }
  const kind = origin.properties.kind as { enum: string[] }
  props.origin = { ...origin, properties: { ...origin.properties, kind: { ...kind, enum: kind.enum.filter((k) => k !== 'MISSION_COMPUTER_CHECK') } } }
}

// ---------------------------------------------------------------------------
// Examples. SIMULATED: every value below is invented.

const SESSION_ID = 'example-ses-20261114-193000'
const SUBJECT_ID = 'example-crew-01'
const DEVICE_ID = 'example-watch-01'
const SIM_SOURCE = { kind: 'SIMULATOR', device: 'Simulated watch', sensor: 'Simulated heart-rate values' }
const SIM_PROVENANCE = { origin: 'DEMO_FIXTURE', appVersion: '0.1.0', deviceId: DEVICE_ID }

function exampleReading(n: number, phase: 'REST' | 'RECOVERY', measuredAt: string, value: number | null, quality = value === null ? 'MISSING' : 'VALID') {
  return {
    measurementId: `${SESSION_ID}-hr${String(n).padStart(3, '0')}`,
    subjectId: SUBJECT_ID,
    sessionId: SESSION_ID,
    indicator: 'HEART_RATE',
    value,
    unit: 'bpm',
    measuredAt,
    phase,
    source: SIM_SOURCE,
    isSimulated: true,
    quality,
  }
}

function exampleSession() {
  return {
    schemaVersion: SESSION_SCHEMA,
    sessionId: SESSION_ID,
    subjectId: SUBJECT_ID,
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: 'SIMULATED_DEMO',
    isSimulated: true,
    startedAt: '2026-11-14T19:30:00Z',
    endedAt: '2026-11-14T19:32:00Z',
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: '2026-11-14T19:30:05Z', endedAt: '2026-11-14T19:30:50Z', confirmedAt: null, confirmedBy: null },
      { phase: 'RECOVERY', startedAt: '2026-11-14T19:31:05Z', endedAt: '2026-11-14T19:31:50Z', confirmedAt: '2026-11-14T19:31:05Z', confirmedBy: 'WEARER' },
    ],
    measurements: [
      exampleReading(1, 'REST', '2026-11-14T19:30:10Z', 70),
      exampleReading(2, 'REST', '2026-11-14T19:30:20Z', 72),
      exampleReading(3, 'REST', '2026-11-14T19:30:30Z', null),
      exampleReading(4, 'REST', '2026-11-14T19:30:40Z', 71),
      exampleReading(5, 'RECOVERY', '2026-11-14T19:31:10Z', 86),
      exampleReading(6, 'RECOVERY', '2026-11-14T19:31:18Z', 88),
      exampleReading(7, 'RECOVERY', '2026-11-14T19:31:26Z', 131, 'QUESTIONABLE'),
      exampleReading(8, 'RECOVERY', '2026-11-14T19:31:34Z', 89),
      exampleReading(9, 'RECOVERY', '2026-11-14T19:31:42Z', 90),
      exampleReading(10, 'RECOVERY', '2026-11-14T19:31:48Z', 87),
    ],
    symptomCheck: { status: 'REPORTED', answeredAt: '2026-11-14T19:31:55Z' },
    symptoms: [
      {
        symptomId: `${SESSION_ID}-sym1`,
        code: 'DIZZY',
        reportedAt: '2026-11-14T19:31:55Z',
        phase: 'RECOVERY',
        bodyRegion: null,
        reportedBy: 'SELF_REPORTED',
        note: null,
      },
    ],
    summary: { status: 'REVIEW_SUGGESTED', restMedianBpm: 71, recoveryMedianBpm: 88, deltaBpm: 17, restValidSamples: 3, recoveryValidSamples: 5 },
    // Simulated values never came from HealthKit, so the app's permission state does not apply.
    heartRateAccess: null,
    provenance: SIM_PROVENANCE,
  }
}

function exampleEvent() {
  return {
    schemaVersion: EVENT_SCHEMA,
    eventId: 'example-evt-20261114-193156',
    subjectId: SUBJECT_ID,
    sessionId: SESSION_ID,
    createdAt: '2026-11-14T19:31:56Z',
    origin: { kind: 'DEMO_FIXTURE', ruleSet: 'watch-rules 0.1', deviceId: DEVICE_ID },
    category: 'REVIEW_SUGGESTED',
    severity: 'REVIEW',
    reasonCodes: ['SYMPTOM_REPORTED'],
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: `${SESSION_ID}-sym1`, note: null }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: {
      channel: 'SIMULATED_WATCH',
      state: 'PRESENTED',
      presentedAt: '2026-11-14T19:31:57Z',
      hapticRequested: true,
      lastAttemptAt: '2026-11-14T19:31:57Z',
      confirmedBy: 'SIMULATION',
      confirmedByDeviceId: DEVICE_ID,
    },
    acknowledgement: null,
    isSimulated: true,
    provenance: SIM_PROVENANCE,
  }
}

export function buildExamples(): Record<string, unknown> {
  const session = exampleSession()
  const event = exampleEvent()
  return {
    'session.json': session,
    'event.json': event,
    'bundle.json': {
      schemaVersion: BUNDLE_SCHEMA,
      exportedAt: '2026-11-14T19:35:00Z',
      producer: { app: 'gravityguard-watch', appVersion: '0.1.0', deviceId: DEVICE_ID, deviceModel: 'Simulated watch' },
      sessions: [session],
      events: [event],
    },
    // Flagged simulated, so sending it as it is never makes a fake watch look verified in mission records.
    'heartbeat.json': {
      deviceId: DEVICE_ID,
      subjectId: SUBJECT_ID,
      sentAt: '2026-11-14T19:40:00Z',
      appVersion: '0.1.0',
      deviceModel: 'Simulated watch',
      pendingRecords: 0,
      isSimulated: true,
    },
    'ack.json': { deviceId: DEVICE_ID, acknowledgedAt: '2026-11-14T19:32:30Z' },
    'delivery.json': { deviceId: DEVICE_ID, presentedAt: '2026-11-14T19:40:04Z', hapticRequested: true },
  }
}

const asFile = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

/** Every file under contracts/v1, keyed by its path relative to that directory. */
export function buildContractFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of SCHEMAS) files[`${entry.name}.schema.json`] = asFile(jsonSchemaFor(entry))
  for (const [name, value] of Object.entries(buildExamples())) files[`examples/${name}`] = asFile(value)
  return files
}

function main() {
  const files = buildContractFiles()
  for (const [rel, text] of Object.entries(files)) {
    const out = path.join(CONTRACTS_DIR, rel)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, text)
  }
  console.log(`wrote ${Object.keys(files).length} files to ${CONTRACTS_DIR}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
