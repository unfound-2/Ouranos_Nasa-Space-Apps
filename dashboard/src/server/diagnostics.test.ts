/**
 * Watch-integration diagnostics: GET /api/v1/integration/checks and POST /api/v1/integration/selftest.
 * All data here is synthetic test data in temporary directories; ids and labels start with e2e-.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { NetworkInterfaceInfo } from 'node:os'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDataset } from '../shared/dataset'
import { createApp, type CreateAppOptions, type MissionComputer } from './app'
import { watchSession } from './test-records'

const TOKEN = 'test-device-token-0123456789abcdef'
const AUTH = `Bearer ${TOKEN}`
const LAN_IP = '192.0.2.10' // TEST-NET-1: never a real host
const CHECK_IDS = [
  'backend',
  'lan-enabled',
  'network-interface',
  'pairing',
  'lan-reachable',
  'device-ingest',
  'record-persisted',
  'dashboard-display',
  'watch-confirmation',
]

let clock: Date
const dirs: string[] = []
const running: MissionComputer[] = []
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gg-diag-test-'))
  dirs.push(d)
  return d
}

const iface = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:5e:00:53:01',
  internal: false,
  cidr: `${address}/24`,
})
const withLanIp = () => ({ lo0: [{ ...iface('127.0.0.1'), internal: true }], en0: [iface(LAN_IP)] })
const noLanIp = () => ({ lo0: [{ ...iface('127.0.0.1'), internal: true }] })

type Seen = { method: string; url: string; body: string }

/** Sends requests meant for the fake LAN address to this machine's loopback, and records every answer. */
function loopbackFetch(seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    const res = await fetch(url.replace(`//${LAN_IP}:`, '//127.0.0.1:'), init)
    const body = await res.clone().text()
    seen.push({ method: init?.method ?? 'GET', url, body })
    return res
  }
}

function start(extra: Partial<CreateAppOptions> = {}): MissionComputer & { dataDir: string } {
  const dataDir = tempDir()
  const mc = createApp({ dataDir, token: TOKEN, now: () => clock, maintenanceIntervalMs: 0, networkInterfaces: noLanIp, ...extra })
  running.push(mc)
  return { ...mc, dataDir }
}

beforeEach(() => {
  clock = new Date('2026-11-14T19:40:00.000Z')
})
afterEach(async () => {
  for (const mc of running.splice(0)) await mc.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

type App = MissionComputer['app']
type Check = { id: string; status: string; detail: string; evidence: string | null; at: string | null; recordId?: string | null; recordKind?: string | null; clientCheck?: boolean }
const checks = async (app: App) => (await request(app).get('/api/v1/integration/checks').expect(200)).body
const byId = (body: { checks: Check[] }) => Object.fromEntries(body.checks.map((c) => [c.id, c])) as Record<string, Check>

/** Pair the way the watch app and the dashboard do: code from the watch, redeemed on the dashboard. */
async function pairWatch(app: App) {
  const created = await request(app).post('/api/pairing').expect(201)
  const { code, watchToken } = created.body as { code: string; watchToken: string }
  const redeemed = await request(app).post('/api/pairing/redeem').send({ code }).expect(200)
  const { deviceId, adapterToken } = redeemed.body as { deviceId: string; adapterToken: string }
  return { code, watchToken, adapterToken, deviceId, bearer: `Bearer ${watchToken}` }
}

const SIGNAL_ID = '00000000-0000-4000-8000-0000000000e2'
function signal(simulated: boolean, id = SIGNAL_ID) {
  const at = clock.getTime() / 1000
  return {
    id,
    createdAt: at,
    frame: {
      version: 1,
      source: simulated ? 'e2e-simulated-feed' : 'e2e-synthetic-feed',
      observedAt: at,
      simulated,
      readings: [{ metric: 'e2e-heart-rate', value: 131, unit: 'bpm', quality: 'valid', status: 'priority' }],
    },
    evidence: ['e2e-heart-rate'],
    action: 'e2e synthetic test signal: verify the reading with the source instrument.',
  }
}

const notTested = (body: { checks: Check[] }, ids: string[]) => {
  const c = byId(body)
  for (const id of ids) expect(c[id].status, id).toBe('NOT_TESTED')
}

describe('a paired watch app is recorded honestly', () => {
  it('stores the code-paired watch app without claiming it is Apple Watch hardware', async () => {
    const { app } = start()
    const w = await pairWatch(app)
    expect((await request(app).get('/api/device').set('Authorization', w.bearer).expect(200)).body).toEqual({ paired: true })
    const devices = (await request(app).get('/api/v1/devices').expect(200)).body.devices
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ deviceId: w.deviceId, deviceModel: 'GRAVITYGUARD watch app (code-paired)', isSimulated: false, linkState: 'VERIFIED' })
    const snapshot = JSON.stringify((await request(app).get('/api/v1/snapshot').expect(200)).body)
    expect(snapshot).not.toContain('Apple Watch')
  })
})

describe('GET /api/v1/integration/checks', () => {
  it('lists the nine checks in order with the documented shape, and nothing passes on a fresh computer', async () => {
    const { app } = start()
    const body = await checks(app)
    expect(Object.keys(body).sort()).toEqual(['checks', 'generatedAt', 'lan', 'watch'])
    expect(body.generatedAt).toBe('2026-11-14T19:40:00.000Z')
    expect(body.checks.map((c: Check) => c.id)).toEqual(CHECK_IDS)
    for (const c of body.checks as Check[]) {
      expect(['PASS', 'FAIL', 'NOT_TESTED'], c.id).toContain(c.status)
      expect(typeof c.detail, c.id).toBe('string')
      expect(c, c.id).toHaveProperty('label')
      expect(c, c.id).toHaveProperty('evidence')
      expect(c, c.id).toHaveProperty('at')
    }
    const c = byId(body)
    expect(c.backend.status).toBe('PASS')
    expect(c.backend.detail).toMatch(/0\.1\.0/)
    expect(c.backend.detail).toMatch(/writable/)
    expect(c['device-ingest']).toMatchObject({ status: 'NOT_TESTED', recordId: null, recordKind: null })
    expect(c['dashboard-display']).toMatchObject({ status: 'NOT_TESTED', clientCheck: true })
    notTested(body, ['pairing', 'device-ingest', 'record-persisted', 'dashboard-display', 'watch-confirmation'])
    expect(body.watch).toEqual({ paired: false, deviceId: null, lastSeenAt: null, frame: null })
  })

  it('with the LAN off: says how to turn it on and does not probe', async () => {
    let probes = 0
    const { app } = start({ networkInterfaces: withLanIp, fetch: async () => (probes++, new Response('{}')) })
    const body = await checks(app)
    const c = byId(body)
    expect(c['lan-enabled'].status).toBe('FAIL')
    expect(c['lan-enabled'].detail).toContain('GG_LAN=1 npm start')
    expect(c['network-interface']).toMatchObject({ status: 'PASS' })
    expect(c['network-interface'].detail).toContain(`en0 ${LAN_IP}`)
    expect(c['lan-reachable'].status).toBe('NOT_TESTED')
    expect(probes).toBe(0)
    expect(body.lan).toMatchObject({ enabled: false, bind: '127.0.0.1' })
    expect(body.lan.addresses).toEqual([{ interface: 'en0', address: LAN_IP, url: `http://${LAN_IP}:${body.lan.port}` }])
  })

  it('fails the interface check when this computer has no local-network address', async () => {
    const { app } = start({ networkInterfaces: noLanIp })
    expect(byId(await checks(app))['network-interface'].status).toBe('FAIL')
  })

  it('with the LAN on: probes its own LAN address and says what that does and does not prove', async () => {
    const seen: Seen[] = []
    const { app } = start({ lan: true, networkInterfaces: withLanIp, fetch: loopbackFetch(seen) })
    const body = await checks(app)
    const c = byId(body)
    expect(c['lan-enabled'].status).toBe('PASS')
    expect(body.lan).toMatchObject({ enabled: true, bind: '0.0.0.0' })
    expect(c['lan-reachable'].status).toBe('PASS')
    expect(seen.map((s) => s.url)).toEqual([`http://${LAN_IP}:${body.lan.port}/api/v1/health`])
    expect(c['lan-reachable'].detail).toMatch(/from this computer/)
    expect(c['lan-reachable'].detail).toMatch(/not that the watch can reach it/)
  })

  it('with the LAN on: fails the reachability check when its own LAN address does not answer', async () => {
    const { app } = start({ lan: true, networkInterfaces: withLanIp, fetch: async () => Promise.reject(new Error('connect EHOSTUNREACH')) })
    const failed = byId(await checks(app))['lan-reachable']
    expect(failed.status).toBe('FAIL')
    expect(failed.detail).toMatch(/EHOSTUNREACH/)
    expect(failed.detail).toMatch(/not that the watch can reach it/)
  })

  it('passes pairing, device-ingest, record-persisted and watch-confirmation after a real-shaped signal from a code-paired watch', async () => {
    const { app } = start()
    const w = await pairWatch(app)
    await request(app).get('/api/device').set('Authorization', w.bearer).expect(200)
    advance(5)
    await request(app).post('/api/signals').set('Authorization', w.bearer).send(signal(false)).expect(202)
    const body = await checks(app)
    const c = byId(body)
    expect(c.pairing).toMatchObject({ status: 'PASS', evidence: w.deviceId })
    expect(c['device-ingest']).toMatchObject({ status: 'PASS', recordId: SIGNAL_ID, recordKind: 'EVENT', at: '2026-11-14T19:40:05.000Z' })
    expect(c['device-ingest'].detail).toContain(w.deviceId)
    expect(c['record-persisted']).toMatchObject({ status: 'PASS', recordId: SIGNAL_ID, recordKind: 'EVENT' })
    expect(c['watch-confirmation']).toMatchObject({ status: 'PASS', recordId: SIGNAL_ID, recordKind: 'EVENT' })
    expect(c['watch-confirmation'].detail).toContain(SIGNAL_ID)
    expect(c['dashboard-display']).toMatchObject({ status: 'NOT_TESTED', clientCheck: true })
    expect(body.watch).toMatchObject({ paired: true, deviceId: w.deviceId, lastSeenAt: '2026-11-14T19:40:00.000Z' })
    // No part of any token is ever shown.
    const text = JSON.stringify(body)
    for (const secret of [w.watchToken, w.adapterToken, TOKEN]) {
      expect(text).not.toContain(secret)
      expect(text).not.toContain(secret.slice(0, 8))
    }
  })

  it('reports the latest watch frame by metric name and time only', async () => {
    const { app } = start()
    const w = await pairWatch(app)
    const frame = { ...signal(false).frame, source: 'e2e-watch-sensors', readings: [{ metric: 'e2e-wrist-motion', value: 0.02, unit: 'g', quality: 'valid', status: 'nominal' }] }
    await request(app).post('/api/watch').set('Authorization', w.bearer).send(frame).expect(202)
    const body = await checks(app)
    expect(body.watch.frame).toEqual({ observedAt: '2026-11-14T19:40:00.000Z', metrics: ['e2e-wrist-motion'], simulated: false })
    expect(JSON.stringify(body.watch)).not.toContain('0.02')
  })

  it('never passes on simulated or demo data', async () => {
    const { app } = start()
    const w = await pairWatch(app)
    await request(app).post('/api/signals').set('Authorization', w.bearer).send(signal(true)).expect(202)
    await request(app).post('/api/v1/demo/trigger').send({}).expect(201)
    await request(app).post('/api/v1/sessions').set('Authorization', AUTH).send(watchSession({ sessionId: 'e2e-sim-session', simulated: true })).expect(201)
    const body = await checks(app)
    notTested(body, ['device-ingest', 'record-persisted', 'watch-confirmation'])
    // The paired watch app itself is real; only its records were simulated.
    expect(byId(body).pairing.status).toBe('PASS')
  })

  it('counts a session sent over the v1 device API as device ingest', async () => {
    const { app } = start()
    await request(app).post('/api/v1/sessions').set('Authorization', AUTH).send(watchSession({ sessionId: 'e2e-session-1' })).expect(201)
    const c = byId(await checks(app))
    expect(c['device-ingest']).toMatchObject({ status: 'PASS', recordId: 'e2e-session-1', recordKind: 'SESSION' })
    expect(c['device-ingest'].detail).toMatch(/v1 device API/)
    expect(c['record-persisted']).toMatchObject({ status: 'PASS', recordId: 'e2e-session-1', recordKind: 'SESSION' })
    expect(c['watch-confirmation'].status).toBe('NOT_TESTED')
  })

  it('reads the record back from disk: a record missing from mission.json fails', async () => {
    const { app, dataDir } = start()
    const w = await pairWatch(app)
    await request(app).post('/api/signals').set('Authorization', w.bearer).send(signal(false)).expect(202)
    expect(JSON.parse(readFileSync(path.join(dataDir, 'mission.json'), 'utf8')).events).toHaveProperty(SIGNAL_ID)
    writeFileSync(path.join(dataDir, 'mission.json'), JSON.stringify(emptyDataset('mission')))
    const c = byId(await checks(app))
    expect(c['device-ingest'].status).toBe('PASS')
    expect(c['record-persisted']).toMatchObject({ status: 'FAIL', recordId: null, recordKind: null })
  })

  it('is only for the dashboard on this computer', async () => {
    const { app } = start()
    expect((await request(app).get('/api/v1/integration/checks').set('Authorization', AUTH).expect(403)).body.error.code).toBe('LOCAL_USER_ONLY')
    await request(app).post('/api/v1/integration/selftest').set('Authorization', AUTH).send({}).expect(403)
    const lan = start({ clientAddress: () => '192.168.1.50' })
    await request(lan.app).get('/api/v1/integration/checks').expect(401)
  })
})

describe('POST /api/v1/integration/selftest', () => {
  it('runs pairing, redeem, a simulated signal and unpairing over real HTTP, into the demo workspace only', async () => {
    const seen: Seen[] = []
    const { app } = start({ fetch: loopbackFetch(seen) })
    const res = await request(app).post('/api/v1/integration/selftest').send({}).expect(200)
    const body = res.body
    expect(body).toMatchObject({ simulated: true, passed: true })
    expect(body.summary).toMatch(/simulated self-test/i)
    expect(body.summary).toMatch(/not proof that a watch/i)
    expect(body.steps.map((s: { method: string; path: string; status: number; ok: boolean }) => [s.method, s.path, s.status, s.ok])).toEqual([
      ['POST', '/api/pairing', 201, true],
      ['POST', '/api/pairing/redeem', 200, true],
      ['POST', '/api/signals', 202, true],
      ['DELETE', '/api/device', 200, true],
    ])
    expect(seen.filter((s) => s.url.endsWith('/api/device')).map((s) => s.method)).toEqual(['DELETE'])
    expect(body.target.watchBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const demo = (await request(app).get('/api/v1/snapshot?workspace=demo').expect(200)).body.dataset
    const mission = (await request(app).get('/api/v1/snapshot').expect(200)).body.dataset
    expect(demo.events[body.demoEventId]).toMatchObject({ isSimulated: true })
    expect(mission.events).toEqual({})
    // GET /api/device was never called, so no heartbeat reached the mission records.
    expect(mission.devices).toEqual({})

    // No token from the run is in the answer.
    const tokens = seen.flatMap((s) => [...s.body.matchAll(/"(?:watchToken|adapterToken)":"([^"]+)"/g)].map((m) => m[1]))
    expect(tokens.length).toBeGreaterThanOrEqual(2)
    const text = JSON.stringify(body)
    for (const t of tokens) {
      expect(text).not.toContain(t)
      expect(text).not.toContain(t.slice(0, 8))
    }

    // The self-test changes no check.
    const after = await checks(app)
    notTested(after, ['pairing', 'device-ingest', 'record-persisted', 'dashboard-display', 'watch-confirmation'])
    expect(after.watch.paired).toBe(false)
  })

  it('uses the LAN address for the watch-side calls when the LAN is on, and loopback for the dashboard-side redeem', async () => {
    const seen: Seen[] = []
    const { app } = start({ lan: true, networkInterfaces: withLanIp, fetch: loopbackFetch(seen) })
    const body = (await request(app).post('/api/v1/integration/selftest').send({}).expect(200)).body
    expect(body.passed).toBe(true)
    const urls = body.steps.map((s: { url: string }) => s.url)
    expect(urls[0]).toMatch(new RegExp(`^http://${LAN_IP.replace(/\./g, '\\.')}:\\d+/api/pairing$`))
    expect(urls[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/pairing\/redeem$/)
    expect(urls[2]).toMatch(new RegExp(`^http://${LAN_IP.replace(/\./g, '\\.')}:\\d+/api/signals$`))
    expect(urls[3]).toMatch(new RegExp(`^http://${LAN_IP.replace(/\./g, '\\.')}:\\d+/api/device$`))
    notTested(await checks(app), ['pairing', 'device-ingest', 'record-persisted', 'watch-confirmation'])
  })

  it('reports failed steps without throwing when its own endpoints cannot be reached', async () => {
    const { app } = start({ fetch: async () => Promise.reject(new Error('connect ECONNREFUSED')) })
    const body = (await request(app).post('/api/v1/integration/selftest').send({}).expect(200)).body
    expect(body).toMatchObject({ simulated: true, passed: false, demoEventId: null })
    expect(body.steps[0]).toMatchObject({ method: 'POST', path: '/api/pairing', status: null, ok: false })
    expect(body.steps[0].detail).toMatch(/ECONNREFUSED/)
  })

  it('never counts the self-test pairing, even while the self-test is running', async () => {
    let during: Check | null = null
    let appRef: App | null = null
    const inner = loopbackFetch()
    const { app } = start({
      fetch: async (input, init) => {
        const res = await inner(input, init)
        if (String(input).endsWith('/api/signals') && appRef) during = byId(await checks(appRef)).pairing
        return res
      },
    })
    appRef = app
    await request(app).post('/api/v1/integration/selftest').send({}).expect(200)
    expect(during).not.toBeNull()
    expect(during!.status).toBe('NOT_TESTED')
  })
})

function advance(seconds: number) {
  clock = new Date(clock.getTime() + seconds * 1000)
}
