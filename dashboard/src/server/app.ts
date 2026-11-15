/**
 * The GRAVITYGUARD mission-computer API: a thin HTTP layer over src/shared.
 *
 * It receives records from the watch app, validates them with the shared v1 contract, stores them
 * (src/server/store.ts) and serves them to the dashboard. It runs offline on this computer: no
 * cloud, no outgoing requests. It makes no clinical decision; the shared code records what a rule
 * saw and what people did.
 *
 * Who may call what:
 * - DEVICE: the watch app, with "Authorization: Bearer <device token>". It may send records and
 *   report on alerts, but cannot read health records.
 * - LOCAL_USER: the dashboard on this computer (loopback, no token). It reads everything, reviews
 *   events and runs the simulated demo.
 */
import { accessSync, constants as fsConstants, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express'
import { z } from 'zod'
import {
  AckRequestSchema,
  DeliveryReportSchema,
  EVENT_SCHEMA,
  HeartbeatSchema,
  Id,
  ReviewActionSchema,
  run,
  SESSION_SCHEMA,
  type IngestPathT,
  type StoredEvent,
  type StoredSession,
} from '../shared/contract'
import {
  ActionError,
  applyAck,
  applyDeliveryReport,
  applyHeartbeat,
  applyReviewAction,
  classify,
  expandPayload,
  expireDeliveries,
  ingestRecords,
  linkedReadings,
  linkState,
  outboxFor,
  resolveEvidence,
  runDataChecks,
  type Dataset,
  type Datasets,
  type IngestResult,
  type Outcome,
  type Workspace,
} from '../shared/dataset'
import { buildTriggeredDemo, DEMO_DEVICES, loadDemo } from '../shared/demo'
import { buildChecks, runSelftest } from './diagnostics'
import { errorBody, HttpError } from './errors'
import { allowedHostnames, isHostAllowed, isJsonContentType, lanIPv4Addresses, lanIPv4Interfaces, resolveActor, type ActorKind, type Interfaces } from './security'
import { openStore, WORKSPACES, type Store, type WriteFile } from './store'
import { createWatchLink, type WatchLinkStatus } from './watch-link'
import { resolveDeviceToken, tokenPrefix, type DeviceToken } from './token'

export const SERVICE = 'gravityguard-mission-computer'
export const VERSION = '0.1.0'
export const CONTRACT_VERSION = 'v1'
export const DEFAULT_FIXTURES_FILE = fileURLToPath(new URL('../../fixtures/simulated/demo-bundle.json', import.meta.url))
export const MAINTENANCE_INTERVAL_MS = 15_000
const JSON_LIMIT = '2mb'
const DEMO_TRIGGER_DEVICE = 'sim-watch-a'

export interface CreateAppOptions {
  dataDir: string
  /** This computer's clock. Injectable for tests. */
  now?: () => Date
  /** Device token; otherwise GG_DEVICE_TOKEN, otherwise <dataDir>/device-token. */
  token?: string
  /** Accept the local network (the caller binds 0.0.0.0) and allow this machine's LAN host names. */
  lan?: boolean
  /** Serve the built dashboard from here, with an index.html fallback for client-side routes. */
  staticDir?: string | null
  /** The simulated demo bundle. Defaults to fixtures/simulated/demo-bundle.json. */
  fixturesFile?: string
  /** One line per notable request. Silent when omitted. Never receives the token. */
  log?: (line: string) => void
  /** Test hook: the address a request came from. Defaults to the socket's remote address. */
  clientAddress?: (req: IncomingMessage) => string | undefined
  /** How often unconfirmed deliveries are expired. 0 turns the timer off. */
  maintenanceIntervalMs?: number
  /** Test hook: replaces the atomic file writer. */
  writeFile?: WriteFile
  /** Test hook: this computer's network interfaces. Defaults to os.networkInterfaces. */
  networkInterfaces?: () => Interfaces
  /** Test hook: the HTTP client the diagnostics use to reach this server. Defaults to global fetch. */
  fetch?: typeof fetch
}

export interface MissionComputer {
  app: express.Express
  /** Stop the timer, refuse new changes and wait until every pending write is on disk. */
  close(): Promise<void>
  /** Run the delivery-expiry check now (the timer calls this). Resolves to the expired event ids. */
  runMaintenance(): Promise<string[]>
  info: {
    dataDir: string
    tokenSource: DeviceToken['source']
    tokenFile: string | null
    tokenPrefix: string
    tokenCreated: boolean
    /** Data files that did not exist and were created at startup. */
    createdFiles: string[]
  }
}

type ActorRule = 'ANY' | 'LOCAL_USER' | 'DEVICE' | 'DEVICE_OR_LOCAL_USER'

const ACTOR_LABEL: Record<ActorRule, string> = {
  ANY: 'ANY (no token needed)',
  LOCAL_USER: 'LOCAL_USER',
  DEVICE: 'DEVICE',
  DEVICE_OR_LOCAL_USER: 'DEVICE or LOCAL_USER',
}

interface Ctx {
  req: Request
  actor: ActorKind | null
  nowIso: string
}

interface Reply {
  status: number
  body: unknown
}

interface RouteDef {
  method: 'GET' | 'POST'
  path: string
  actor: ActorRule
  purpose: string
  handle: (ctx: Ctx) => Reply | Promise<Reply>
}

// ---------------------------------------------------------------------------
// Small helpers

/** Own-property lookup, so an id such as "constructor" never finds Object.prototype members. */
const own = <T>(map: Record<string, T>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined)
const ms = (iso: string) => Date.parse(iso)
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const isOpen = (e: StoredEvent) => e.status !== 'REVIEWED' && e.status !== 'CLOSED'
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function sortSessions(sessions: StoredSession[]): StoredSession[] {
  return [...sessions].sort((a, b) => ms(b.startedAt) - ms(a.startedAt) || cmp(a.sessionId, b.sessionId))
}

/** Open events first (anything not REVIEWED or CLOSED), then newest first. */
function sortAlerts(events: StoredEvent[]): StoredEvent[] {
  return [...events].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || ms(b.createdAt) - ms(a.createdAt) || cmp(a.eventId, b.eventId))
}

function workspaceParam(req: Request): Workspace {
  const raw = req.query.workspace
  if (raw === undefined) return 'mission'
  if (raw === 'mission' || raw === 'demo') return raw
  throw new HttpError(400, 'INVALID_WORKSPACE', 'workspace must be "mission" or "demo".')
}

function parseOr422<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const r = run(schema, body)
  if (!r.ok) throw new HttpError(422, 'VALIDATION_FAILED', `The ${what} does not match the v1 contract. Nothing was stored.`, r.errors)
  return r.value
}

/** The dataset without its internal fingerprints. */
function publicDataset(ds: Dataset) {
  return {
    workspace: ds.workspace,
    formatVersion: ds.formatVersion,
    sessions: ds.sessions,
    events: ds.events,
    readings: ds.readings,
    devices: ds.devices,
    log: ds.log,
  }
}

/** What the watch sees of an alert in its outbox: no evidence, review, history or provenance. */
function outboxItem(e: StoredEvent) {
  return {
    eventId: e.eventId,
    subjectId: e.subjectId,
    createdAt: e.createdAt,
    category: e.category,
    severity: e.severity,
    reasonCodes: e.reasonCodes,
    watchMessage: e.watchMessage,
    delivery: { channel: e.delivery.channel, state: e.delivery.state },
  }
}

/** The answer to a watch's delivery or acknowledgement report: the alert's state, nothing from its review. */
function reportView(e: StoredEvent) {
  const d = e.delivery
  const a = e.acknowledgement
  return {
    ...outboxItem(e),
    status: e.status,
    delivery: {
      channel: d.channel,
      state: d.state,
      presentedAt: d.presentedAt,
      hapticRequested: d.hapticRequested,
      confirmedBy: d.confirmedBy,
      confirmedByDeviceId: d.confirmedByDeviceId ?? null,
    },
    acknowledgement: a ? { acknowledgedAt: a.acknowledgedAt, via: a.via, deviceId: a.deviceId ?? null } : null,
  }
}

function counts(ds: Dataset) {
  return {
    sessions: Object.keys(ds.sessions).length,
    events: Object.keys(ds.events).length,
    readings: Object.keys(ds.readings).length,
    devices: Object.keys(ds.devices).length,
  }
}

const OUTCOME_STATUS: Record<Outcome, number> = {
  CREATED: 201,
  UPDATED: 200,
  DUPLICATE: 200,
  STALE_IGNORED: 200,
  CONFLICT: 409,
  REJECTED: 422,
}

/** REJECTED > CONFLICT > CREATED > everything else. */
function batchStatus(results: IngestResult[]): number {
  if (results.some((r) => r.outcome === 'REJECTED')) return 422
  if (results.some((r) => r.outcome === 'CONFLICT')) return 409
  if (results.some((r) => r.outcome === 'CREATED')) return 201
  return 200
}

const recordLabel = (results: IngestResult[], i: number) => `record ${i + 1}${results[i]?.id ? ` (${results[i].id})` : ''}`

/** Field-level reasons for rejected records. Only computed on the failure path. */
function rejectionDetails(raws: unknown[], results: IngestResult[]): string[] {
  const parse: string[] = []
  results.forEach((r, i) => {
    if (r.outcome !== 'REJECTED') return
    const c = classify(raws[i])
    if (c.kind === null) for (const e of c.errors) parse.push(`${recordLabel(results, i)}: ${e}`)
  })
  if (parse.length) return parse.slice(0, 100)
  return results.flatMap((r, i) => (r.outcome === 'REJECTED' ? [`${recordLabel(results, i)}: ${r.detail ?? 'rejected'}`] : [])).slice(0, 100)
}

function conflictDetails(results: IngestResult[]): string[] {
  return results.flatMap((r, i) => (r.outcome === 'CONFLICT' ? [`${recordLabel(results, i)}: ${r.detail ?? 'conflict'}`] : [])).slice(0, 100)
}

/** Turn a batch outcome into a reply, or an error carrying the same body. */
function batchReply(raws: unknown[], body: { results: IngestResult[] } & Record<string, unknown>): Reply {
  const status = batchStatus(body.results)
  if (status === 422) {
    const nothingStored = body.results.every((r) => r.outcome === 'REJECTED')
    throw new HttpError(
      422,
      'VALIDATION_FAILED',
      nothingStored
        ? 'Nothing was stored: at least one record was rejected. See details and results.'
        : 'Some records were rejected; the others were processed as listed in results.',
      rejectionDetails(raws, body.results),
      body,
    )
  }
  if (status === 409)
    throw new HttpError(409, 'CONFLICT', 'At least one record conflicts with what is already stored; the stored copy was kept.', conflictDetails(body.results), body)
  return { status, body }
}

// ---------------------------------------------------------------------------

/**
 * Build the API. Loads (or creates) the data files synchronously and throws if a data file or the
 * token file is unreadable, so a bad file stops startup instead of being overwritten.
 */
export function createApp(opts: CreateAppOptions): MissionComputer {
  const now = opts.now ?? (() => new Date())
  const lan = opts.lan ?? false
  const log = opts.log
  const clientAddress = opts.clientAddress ?? ((req: IncomingMessage) => req.socket.remoteAddress)
  const fixturesFile = opts.fixturesFile ?? DEFAULT_FIXTURES_FILE
  const startedAtMs = now().getTime()

  const readFixtures = (): unknown => {
    try {
      return JSON.parse(readFileSync(fixturesFile, 'utf8'))
    } catch (e) {
      throw new Error(`Cannot read the simulated demo bundle ${fixturesFile}: ${(e as Error).message}`)
    }
  }

  const store: Store = openStore({
    dataDir: opts.dataDir,
    seedDemo: (datasets) => {
      loadDemo(datasets, readFixtures(), now().toISOString())
    },
    write: opts.writeFile,
  })
  const dataDir = store.dataDir
  const tokenInfo = resolveDeviceToken({ dataDir, token: opts.token, env: process.env })
  const token = tokenInfo.token

  const interfacesNow = (): Interfaces => (opts.networkInterfaces ?? os.networkInterfaces)()
  const httpFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init))

  const staticHosts = allowedHostnames({ lan: false })
  const hostsNow = () => (lan ? allowedHostnames({ lan, interfaces: interfacesNow(), hostname: os.hostname() }) : staticHosts)

  // Pairing state comes from the watch link, which is created after the routes below.
  let watchLinkStatus: () => WatchLinkStatus = () => ({ pendingCodes: 0, paired: [] })
  // Self-test pairings never count: their device ids, and anything paired while a self-test runs.
  const selftestDevices = new Set<string>()
  const runningSelftests = new Set<number>()
  const realPairings = (): WatchLinkStatus => {
    const s = watchLinkStatus()
    const starts = [...runningSelftests]
    return {
      pendingCodes: s.pendingCodes,
      paired: s.paired.filter(
        (p) => !selftestDevices.has(p.deviceId) && !(p.pairedAt !== null && starts.some((t) => Date.parse(p.pairedAt as string) >= t)),
      ),
    }
  }

  const storageWritable = () => {
    try {
      accessSync(dataDir, fsConstants.W_OK)
      return store.lastWriteError === null
    } catch {
      return false
    }
  }

  // ----- shared steps ------------------------------------------------------

  const ingest = (raws: unknown[], ingestPath: IngestPathT, nowIso: string, fileName?: string) =>
    store.mutate((draft) => {
      const { results } = ingestRecords(draft, raws, { now: nowIso, path: ingestPath, fileName: fileName ?? null })
      const workspaces = WORKSPACES.filter((ws) => results.some((r) => r.workspace === ws))
      const createdEvents = workspaces.flatMap((ws) => runDataChecks(draft[ws], nowIso))
      return { results, workspaces, createdEvents }
    })

  /** One record from the watch: POST /sessions and POST /alerts. */
  const ingestOne = async (raw: unknown, schemaVersion: string, route: string, nowIso: string): Promise<Reply> => {
    if (!isPlainObject(raw)) throw new HttpError(422, 'VALIDATION_FAILED', `${route} takes one JSON object. Nothing was stored.`)
    if (raw.schemaVersion !== schemaVersion)
      throw new HttpError(422, 'WRONG_RECORD_TYPE', `${route} takes records with schemaVersion "${schemaVersion}". Nothing was stored.`, [
        `schemaVersion: expected "${schemaVersion}", got ${JSON.stringify(raw.schemaVersion) ?? 'nothing'}`,
      ])
    const out = await ingest([raw], 'LIVE_SYNC', nowIso)
    const result = out.results[0]
    const body = { result, createdEvents: out.createdEvents }
    if (result.outcome === 'CONFLICT') throw new HttpError(409, 'CONFLICT', result.detail ?? 'Conflicts with the stored copy, which was kept.', undefined, body)
    if (result.outcome === 'REJECTED') {
      const c = classify(raw)
      if (c.kind === null) throw new HttpError(422, 'VALIDATION_FAILED', 'The record does not match the v1 contract. Nothing was stored.', c.errors, body)
      throw new HttpError(422, 'REJECTED', `The record was not stored: ${result.detail ?? 'rejected'}`, undefined, body)
    }
    return { status: OUTCOME_STATUS[result.outcome], body }
  }

  /** A real event for a watch report. A demo-only id is refused; the demo is never touched here. */
  const missionEvent = (draft: Datasets, id: string): StoredEvent => {
    const e = own(draft.mission.events, id)
    if (e) return e
    if (own(draft.demo.events, id))
      throw new HttpError(409, 'SIMULATED_EVENT', `Alert ${id} exists only in the simulated demo workspace. A real watch cannot report on a simulated alert.`)
    throw new HttpError(404, 'EVENT_NOT_FOUND', `No alert ${id} on this computer. Send the event itself first (POST /api/v1/alerts).`)
  }

  /** An authenticated contact from a watch. */
  const markDeviceSeen = (ds: Dataset, deviceId: string, subjectId: string, nowIso: string) => {
    const prev = own(ds.devices, deviceId)
    ds.devices[deviceId] = prev
      ? { ...prev, lastSeenAt: nowIso }
      : {
          deviceId,
          subjectId,
          isSimulated: false,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          lastSyncAt: null,
          appVersion: null,
          deviceModel: null,
          pendingRecords: null,
        }
  }

  const MeasurementsBody = z.strictObject({ measurements: z.array(z.unknown()).min(1).max(500) })
  const ImportBody = z.strictObject({ fileName: z.string().trim().min(1).max(200), content: z.unknown() })

  // ----- routes --------------------------------------------------------------

  const routes: RouteDef[] = [
    {
      method: 'GET',
      path: '/health',
      actor: 'ANY',
      purpose: 'Service status and record counts. Contains no health data.',
      handle: ({ nowIso }) => {
        const writable = storageWritable()
        const ds = store.datasets
        return {
          status: 200,
          body: {
            ok: writable,
            service: SERVICE,
            version: VERSION,
            contractVersion: CONTRACT_VERSION,
            time: nowIso,
            uptimeSeconds: Math.max(0, Math.floor((ms(nowIso) - startedAtMs) / 1000)),
            storage: { dataDir, writable, lastWriteError: store.lastWriteError },
            workspaces: { mission: counts(ds.mission), demo: counts(ds.demo) },
            network: { bind: lan ? '0.0.0.0' : '127.0.0.1', lan },
          },
        }
      },
    },
    {
      method: 'GET',
      path: '/snapshot',
      actor: 'LOCAL_USER',
      purpose: 'Everything in one workspace, with the link state of each watch.',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        const ds = store.datasets[workspace]
        const links = Object.fromEntries(Object.values(ds.devices).map((d) => [d.deviceId, linkState(d, nowIso)]))
        return { status: 200, body: { workspace, serverTime: nowIso, dataset: publicDataset(ds), links } }
      },
    },
    {
      method: 'GET',
      path: '/sessions',
      actor: 'LOCAL_USER',
      purpose: 'Recovery sessions, newest first.',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        return { status: 200, body: { workspace, serverTime: nowIso, sessions: sortSessions(Object.values(store.datasets[workspace].sessions)) } }
      },
    },
    {
      method: 'GET',
      path: '/sessions/:id',
      actor: 'LOCAL_USER',
      purpose: 'One session with its linked readings from other instruments and its events.',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        const ds = store.datasets[workspace]
        const id = String(req.params.id)
        const session = own(ds.sessions, id)
        if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', `No session ${id} in the ${workspace} workspace.`)
        const events = sortAlerts(Object.values(ds.events).filter((e) => e.sessionId === id))
        return { status: 200, body: { workspace, serverTime: nowIso, session, readings: linkedReadings(ds, id), events } }
      },
    },
    {
      method: 'POST',
      path: '/sessions',
      actor: 'DEVICE',
      purpose: 'Watch app: send one recovery session after it is saved (and again with the same id if it changed while in progress).',
      handle: ({ req, nowIso }) => ingestOne(req.body, SESSION_SCHEMA, 'POST /api/v1/sessions', nowIso),
    },
    {
      method: 'GET',
      path: '/alerts',
      actor: 'LOCAL_USER',
      purpose: 'Review events: open ones first, then newest first.',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        return { status: 200, body: { workspace, serverTime: nowIso, events: sortAlerts(Object.values(store.datasets[workspace].events)) } }
      },
    },
    {
      method: 'GET',
      path: '/alerts/:id',
      actor: 'LOCAL_USER',
      purpose: 'One review event with the records it cites looked up.',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        const ds = store.datasets[workspace]
        const id = String(req.params.id)
        const event = own(ds.events, id)
        if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', `No event ${id} in the ${workspace} workspace.`)
        const session = event.sessionId ? (own(ds.sessions, event.sessionId) ?? null) : null
        return { status: 200, body: { workspace, serverTime: nowIso, event, evidence: resolveEvidence(event, ds), session } }
      },
    },
    {
      method: 'POST',
      path: '/alerts',
      actor: 'DEVICE',
      purpose: 'Watch app: send one review event when its rule fires (and again with the same id when delivery or acknowledgement changes).',
      handle: ({ req, nowIso }) => ingestOne(req.body, EVENT_SCHEMA, 'POST /api/v1/alerts', nowIso),
    },
    {
      method: 'POST',
      path: '/alerts/:id/ack',
      actor: 'DEVICE',
      purpose: 'Watch app: the wearer tapped acknowledge on the watch. Not a medical review.',
      handle: async ({ req, nowIso }) => {
        const ack = parseOr422(AckRequestSchema, req.body, 'acknowledgement')
        const id = String(req.params.id)
        const event = await store.mutate(
          (draft) => {
            const e = missionEvent(draft, id)
            const reporting = own(draft.mission.devices, ack.deviceId)
            const updated = applyAck(e, { acknowledgedAt: ack.acknowledgedAt, via: 'WATCH', deviceId: ack.deviceId }, 'DEVICE', reporting)
            draft.mission.events[id] = updated
            markDeviceSeen(draft.mission, ack.deviceId, e.subjectId, nowIso)
            return updated
          },
          { only: ['mission'] },
        )
        return { status: 200, body: { event: reportView(event) } }
      },
    },
    {
      method: 'POST',
      path: '/alerts/:id/delivery',
      actor: 'DEVICE',
      purpose: 'Watch app: it displayed an alert this computer sent. Send only after it was actually shown.',
      handle: async ({ req, nowIso }) => {
        const report = parseOr422(DeliveryReportSchema, req.body, 'delivery report')
        const id = String(req.params.id)
        const event = await store.mutate(
          (draft) => {
            const e = missionEvent(draft, id)
            const reporting = own(draft.mission.devices, report.deviceId)
            const updated = applyDeliveryReport(
              e,
              { presentedAt: report.presentedAt, hapticRequested: report.hapticRequested, deviceId: report.deviceId },
              'DEVICE',
              reporting,
            )
            draft.mission.events[id] = updated
            markDeviceSeen(draft.mission, report.deviceId, e.subjectId, nowIso)
            return updated
          },
          { only: ['mission'] },
        )
        return { status: 200, body: { event: reportView(event) } }
      },
    },
    {
      method: 'POST',
      path: '/alerts/:id/review',
      actor: 'LOCAL_USER',
      purpose: 'Dashboard: save review progress, mark reviewed (every checklist item) or close. ?workspace=mission|demo',
      handle: async ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        const action = parseOr422(ReviewActionSchema, req.body, 'review action')
        const id = String(req.params.id)
        const event = await store.mutate(
          (draft) => {
            const e = own(draft[workspace].events, id)
            if (!e) throw new HttpError(404, 'EVENT_NOT_FOUND', `No event ${id} in the ${workspace} workspace.`)
            const updated = applyReviewAction(e, action, nowIso)
            draft[workspace].events[id] = updated
            return updated
          },
          { only: [workspace] },
        )
        return { status: 200, body: { event } }
      },
    },
    {
      method: 'POST',
      path: '/measurements',
      actor: 'DEVICE_OR_LOCAL_USER',
      purpose: 'Stand-alone readings from other instruments, { measurements: [...] } (1-500). From the dashboard this is manual entry.',
      handle: async ({ req, actor, nowIso }) => {
        const { measurements } = parseOr422(MeasurementsBody, req.body, 'measurement upload')
        const notReadings = measurements.flatMap((m, i) =>
          isPlainObject(m) && m.schemaVersion === undefined ? [] : [`measurements.${i}: expected a measurement object (sessions and events have their own endpoints)`],
        )
        if (notReadings.length) throw new HttpError(422, 'VALIDATION_FAILED', 'Only measurements can be sent here. Nothing was stored.', notReadings)
        const out = await ingest(measurements, actor === 'DEVICE' ? 'LIVE_SYNC' : 'MANUAL_ENTRY', nowIso)
        return batchReply(measurements, { results: out.results, createdEvents: out.createdEvents })
      },
    },
    {
      method: 'POST',
      path: '/import',
      actor: 'LOCAL_USER',
      purpose: 'Dashboard: import an exported file, { fileName, content } where content is the parsed JSON (a bundle, an array of records or one record).',
      handle: async ({ req, nowIso }) => {
        const body = parseOr422(ImportBody, req.body, 'import request')
        if (body.content === undefined)
          throw new HttpError(422, 'VALIDATION_FAILED', 'The import request does not match. Nothing was stored.', ['content: the parsed JSON file is required'])
        const { records, errors } = expandPayload(body.content)
        if (errors.length) throw new HttpError(422, 'INVALID_BUNDLE', 'The file is not a valid export bundle. Nothing was stored.', errors)
        const out = await ingest(records, 'FILE_IMPORT', nowIso, body.fileName)
        return batchReply(records, { results: out.results, workspaces: out.workspaces, createdEvents: out.createdEvents })
      },
    },
    {
      method: 'POST',
      path: '/device/heartbeat',
      actor: 'DEVICE',
      purpose:
        'Watch app: "I am reachable" (about every 20 s while the app is open). Keeps the link VERIFIED for 60 s. With isSimulated: true it only touches the demo workspace.',
      handle: async ({ req, nowIso }) => {
        const hb = parseOr422(HeartbeatSchema, req.body, 'heartbeat')
        const ws: Workspace = hb.isSimulated ? 'demo' : 'mission'
        const device = await store.mutate((draft) => applyHeartbeat(draft[ws], hb, nowIso), { only: [ws] })
        return { status: 200, body: { device, linkState: linkState(device, nowIso), serverTime: nowIso } }
      },
    },
    {
      method: 'GET',
      path: '/device/outbox',
      actor: 'DEVICE',
      purpose: 'Watch app: alerts this computer queued for the watch, ?deviceId=<id>. Oldest first.',
      handle: ({ req, nowIso }) => {
        const raw = req.query.deviceId
        const parsed = Id.safeParse(raw)
        if (!parsed.success) throw new HttpError(400, 'INVALID_QUERY', 'deviceId is required: the same id the watch sends in heartbeats.')
        const deviceId = parsed.data
        const ds = store.datasets.mission
        const device = own(ds.devices, deviceId) ?? null
        const events = [...outboxFor(ds, deviceId)].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || cmp(a.eventId, b.eventId)).map(outboxItem)
        return { status: 200, body: { deviceId, deviceKnown: device !== null, subjectId: device?.subjectId ?? null, serverTime: nowIso, events } }
      },
    },
    {
      method: 'GET',
      path: '/devices',
      actor: 'LOCAL_USER',
      purpose: 'Known watches with their link state (VERIFIED only within 60 s of the last authenticated contact).',
      handle: ({ req, nowIso }) => {
        const workspace = workspaceParam(req)
        const devices = Object.values(store.datasets[workspace].devices)
          .sort((a, b) => ms(b.lastSeenAt) - ms(a.lastSeenAt) || cmp(a.deviceId, b.deviceId))
          .map((d) => ({ ...d, linkState: linkState(d, nowIso) }))
        return { status: 200, body: { workspace, serverTime: nowIso, devices } }
      },
    },
    {
      method: 'GET',
      path: '/integration',
      actor: 'LOCAL_USER',
      purpose: 'Dashboard System Status page: the device token, URLs for the watch and this endpoint list.',
      handle: ({ req }) => {
        const port = req.socket.localPort ?? null
        const lanIps = lan ? lanIPv4Addresses(interfacesNow()) : []
        const urls = port === null ? [] : [`http://127.0.0.1:${port}`, ...lanIps.map((ip) => `http://${ip}:${port}`)]
        return {
          status: 200,
          body: {
            token,
            tokenFile: tokenInfo.file,
            tokenSource: tokenInfo.source,
            port,
            lan,
            urls,
            endpoints: routes.map((r) => ({ method: r.method, path: `/api/v1${r.path}`, actor: ACTOR_LABEL[r.actor], purpose: r.purpose })),
          },
        }
      },
    },
    {
      method: 'GET',
      path: '/integration/checks',
      actor: 'LOCAL_USER',
      purpose:
        'System Status: what this computer can tell about the watch connection, as nine PASS / FAIL / NOT_TESTED checks. Simulated and demo data never make a check pass.',
      handle: async ({ req, nowIso }) => ({
        status: 200,
        body: await buildChecks({
          nowIso,
          version: VERSION,
          uptimeSeconds: Math.max(0, Math.floor((ms(nowIso) - startedAtMs) / 1000)),
          storageWritable: storageWritable(),
          lan,
          port: req.socket.localPort ?? null,
          interfaces: lanIPv4Interfaces(interfacesNow()),
          link: realPairings(),
          mission: store.datasets.mission,
          missionFile: store.fileFor('mission'),
          fetch: httpFetch,
        }),
      }),
    },
    {
      method: 'POST',
      path: '/integration/selftest',
      actor: 'LOCAL_USER',
      purpose:
        'Simulated self-test: real HTTP requests to this computer’s own pairing and signal endpoints, with a simulated signal stored in the demo workspace. Not proof that a watch can connect.',
      handle: async ({ req, nowIso }) => {
        const port = req.socket.localPort
        if (port === undefined) throw new HttpError(500, 'NO_LOCAL_PORT', 'Cannot tell which port this server is listening on.')
        const lanAddress = lan ? lanIPv4Interfaces(interfacesNow())[0]?.address : undefined
        const startedAt = ms(nowIso)
        runningSelftests.add(startedAt)
        try {
          const report = await runSelftest({
            fetch: httpFetch,
            nowIso,
            nowSeconds: startedAt / 1000,
            lan,
            watchBase: lanAddress ? `http://${lanAddress}:${port}` : `http://127.0.0.1:${port}`,
            consoleBase: `http://127.0.0.1:${port}`,
            markDevice: (deviceId) => void selftestDevices.add(deviceId),
            inWorkspace: (eventId) => ({
              demo: Object.hasOwn(store.datasets.demo.events, eventId),
              mission: Object.hasOwn(store.datasets.mission.events, eventId),
            }),
          })
          return { status: 200, body: report }
        } finally {
          runningSelftests.delete(startedAt)
        }
      },
    },
    {
      method: 'POST',
      path: '/demo/reset',
      actor: 'LOCAL_USER',
      purpose: 'Replace the simulated demo workspace with the fixture bundle. Never touches mission data.',
      handle: async ({ nowIso }) => {
        let bundle: unknown
        try {
          bundle = readFixtures()
        } catch (e) {
          throw new HttpError(500, 'DEMO_FIXTURES_UNREADABLE', (e as Error).message)
        }
        const out = await store.mutate(
          (draft) => {
            let createdEvents: string[]
            try {
              ;({ createdEvents } = loadDemo(draft, bundle, nowIso))
            } catch (e) {
              throw new HttpError(500, 'DEMO_LOAD_FAILED', `The demo workspace was not changed: ${(e as Error).message}`)
            }
            return { ...counts(draft.demo), createdEvents }
          },
          { only: ['demo'] },
        )
        return {
          status: 200,
          body: { workspace: 'demo', sessions: out.sessions, events: out.events, readings: out.readings, createdEvents: out.createdEvents },
        }
      },
    },
    {
      method: 'POST',
      path: '/demo/trigger',
      actor: 'LOCAL_USER',
      purpose: 'Create a simulated watch check with a simulated review event in the demo workspace.',
      handle: async ({ nowIso }) => {
        // Whole seconds, so a double click makes the same ids and is recognised as a repeat.
        const at = new Date(Math.floor(ms(nowIso) / 1000) * 1000).toISOString()
        const { session, event } = buildTriggeredDemo(at)
        const out = await store.mutate(
          (draft) => {
            const { results } = ingestRecords(draft, [session, event], { now: nowIso, path: 'DEMO_TRIGGER' })
            const bad = results.filter((r) => r.outcome !== 'CREATED' && r.outcome !== 'DUPLICATE')
            if (bad.length)
              throw new HttpError(409, 'DEMO_TRIGGER_FAILED', `The simulated event could not be stored: ${bad.map((r) => `${r.id}: ${r.outcome} ${r.detail ?? ''}`.trim()).join('; ')}`)
            const template = DEMO_DEVICES.find((d) => d.deviceId === DEMO_TRIGGER_DEVICE)
            const prev = own(draft.demo.devices, DEMO_TRIGGER_DEVICE) ?? (template ? { ...template } : null)
            if (prev) draft.demo.devices[DEMO_TRIGGER_DEVICE] = { ...prev, isSimulated: true, lastSeenAt: nowIso, lastSyncAt: nowIso }
            const createdEvents = runDataChecks(draft.demo, nowIso)
            return { results, createdEvents }
          },
          { only: ['demo'] },
        )
        const created = out.results.some((r) => r.outcome === 'CREATED')
        return {
          status: created ? 201 : 200,
          body: { sessionId: session.sessionId, eventId: event.eventId, results: out.results, createdEvents: out.createdEvents },
        }
      },
    },
    {
      method: 'POST',
      path: '/demo/alerts/:id/simulate-ack',
      actor: 'LOCAL_USER',
      purpose: 'Simulate the wearer acknowledging a demo alert on a simulated watch.',
      handle: async ({ req, nowIso }) => {
        const id = String(req.params.id)
        const event = await store.mutate(
          (draft) => {
            const e = own(draft.demo.events, id)
            if (!e) {
              if (own(draft.mission.events, id))
                throw new HttpError(409, 'REAL_EVENT', `Event ${id} is a real mission event; only demo events can receive a simulated acknowledgement.`)
              throw new HttpError(404, 'EVENT_NOT_FOUND', `No event ${id} in the demo workspace.`)
            }
            const updated = applyAck(e, { acknowledgedAt: nowIso, via: 'SIMULATED_WATCH' }, 'LOCAL_USER')
            draft.demo.events[id] = updated
            return updated
          },
          { only: ['demo'] },
        )
        return { status: 200, body: { event } }
      },
    },
  ]

  // ----- middleware --------------------------------------------------------

  const actorGuard =
    (rule: ActorRule): RequestHandler =>
    (req, res, next) => {
      const r = resolveActor(clientAddress(req), req.headers.authorization, token)
      if (!r.ok) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="gravityguard"')
        return next(new HttpError(401, r.code, r.message))
      }
      res.locals.actor = r.actor
      if (rule === 'LOCAL_USER' && r.actor !== 'LOCAL_USER')
        return next(
          new HttpError(
            403,
            'LOCAL_USER_ONLY',
            'Only the dashboard on this computer can call this (loopback, without a token). The device token cannot read health records, review events or run the demo.',
          ),
        )
      if (rule === 'DEVICE' && r.actor !== 'DEVICE')
        return next(new HttpError(403, 'DEVICE_ONLY', 'Only the watch app can call this. Send "Authorization: Bearer <device token>".'))
      next()
    }

  const requireJson: RequestHandler = (req, _res, next) => {
    if (isJsonContentType(req.headers['content-type'])) return next()
    next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'POST requests must send "Content-Type: application/json" (send {} when there is nothing else to send).'))
  }

  const jsonParser = express.json({ limit: JSON_LIMIT })

  const toHandler =
    (def: RouteDef): RequestHandler =>
    (req, res, next) => {
      const ctx: Ctx = { req, actor: (res.locals.actor as ActorKind | undefined) ?? null, nowIso: now().toISOString() }
      Promise.resolve()
        .then(() => def.handle(ctx))
        .then((reply) => {
          res.status(reply.status).json(reply.body)
        }, next)
    }

  const router = express.Router()
  for (const def of routes) {
    const chain: RequestHandler[] = []
    if (def.actor !== 'ANY') chain.push(actorGuard(def.actor))
    if (def.method === 'POST') chain.push(requireJson, jsonParser)
    chain.push(toHandler(def))
    if (def.method === 'GET') router.get(def.path, ...chain)
    else router.post(def.path, ...chain)
  }

  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)

  if (log)
    app.use((req, res, next) => {
      const started = process.hrtime.bigint()
      res.on('finish', () => {
        const actor = (res.locals.actor as string | undefined) ?? '-'
        const quietRead = (req.method === 'GET' || req.method === 'HEAD') && res.statusCode < 400 && actor !== 'DEVICE'
        if (quietRead) return
        const took = Number(process.hrtime.bigint() - started) / 1e6
        const code = res.locals.errorCode ? ` ${String(res.locals.errorCode)}` : ''
        log(`${new Date().toISOString()} ${req.method} ${req.originalUrl.slice(0, 200)} -> ${res.statusCode}${code} ${actor} ${took.toFixed(0)}ms`)
      })
      next()
    })

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'")
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })

  app.use((req, _res, next) => {
    if (isHostAllowed(req.headers.host, hostsNow())) return next()
    const shown = String(req.headers.host ?? '').slice(0, 100)
    next(
      new HttpError(
        403,
        'HOST_NOT_ALLOWED',
        `Host "${shown}" is not an address of this computer. Use http://127.0.0.1:<port>${lan ? " or this computer's local-network address" : ''}.`,
      ),
    )
  })

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use('/api/v1', router)
  const watchLink = createWatchLink({
    now,
    localUser: actorGuard('LOCAL_USER'),
    // A code-paired watch app, which may be running in the Xcode simulator: never claim hardware.
    onHeartbeat: (deviceId, nowIso) => store.mutate((draft) => applyHeartbeat(
      draft.mission,
      { deviceId, subjectId: 'crew-a', sentAt: nowIso, appVersion: null, deviceModel: 'GRAVITYGUARD watch app (code-paired)', pendingRecords: null },
      nowIso,
    ), { only: ['mission'] }),
    onSignal: (signal, deviceId, nowIso) => {
      const createdAt = new Date(signal.createdAt * 1000).toISOString()
      const simulated = signal.frame.simulated
      const reason = 'WATCH_TELEMETRY_FLAG'
      const readings = signal.frame.readings.filter((r) => signal.evidence.includes(r.metric))
      return ingestOne({
        schemaVersion: EVENT_SCHEMA,
        eventId: signal.id,
        subjectId: 'crew-a',
        createdAt,
        origin: { kind: 'WATCH_RULES', ruleSet: 'Telemetry review', deviceId },
        category: 'VERIFY_SOURCE',
        severity: readings.some((r) => r.status === 'priority') ? 'PRIORITY_REVIEW' : 'REVIEW',
        reasonCodes: [reason],
        evidence: readings.map((r) => ({
          reasonCode: reason, kind: 'DEVICE', refId: deviceId,
          note: `${signal.frame.source} · ${r.metric} ${r.value} ${r.unit} · ${r.status}`.slice(0, 280),
        })),
        watchMessage: { title: 'Review signal', body: signal.action.slice(0, 120) },
        status: 'DELIVERED',
        delivery: {
          channel: simulated ? 'SIMULATED_WATCH' : 'WATCH_LOCAL', state: 'PRESENTED',
          presentedAt: createdAt, hapticRequested: signal.hapticRequested ?? true, confirmedBy: simulated ? 'SIMULATION' : 'WATCH_APP',
        },
        isSimulated: simulated,
        provenance: { origin: simulated ? 'DEMO_FIXTURE' : 'WATCH_APP', deviceId },
        extensions: { watchReviewAction: signal.action },
      }, EVENT_SCHEMA, 'POST /api/signals', nowIso)
    },
  })
  watchLinkStatus = watchLink.status
  app.use('/api', watchLink)
  app.use('/api', (req, _res, next) => next(new HttpError(404, 'NOT_FOUND', `No API endpoint ${req.method} ${req.originalUrl.split('?')[0].slice(0, 200)}.`)))

  if (opts.staticDir) {
    const staticDir = path.resolve(opts.staticDir)
    const indexHtml = path.join(staticDir, 'index.html')
    app.use(express.static(staticDir))
    app.get('/{*splat}', (_req, res, next) => {
      res.sendFile(indexHtml, (err) => {
        if (err) next(err)
      })
    })
  }

  app.use((req, _res, next) =>
    next(
      new HttpError(
        404,
        'NOT_FOUND',
        opts.staticDir
          ? `Nothing at ${req.originalUrl.split('?')[0].slice(0, 200)}.`
          : 'This is the mission-computer API (under /api/v1). The dashboard is served by Vite in development (npm run dev) or from dist/ by npm start after npm run build.',
      ),
    ),
  )

  const onError: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err)
    const send = (status: number, code: string, message: string, details?: string[], extra?: Record<string, unknown>) => {
      res.locals.errorCode = code
      res.status(status).json({ ...(extra ?? {}), ...errorBody(code, message, details) })
    }
    if (err instanceof HttpError) return send(err.status, err.code, err.message, err.details, err.extra)
    if (err instanceof ActionError) return send(err.httpStatus, err.code, err.message)
    const e = err as { type?: string; status?: number; message?: string; stack?: string }
    if (e?.type === 'entity.parse.failed') return send(400, 'INVALID_JSON', `The request body is not valid JSON: ${e.message ?? 'parse error'}`)
    if (e?.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', `The request body is larger than ${JSON_LIMIT}.`)
    if (e?.type === 'charset.unsupported' || e?.type === 'encoding.unsupported') return send(415, 'UNSUPPORTED_MEDIA_TYPE', e.message ?? 'unsupported encoding')
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) return send(e.status, 'BAD_REQUEST', e.message ?? 'bad request')
    log?.(`internal error on ${req.method} ${req.originalUrl.slice(0, 200)}: ${e?.stack ?? String(err)}`)
    if (!log) console.error(err)
    return send(500, 'INTERNAL_ERROR', 'Unexpected error on the mission computer. Its console has the details.')
  }
  app.use(onError)

  // ----- maintenance -------------------------------------------------------

  const runMaintenance = async (): Promise<string[]> => {
    const ds = store.datasets
    const anyQueued = WORKSPACES.some((ws) => Object.values(ds[ws].events).some((e) => e.delivery.state === 'QUEUED'))
    if (!anyQueued) return []
    const nowIso = now().toISOString()
    return store.mutate((draft) => [...expireDeliveries(draft.mission, nowIso), ...expireDeliveries(draft.demo, nowIso)])
  }

  const intervalMs = opts.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS
  const timer =
    intervalMs > 0
      ? setInterval(() => {
          runMaintenance().catch((e: unknown) => log?.(`delivery expiry check failed: ${(e as Error).message}`))
        }, intervalMs)
      : null
  timer?.unref()

  return {
    app,
    async close() {
      if (timer) clearInterval(timer)
      await store.close()
    },
    runMaintenance,
    info: {
      dataDir,
      tokenSource: tokenInfo.source,
      tokenFile: tokenInfo.file,
      tokenPrefix: tokenPrefix(token),
      tokenCreated: tokenInfo.created,
      createdFiles: store.created.map((ws) => store.fileFor(ws)),
    },
  }
}
