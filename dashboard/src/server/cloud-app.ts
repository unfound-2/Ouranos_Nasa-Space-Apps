import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DaySchema, PlanActionSchema, actOnPlan, type DayPlan } from '../shared/daily-plan.js'
import { createCrewAssistant } from './crew-assistant.js'
import express, { type Request } from 'express'
import demoFixture from '../../fixtures/simulated/demo-bundle.json' with { type: 'json' }
import { EVENT_SCHEMA, ReviewActionSchema, type StoredEvent } from '../shared/contract.js'
import { ActionError, applyHeartbeat, applyReviewAction, emptyDataset, ingestRecords, linkState, type Datasets } from '../shared/dataset.js'
import { loadDemo } from '../shared/demo.js'
import { WatchFrameSchema, WatchSignalSchema, type WatchFrame, type WatchSignal } from '../shared/watch-link.js'

// Reserved per-device JSON record; excluded from clinical event reads and review actions.
const planRecordId = '00000000-0000-4000-8000-000000000001'
type PlanRecord = { event: { recordType: 'DAILY_PLAN'; plan: DayPlan }; version: number }

const cookieName = '__Host-gg_watch'
const pairMillis = 5 * 60_000
const sessionMillis = 12 * 60 * 60_000
const secret = () => randomBytes(32).toString('hex')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const tokenShape = /^[a-f0-9]{64}$/

type Pair = {
  device_id: string
  code_hash: string | null
  browser_hash: string | null
  expires_at: string
  last_seen: string | null
  watch: WatchFrame | null
}
type WatchEvent = { device_id: string; event_id: string; event: StoredEvent; version: number }
type CloudOptions = { url: string; key?: string; fetch?: typeof fetch; groq?: string }

function browserToken(req: Request) {
  const token = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  return token && tokenShape.test(token) ? token : null
}
function watchToken(req: Request) {
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization ?? '')?.[1]
  if (!token) throw new ActionError('WATCH_TOKEN_REQUIRED', 401, 'A watch token is required.')
  return token
}
function reject(code: string, status: number, message: string): never {
  throw new ActionError(code, status, message)
}

function signalEvent(signal: WatchSignal, deviceId: string, now: string) {
  const dataset: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
  const simulated = signal.frame.simulated
  const createdAt = new Date(signal.createdAt * 1000).toISOString()
  const readings = signal.frame.readings.filter((reading) => signal.evidence.includes(reading.metric))
  const reasonCode = 'WATCH_TELEMETRY_FLAG'
  ingestRecords(dataset, [{
    schemaVersion: EVENT_SCHEMA, eventId: signal.id, subjectId: deviceId, createdAt,
    origin: { kind: 'WATCH_RULES', ruleSet: 'Telemetry review', deviceId },
    category: 'VERIFY_SOURCE',
    severity: readings.some((reading) => reading.status === 'priority') ? 'PRIORITY_REVIEW' : 'REVIEW',
    reasonCodes: [reasonCode],
    evidence: readings.map((reading) => ({
      reasonCode, kind: 'DEVICE', refId: deviceId,
      note: `${signal.frame.source}  ${reading.metric} ${reading.value} ${reading.unit}  ${reading.status}`.slice(0, 280),
    })),
    watchMessage: { title: 'Review signal', body: signal.action.slice(0, 120) },
    status: 'DELIVERED',
    delivery: {
      channel: simulated ? 'SIMULATED_WATCH' : 'WATCH_LOCAL', state: 'PRESENTED', presentedAt: createdAt,
      hapticRequested: signal.hapticRequested ?? false, confirmedBy: simulated ? 'SIMULATION' : 'WATCH_APP',
    },
    isSimulated: simulated,
    provenance: { origin: simulated ? 'DEMO_FIXTURE' : 'WATCH_APP', deviceId },
    extensions: { watchReviewAction: signal.action },
  }], { now, path: 'LIVE_SYNC' })
  return dataset[simulated ? 'demo' : 'mission'].events[signal.id]
}

export function createCloudApp({ url, key, fetch: request = fetch, groq }: CloudOptions) {
  const app = express()
  app.disable('x-powered-by')

  async function db<T>(table: string, params: Record<string, string> = {}, method = 'GET', body?: unknown, prefer = 'return=representation'): Promise<T> {
    if (!key) reject('CLOUD_NOT_CONFIGURED', 503, 'The hosted console needs its Supabase server key.')
    const path = new URL(`/rest/v1/${table}`, url)
    path.search = new URLSearchParams(params).toString()
    const response = await request(path, {
      method,
      headers: {
        apikey: key,
        ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        'Content-Type': 'application/json', Prefer: prefer,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3500),
    })
    if (!response.ok) reject('DATABASE_UNAVAILABLE', 503, 'The hosted console could not reach its data store.')
    const result = await response.text()
    return (result ? JSON.parse(result) : undefined) as T
  }

  const active = () => ({ expires_at: `gt.${new Date().toISOString()}` })
  const pairFields = 'device_id,code_hash,browser_hash,expires_at,last_seen,watch'
  const scopedPairs = (req: Request) => {
    const token = browserToken(req)
    return token
      ? db<Pair[]>('gg_watch_pairs', { ...active(), browser_hash: `eq.${hash(token)}`, select: pairFields, limit: '32' })
      : Promise.resolve([])
  }
  const watchFilter = (req: Request) => ({ ...active(), watch_hash: `eq.${hash(watchToken(req))}` })
  const pairedFilter = (req: Request) => ({ ...watchFilter(req), code_hash: 'is.null' })

  async function rateLimit(req: Request, scope: string, allowance: number) {
    const ip = req.header('x-vercel-forwarded-for')?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
    const allowed = await db<boolean>('rpc/gg_pairing_attempt', {}, 'POST', { rate_key: hash(`${scope}:${ip}`), allowance })
    if (!allowed) reject('TOO_MANY_ATTEMPTS', 429, 'Too many pairing requests. Try again in five minutes.')
  }

  async function eventsFor(pairs: Pair[]) {
    return pairs.length ? db<WatchEvent[]>('gg_watch_events', {
      device_id: `in.(${pairs.map(({ device_id }) => device_id).join(',')})`,
      select: 'device_id,event_id,event,version', event_id: `neq.${planRecordId}`, order: 'created_at.desc', limit: '150',
    }) : []
  }

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const site = req.header('sec-fetch-site')
    if (site === 'cross-site' || site === 'same-site') return next(new ActionError('ORIGIN_REJECTED', 403, 'Use the hosted dashboard on its own origin.'))
    next()
  }, express.json({ limit: '64kb' }))

  const crewAssistant = createCrewAssistant({ url, key, groq, request })
  app.get('/api/v1/crew-guide', crewAssistant.list)
  app.post('/api/v1/crew-assistant', async (req, _res, next) => {
    if (groq ?? process.env.GROQ_API_KEY) await rateLimit(req, 'crew-assistant', 16)
    next()
  }, crewAssistant.explain)

  app.get('/api/v1/health', (_req, res) => {
    const counts = { sessions: 0, events: 0, readings: 0, devices: 0 }
    res.json({
      ok: true, service: 'gravityguard-mission-computer', version: '1.0.0', contractVersion: 'v1', time: new Date().toISOString(),
      uptimeSeconds: 0, storage: { dataDir: 'Supabase', writable: Boolean(key) }, workspaces: { mission: counts, demo: counts },
      network: { bind: 'HTTPS', lan: false },
    })
  })

  app.post('/api/pairing', async (req, res) => {
    await rateLimit(req, 'create', 12)
    const code = randomBytes(5).toString('hex').toUpperCase()
    const token = secret()
    const expires = new Date(Date.now() + pairMillis)
    await db('gg_watch_pairs', {}, 'POST', {
      device_id: randomUUID(), code_hash: hash(code), watch_hash: hash(token), expires_at: expires.toISOString(),
    }, 'return=minimal')
    res.status(201).json({ code, watchToken: token, codeExpiresAt: expires.getTime() / 1000 })
  })

  app.post('/api/pairing/redeem', async (req, res) => {
    await rateLimit(req, 'redeem', 20)
    const code = typeof req.body?.code === 'string' ? req.body.code.toUpperCase().replace(/[\s-]/g, '') : ''
    if (!/^[A-F0-9]{10}$/.test(code)) reject('PAIRING_CODE_INVALID', 404, 'Use the ten-character code on the watch.')
    const token = browserToken(req) ?? secret()
    const [pair] = await db<Pair[]>('gg_watch_pairs', { ...active(), code_hash: `eq.${hash(code)}`, select: 'device_id' }, 'PATCH', {
      code_hash: null, browser_hash: hash(token), expires_at: new Date(Date.now() + sessionMillis).toISOString(),
    })
    if (!pair) reject('PAIRING_CODE_INVALID', 404, 'This code expired or was already used. Generate a new code on the watch.')
    res.cookie(cookieName, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: sessionMillis })
    res.json({ deviceId: pair.device_id })
  })

  app.get('/api/device', async (req, res) => {
    const filter = watchFilter(req)
    const [pair] = await db<Pair[]>('gg_watch_pairs', { ...filter, select: 'device_id,code_hash,last_seen' })
    if (!pair) reject('PAIRING_EXPIRED', 401, 'Generate a new code on the watch.')
    const paired = pair.code_hash === null
    if (paired && (!pair.last_seen || Date.now() - Date.parse(pair.last_seen) > 20_000)) {
      await db('gg_watch_pairs', filter, 'PATCH', { last_seen: new Date().toISOString() }, 'return=minimal')
    }
    res.json({ paired })
  })

  app.delete('/api/device', async (req, res) => {
    await db('gg_watch_pairs', watchFilter(req), 'DELETE', undefined, 'return=minimal')
    res.json({ removed: true })
  })

  app.get('/api/watch-links', async (req, res) => {
    const pairs = await scopedPairs(req)
    res.json(pairs.map((pair) => ({ deviceId: pair.device_id, watch: pair.watch, telemetry: [] })))
  })

  async function readPlan(deviceId: string) {
    const [row] = await db<PlanRecord[]>('gg_watch_events', {
      device_id: `eq.${deviceId}`, event_id: `eq.${planRecordId}`, select: 'event,version', limit: '1',
    })
    if (!row) return null
    const parsed = DaySchema.safeParse(row.event?.plan)
    if (row.event?.recordType !== 'DAILY_PLAN' || !parsed.success) reject('PLAN_UNAVAILABLE', 503, 'The saved plan is unavailable.')
    return { ...parsed.data, revision: row.version }
  }
  async function writePlan(deviceId: string, plan: DayPlan, expected: unknown) {
    if (!Number.isInteger(expected) || Number(expected) < 0) reject('INVALID_PLAN', 422, 'A plan revision is required.')
    const revision = Number(expected) + 1
    const next = { ...plan, revision, updatedAt: new Date().toISOString() }
    const event = { recordType: 'DAILY_PLAN', plan: next }
    const rows = expected === 0
      ? await db<PlanRecord[]>('gg_watch_events', {}, 'POST', { device_id: deviceId, event_id: planRecordId, created_at: next.updatedAt, event, version: revision }, 'resolution=ignore-duplicates,return=representation')
      : await db<PlanRecord[]>('gg_watch_events', { device_id: `eq.${deviceId}`, event_id: `eq.${planRecordId}`, version: `eq.${expected}` }, 'PATCH', { event, version: revision })
    if (!rows?.length) reject('PLAN_CHANGED', 409, 'The plan changed. Refresh before saving.')
    return next
  }
  app.get('/api/planner/:deviceId', async (req, res) => {
    const pair = (await scopedPairs(req)).find(p => p.device_id === req.params.deviceId)
    if (!pair) reject('PAIRING_REQUIRED', 401, 'Pair this watch with the console first.')
    res.json(await readPlan(pair.device_id))
  })
  app.post('/api/planner/:deviceId', async (req, res) => {
    const pair = (await scopedPairs(req)).find(p => p.device_id === req.params.deviceId)
    if (!pair) reject('PAIRING_REQUIRED', 401, 'Pair this watch with the console first.')
    const parsed = DaySchema.safeParse(req.body?.plan)
    if (!parsed.success || parsed.data.simulated) reject('INVALID_PLAN', 422, 'A valid mission plan is required.')
    res.json(await writePlan(pair.device_id, parsed.data, req.body.expectedRevision))
  })
  app.get('/api/planner', async (req, res) => {
    const [pair] = await db<Pair[]>('gg_watch_pairs', { ...pairedFilter(req), select: 'device_id' })
    if (!pair) reject('PAIRING_REQUIRED', 401, 'Pair this watch with the console first.')
    res.json(await readPlan(pair.device_id))
  })
  app.post('/api/planner-action', async (req, res) => {
    const [pair] = await db<Pair[]>('gg_watch_pairs', { ...pairedFilter(req), select: 'device_id' })
    if (!pair) reject('PAIRING_REQUIRED', 401, 'Pair this watch with the console first.')
    const parsed = PlanActionSchema.safeParse(req.body?.action)
    if (!parsed.success) reject('INVALID_ACTION', 422, 'Choose a supported plan action.')
    const plan = await readPlan(pair.device_id)
    if (!plan) reject('PLAN_REQUIRED', 422, 'Create today’s plan on the console first.')
    if (req.body.expectedRevision !== plan.revision) reject('PLAN_CHANGED', 409, 'Refresh the plan before retrying.')
    let next: DayPlan
    try { next = actOnPlan(plan, parsed.data) } catch (e) { reject('INVALID_ACTION', 422, (e as Error).message) }
    res.json(await writePlan(pair.device_id, next, plan.revision))
  })

  app.post('/api/watch', async (req, res) => {
    const frame = WatchFrameSchema.safeParse(req.body)
    const now = Date.now()
    if (!frame.success || Math.abs(frame.data.observedAt * 1000 - now) > (frame.data.freshnessSeconds ?? 15) * 1000 ||
      frame.data.observedAt * 1000 - now > 5000) reject('INVALID_FRAME', 422, 'Expected a fresh watch reading.')
    const filter = pairedFilter(req)
    const updated = await db<Pair[]>('gg_watch_pairs', {
      ...filter, or: `(observed_at.is.null,observed_at.lt.${frame.data.observedAt})`, select: 'device_id',
    }, 'PATCH', { watch: frame.data, observed_at: frame.data.observedAt, last_seen: new Date(now).toISOString() })
    if (!updated.length) {
      const [pair] = await db<Pair[]>('gg_watch_pairs', { ...filter, select: 'device_id' })
      if (!pair) reject('PAIRING_EXPIRED', 401, 'Pair the watch with this console.')
    }
    res.status(202).json({ accepted: true })
  })

  app.delete('/api/watch', async (req, res) => {
    const rows = await db<Pair[]>('gg_watch_pairs', { ...pairedFilter(req), select: 'device_id' }, 'PATCH', {
      watch: null, observed_at: Date.now() / 1000,
    })
    if (!rows.length) reject('PAIRING_EXPIRED', 401, 'Pair the watch with this console.')
    res.json({ removed: true })
  })

  app.post('/api/signals', async (req, res) => {
    const signal = WatchSignalSchema.safeParse(req.body)
    if (signal.success && signal.data.id === planRecordId) reject('INVALID_SIGNAL', 422, 'This identifier is reserved for the daily plan.')
    if (!signal.success) reject('INVALID_SIGNAL', 422, 'Invalid watch review signal.')
    const [pair] = await db<Pair[]>('gg_watch_pairs', { ...pairedFilter(req), select: 'device_id' })
    if (!pair) reject('PAIRING_EXPIRED', 401, 'Pair the watch with this console.')
    const now = new Date().toISOString()
    const event = signalEvent(signal.data, pair.device_id, now)
    if (!event) reject('INVALID_SIGNAL', 422, 'The watch review signal did not produce a valid event.')
    await db('gg_watch_events', {}, 'POST', {
      device_id: pair.device_id, event_id: event.eventId, created_at: event.createdAt, event,
    }, 'resolution=ignore-duplicates,return=minimal')
    res.status(202).json({ accepted: true })
  })

  app.get('/api/v1/snapshot', async (req, res) => {
    const workspace = req.query.workspace === 'demo' ? 'demo' : 'mission'
    const now = new Date().toISOString()
    const datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
    if (workspace === 'demo') loadDemo(datasets, demoFixture, now)
    const dataset = datasets[workspace]
    const pairs = await scopedPairs(req)
    for (const pair of pairs) {
      if (!pair.last_seen || workspace === 'demo') continue
      applyHeartbeat(dataset, {
        deviceId: pair.device_id, subjectId: pair.device_id, sentAt: pair.last_seen,
        appVersion: null, deviceModel: 'Paired watch', pendingRecords: null,
      }, pair.last_seen)
    }
    for (const row of await eventsFor(pairs)) {
      if (row.event.isSimulated === (workspace === 'demo')) dataset.events[row.event_id] = row.event
    }
    const links = Object.fromEntries(Object.values(dataset.devices).map((device) => [device.deviceId, linkState(device, now)]))
    res.json({ workspace, serverTime: now, dataset: { ...dataset, fingerprints: {} }, links })
  })

  app.post('/api/v1/alerts/:id/review', async (req, res) => {
    const action = ReviewActionSchema.safeParse(req.body)
    if (!action.success) reject('INVALID_REVIEW', 422, 'Invalid review action.')
    const pairs = await scopedPairs(req)
    const stored = (await eventsFor(pairs)).find((row) => row.event_id === req.params.id &&
      row.event.isSimulated === (req.query.workspace === 'demo'))
    if (!stored) reject('EVENT_NOT_FOUND', 404, 'This event is unavailable for review.')
    const event = applyReviewAction(stored.event, action.data, new Date().toISOString())
    const updated = await db<WatchEvent[]>('gg_watch_events', {
      device_id: `eq.${stored.device_id}`, event_id: `eq.${stored.event_id}`, version: `eq.${stored.version}`,
    }, 'PATCH', { event, version: stored.version + 1 })
    if (!updated.length) reject('REVIEW_CHANGED', 409, 'The review changed. Refresh and try again.')
    res.json({ event })
  })

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This action is unavailable on the hosted console.' } }))
  app.use((err: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ActionError) res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } })
    else if (err instanceof SyntaxError) res.status(400).json({ error: { code: 'BAD_JSON', message: 'Invalid JSON body.' } })
    else res.status(503).json({ error: { code: 'HOSTED_API_UNAVAILABLE', message: 'The hosted console could not complete this request.' } })
  })
  return app
}
