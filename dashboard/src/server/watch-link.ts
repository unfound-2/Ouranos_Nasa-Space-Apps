import { randomBytes, randomUUID } from 'node:crypto'
import express, { type Request, type RequestHandler } from 'express'
import { WatchFrameSchema, WatchSignalSchema, type WatchFrame, type WatchSignal } from '../shared/watch-link'
import { DaySchema, PlanActionSchema, actOnPlan, type DayPlan } from '../shared/daily-plan'
import { HttpError } from './errors'

const token = () => randomBytes(32).toString('base64url')
const codeLifetime = 5 * 60 * 1000
const sessionLifetime = 12 * 60 * 60 * 1000

interface Pairing {
  code: string | null
  watchToken: string
  adapterToken: string | null
  codeExpires: number
  expires: number
  deviceId: string
  lastSeen: number | null
  watch: WatchFrame | null
  telemetry: Map<string, WatchFrame>
  /** When the code was redeemed on the console. */
  plan?: DayPlan
  pairedAt: number | null
}

/** What the diagnostics may know about pairings: never a code or a token. */
export interface WatchLinkStatus {
  /** Codes issued and not yet entered on the console. */
  pendingCodes: number
  paired: {
    deviceId: string
    pairedAt: string | null
    /** Last recorded contact (GET /api/device, recorded at most every 20 s). */
    lastSeenAt: string | null
    /** The latest frame the watch shared with POST /api/watch. */
    frame: { observedAt: string; metrics: string[]; simulated: boolean } | null
  }[]
}

interface Options {
  now: () => Date
  localUser: RequestHandler
  onHeartbeat(deviceId: string, now: string): Promise<unknown>
  onSignal(signal: WatchSignal, deviceId: string, now: string): Promise<unknown>
}

export function createWatchLink({ now, localUser, onHeartbeat, onSignal }: Options) {
  const router = express.Router()
  const pairings = new Set<Pairing>()
  const json = express.json({ limit: '64kb' })

  function active() {
    const time = now().getTime()
    for (const p of pairings) {
      if (p.expires <= time || (p.code !== null && p.codeExpires <= time)) pairings.delete(p)
    }
    return [...pairings]
  }

  function authorize(req: Request, role: 'watchToken' | 'adapterToken', requirePaired = true) {
    const credential = req.headers.authorization
    const p = active().find((p) => p[role] !== null && credential === 'Bearer ' + p[role])
    if (!p || (requirePaired && p.code !== null)) {
      throw new HttpError(401, 'PAIRING_REQUIRED', 'Pair with Crew Console first.')
    }
    return p
  }

  function fresh(frame: WatchFrame) {
    const age = now().getTime() / 1000 - frame.observedAt
    return age >= -5 && age <= (frame.freshnessSeconds ?? 15)
  }

  router.post('/pairing', (req, res) => {
    if (active().length >= 256) throw new HttpError(503, 'PAIRING_CAPACITY', 'Pairing capacity reached.')
    const time = now().getTime()
    const p: Pairing = {
      code: randomBytes(5).toString('hex').toUpperCase(),
      watchToken: token(), adapterToken: null, codeExpires: time + codeLifetime,
      expires: time + codeLifetime + sessionLifetime, deviceId: 'watch-' + randomUUID(),
      lastSeen: null, watch: null, telemetry: new Map(), pairedAt: null,
    }
    pairings.add(p)
    const port = req.socket.localPort
    const consoleURL = port ? `http://127.0.0.1:${port}/` : undefined
    res.status(201).json({ code: p.code, watchToken: p.watchToken, codeExpiresAt: p.codeExpires / 1000, consoleURL })
  })

  router.post('/pairing/redeem', localUser, json, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.toUpperCase().replace(/[\s-]/g, '') : ''
    const p = active().find((p) => p.code === code)
    if (!p) {
      throw new HttpError(404, 'PAIRING_CODE_INVALID',
        'This console could not use that code. Check the console address on the watch and tap Get a new code.')
    }
    p.code = null
    p.adapterToken = token()
    p.expires = now().getTime() + sessionLifetime
    p.pairedAt = now().getTime()
    res.json({ deviceId: p.deviceId, adapterToken: p.adapterToken })
  })

  router.get('/watch-links', localUser, (_req, res) => {
    res.json(active().filter((p) => p.code === null).map((p) => ({
      deviceId: p.deviceId, watch: p.watch, telemetry: [...p.telemetry.values()].filter(fresh),
    })))
  })

  // Local-console access uses the existing LOCAL_USER guard; watches use their pairing token.
  router.get('/planner/:deviceId', localUser, (req, res) => {
    const p = active().find(p => p.deviceId === req.params.deviceId && p.code === null)
    if (!p) throw new HttpError(404, 'PAIRING_REQUIRED', 'This watch is no longer paired.')
    res.json(p.plan ?? null)
  })
  router.post('/planner/:deviceId', localUser, json, (req, res) => {
    const p = active().find(p => p.deviceId === req.params.deviceId && p.code === null)
    if (!p) throw new HttpError(404, 'PAIRING_REQUIRED', 'This watch is no longer paired.')
    const result = DaySchema.safeParse(req.body?.plan)
    if (!result.success || result.data.simulated) throw new HttpError(422, 'INVALID_PLAN', 'A valid mission plan is required.')
    if (req.body.expectedRevision !== (p.plan?.revision ?? 0)) throw new HttpError(409, 'PLAN_CHANGED', 'The watch updated this plan. Refresh before saving.')
    p.plan = { ...result.data, revision: (p.plan?.revision ?? 0) + 1, updatedAt: now().toISOString() }
    res.json(p.plan)
  })
  router.get('/planner', (req, res) => {
    res.json(authorize(req, 'watchToken').plan ?? null)
  })
  router.post('/planner-action', json, (req, res) => {
    const p = authorize(req, 'watchToken')
    const parsed = PlanActionSchema.safeParse(req.body?.action)
    if (!p.plan || !parsed.success) throw new HttpError(422, 'INVALID_ACTION', 'Open a daily plan on the console first.')
    if (req.body.expectedRevision !== p.plan.revision) throw new HttpError(409, 'PLAN_CHANGED', 'Refresh the plan before retrying.')
    try { p.plan = actOnPlan(p.plan, parsed.data) } catch (e) { throw new HttpError(422, 'INVALID_ACTION', (e as Error).message) }
    res.json(p.plan)
  })

  router.get('/device', async (req, res) => {
    const p = authorize(req, 'watchToken', false)
    const paired = p.code === null
    const time = now()
    if (paired && (p.lastSeen === null || time.getTime() - p.lastSeen >= 20_000)) {
      await onHeartbeat(p.deviceId, time.toISOString())
      p.lastSeen = time.getTime()
    }
    res.json({ paired })
  })

  router.delete('/device', (req, res) => {
    pairings.delete(authorize(req, 'watchToken', false))
    res.json({ removed: true })
  })

  router.post('/telemetry', json, (req, res) => {
    const p = authorize(req, 'adapterToken')
    const result = WatchFrameSchema.safeParse(req.body)
    if (!result.success || result.data.simulated || !fresh(result.data)) {
      throw new HttpError(422, 'INVALID_FRAME', 'Expected a fresh instrument telemetry frame.')
    }
    const frame = result.data
    const last = p.telemetry.get(frame.source)
    if (last && frame.observedAt <= last.observedAt) {
      throw new HttpError(409, 'STALE_FRAME', 'Frame already superseded.')
    }
    if (!last && p.telemetry.size >= 12) throw new HttpError(422, 'SOURCE_LIMIT', 'Source limit reached.')
    p.telemetry.set(frame.source, frame)
    res.status(202).json({ accepted: true })
  })

  router.get('/telemetry', (req, res) => {
    res.json([...authorize(req, 'watchToken').telemetry.values()].filter(fresh))
  })

  router.post('/watch', json, (req, res) => {
    const p = authorize(req, 'watchToken')
    const result = WatchFrameSchema.safeParse(req.body)
    if (!result.success || !fresh(result.data)) throw new HttpError(422, 'INVALID_FRAME', 'Expected a fresh watch frame.')
    p.watch = result.data
    res.status(202).json({ accepted: true })
  })

  router.delete('/watch', (req, res) => {
    authorize(req, 'watchToken').watch = null
    res.json({ removed: true })
  })

  router.post('/signals', json, async (req, res) => {
    const p = authorize(req, 'watchToken')
    const result = WatchSignalSchema.safeParse(req.body)
    if (!result.success) throw new HttpError(422, 'INVALID_SIGNAL', 'Invalid watch review signal.')
    await onSignal(result.data, p.deviceId, now().toISOString())
    res.status(202).json({ accepted: true })
  })

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())

  /** Pairing state for diagnostics. Never includes a code or a token. */
  function status(): WatchLinkStatus {
    const list = active()
    return {
      pendingCodes: list.filter((p) => p.code !== null).length,
      paired: list
        .filter((p) => p.code === null)
        .map((p) => ({
          deviceId: p.deviceId,
          pairedAt: iso(p.pairedAt),
          lastSeenAt: iso(p.lastSeen),
          frame: p.watch
            ? { observedAt: new Date(p.watch.observedAt * 1000).toISOString(), metrics: p.watch.readings.map((r) => r.metric), simulated: p.watch.simulated }
            : null,
        })),
    }
  }

  // Still usable as a router exactly as before; status() is an addition.
  return Object.assign(router, { status })
}
