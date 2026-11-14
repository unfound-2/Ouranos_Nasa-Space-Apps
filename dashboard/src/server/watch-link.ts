import { randomBytes, randomUUID } from 'node:crypto'
import express, { type Request, type RequestHandler } from 'express'
import { WatchFrameSchema, WatchSignalSchema, type WatchFrame, type WatchSignal } from '../shared/watch-link'
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
      lastSeen: null, watch: null, telemetry: new Map(),
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
    res.json({ deviceId: p.deviceId, adapterToken: p.adapterToken })
  })

  router.get('/watch-links', localUser, (_req, res) => {
    res.json(active().filter((p) => p.code === null).map((p) => ({
      deviceId: p.deviceId, watch: p.watch, telemetry: [...p.telemetry.values()].filter(fresh),
    })))
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

  return router
}
