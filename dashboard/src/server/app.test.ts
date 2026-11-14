import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REVIEW_CHECKLIST } from '../shared/dataset'
import { createApp, type CreateAppOptions, type MissionComputer } from './app'
import { writeFileAtomic } from './store'
import { cuffReading, heartbeat, watchBundle, watchEvent, watchSession } from './test-records'

const TOKEN = 'test-device-token-0123456789abcdef'
const AUTH = `Bearer ${TOKEN}`
const ALL_ITEMS = REVIEW_CHECKLIST.items.map((i) => i.id)

let clock: Date
const iso = () => clock.toISOString()
const advance = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000)
}

const dirs: string[] = []
const running: MissionComputer[] = []
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gg-api-test-'))
  dirs.push(d)
  return d
}
function start(dataDir = tempDir(), extra: Partial<CreateAppOptions> = {}): MissionComputer & { dataDir: string } {
  const mc = createApp({ dataDir, token: TOKEN, now: () => clock, maintenanceIntervalMs: 0, ...extra })
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
/** As the watch app: with the device token. */
const asDevice = {
  get: (app: App, url: string) => request(app).get(url).set('Authorization', AUTH),
  post: (app: App, url: string, body: unknown) => request(app).post(url).set('Authorization', AUTH).send(body as object),
}
/** As the dashboard on this computer: loopback, no token. */
const asLocal = {
  get: (app: App, url: string) => request(app).get(url),
  post: (app: App, url: string, body: unknown) => request(app).post(url).send(body as object),
}

const fileBytes = (dir: string, name: string) => readFileSync(path.join(dir, name))

describe('1. health', () => {
  it('reports record counts per workspace, storage and network, with no token needed', async () => {
    const { app, dataDir } = start()
    const res = await request(app).get('/api/v1/health').expect(200)
    expect(res.body).toMatchObject({
      ok: true,
      service: 'gravityguard-mission-computer',
      version: '0.1.0',
      contractVersion: 'v1',
      time: '2026-11-14T19:40:00.000Z',
      uptimeSeconds: 0,
      storage: { dataDir, writable: true },
      network: { bind: '127.0.0.1', lan: false },
    })
    expect(res.body.workspaces.mission).toEqual({ sessions: 0, events: 0, readings: 0, devices: 0 })
    expect(res.body.workspaces.demo).toEqual({ sessions: 7, events: 4, readings: 2, devices: 2 })

    await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(201)
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    advance(30)
    const after = await request(app).get('/api/v1/health').set('Authorization', 'Bearer not-the-token-at-all').expect(200)
    expect(after.body.workspaces.mission).toEqual({ sessions: 1, events: 1, readings: 0, devices: 1 })
    expect(after.body.uptimeSeconds).toBe(30)
    expect(JSON.stringify(after.body)).not.toContain('measurements')
  })
})

describe('2. persistence', () => {
  it('keeps a session sent by the watch across a restart, with a missing heart rate still null', async () => {
    const first = start()
    const s = watchSession({ sessionId: 'ses-persist' })
    expect(s.measurements[2]).not.toHaveProperty('value')
    const res = await asDevice.post(first.app, '/api/v1/sessions', s).expect(201)
    expect(res.body.result).toEqual({ kind: 'SESSION', id: 'ses-persist', workspace: 'mission', outcome: 'CREATED', detail: null })
    await first.close()

    const second = start(first.dataDir)
    const got = await asLocal.get(second.app, '/api/v1/sessions/ses-persist').expect(200)
    const m3 = got.body.session.measurements.find((m: { measurementId: string }) => m.measurementId === 'ses-persist-m3')
    expect(m3.value).toBeNull()
    expect(m3.value).not.toBe(0)
    expect(m3.quality).toBe('MISSING')
    expect(got.body.session.provenance).toMatchObject({ origin: 'WATCH_APP', ingestPath: 'LIVE_SYNC', receivedAt: '2026-11-14T19:40:00.000Z' })
    const onDisk = JSON.parse(fileBytes(first.dataDir, 'mission.json').toString('utf8'))
    expect(onDisk.sessions['ses-persist'].measurements[2].value).toBeNull()
  })
})

describe('3. validation', () => {
  it('rejects a timestamp that is not UTC ISO-8601 with 422 naming the field', async () => {
    const { app } = start()
    const res = await asDevice.post(app, '/api/v1/sessions', watchSession({}, { startedAt: '2026-11-14 19:30:00' })).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.details).toContain('startedAt: must be a UTC ISO-8601 timestamp such as 2026-11-14T19:30:05Z')
    expect(res.body.result.outcome).toBe('REJECTED')
  })

  it('rejects a heart rate recorded in mmHg with 422 naming the reading', async () => {
    const { app } = start()
    const s = watchSession()
    s.measurements[0].unit = 'mmHg'
    const res = await asDevice.post(app, '/api/v1/sessions', s).expect(422)
    expect(res.body.error.details).toContain('measurements.0.unit: unit for HEART_RATE must be "bpm", got "mmHg"')
    const health = await request(app).get('/api/v1/health').expect(200)
    expect(health.body.workspaces.mission.sessions).toBe(0)
  })

  it('rejects a misspelled key, the wrong record type and a non-object body', async () => {
    const { app } = start()
    const typo = await asDevice.post(app, '/api/v1/sessions', { ...watchSession(), started_at: 'x' }).expect(422)
    expect(typo.body.error.details.join(' ')).toMatch(/unknown field\(s\) started_at/)
    const wrongType = await asDevice.post(app, '/api/v1/sessions', watchEvent()).expect(422)
    expect(wrongType.body.error.code).toBe('WRONG_RECORD_TYPE')
    await asDevice.post(app, '/api/v1/alerts', [watchEvent()]).expect(422)
  })

  it('answers malformed JSON with 400', async () => {
    const { app } = start()
    const res = await request(app).post('/api/v1/sessions').set('Authorization', AUTH).set('Content-Type', 'application/json').send('{"schemaVersion": ').expect(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })
})

describe('4. idempotent re-sends', () => {
  it('reports a re-sent identical event as DUPLICATE and keeps one copy', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    advance(5)
    const again = await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(200)
    expect(again.body.result.outcome).toBe('DUPLICATE')
    const list = await asLocal.get(app, '/api/v1/alerts').expect(200)
    expect(list.body.events.map((e: { eventId: string }) => e.eventId)).toEqual(['evt-1'])
  })

  it('applies a later copy that adds the acknowledgement, then ignores the older copy', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    const acked = watchEvent({ status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH' } })
    expect((await asDevice.post(app, '/api/v1/alerts', acked).expect(200)).body.result.outcome).toBe('UPDATED')
    expect((await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(200)).body.result.outcome).toBe('STALE_IGNORED')
    const got = await asLocal.get(app, '/api/v1/alerts/evt-1').expect(200)
    expect(got.body.event.status).toBe('ACKNOWLEDGED')
  })

  it('refuses a re-sent event whose content changed with 409', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    const res = await asDevice.post(app, '/api/v1/alerts', watchEvent({ severity: 'PRIORITY_REVIEW' })).expect(409)
    expect(res.body.error.code).toBe('CONFLICT')
    expect(res.body.result.outcome).toBe('CONFLICT')
  })
})

describe('5. simulated records stay simulated', () => {
  it('stores a simulated session in demo and refuses to relabel it as real', async () => {
    const { app } = start()
    const sim = await asDevice.post(app, '/api/v1/sessions', watchSession({ sessionId: 'ses-sim-1', simulated: true })).expect(201)
    expect(sim.body.result.workspace).toBe('demo')
    const demo = await asLocal.get(app, '/api/v1/sessions?workspace=demo').expect(200)
    expect(demo.body.sessions.map((s: { sessionId: string }) => s.sessionId)).toContain('ses-sim-1')
    expect((await asLocal.get(app, '/api/v1/sessions').expect(200)).body.sessions).toEqual([])

    const relabel = await asDevice.post(app, '/api/v1/sessions', watchSession({ sessionId: 'ses-sim-1', simulated: false })).expect(409)
    expect(relabel.body.result.outcome).toBe('CONFLICT')
    expect(relabel.body.error.message).toMatch(/simulated record cannot become real/)
    expect((await asLocal.get(app, '/api/v1/sessions').expect(200)).body.sessions).toEqual([])
    const kept = await asLocal.get(app, '/api/v1/sessions/ses-sim-1?workspace=demo').expect(200)
    expect(kept.body.session.isSimulated).toBe(true)
  })
})

describe('6. watch acknowledgement', () => {
  it('records a device acknowledgement of a presented event and refreshes the watch link', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    advance(20)
    const res = await asDevice.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:32:30Z' }).expect(200)
    expect(res.body.event.status).toBe('ACKNOWLEDGED')
    expect(res.body.event.acknowledgement).toEqual({ acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-1' })
    // The watch gets the delivery and acknowledgement state back, never the review.
    expect(res.body.event).not.toHaveProperty('review')
    const devices = await asLocal.get(app, '/api/v1/devices').expect(200)
    expect(devices.body.devices[0]).toMatchObject({ deviceId: 'watch-1', lastSeenAt: '2026-11-14T19:40:20.000Z', linkState: 'VERIFIED' })
    // Sending the same acknowledgement again is fine; a different one is not.
    await asDevice.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:32:30Z' }).expect(200)
    const changed = await asDevice.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:33:00Z' }).expect(409)
    expect(changed.body.error.code).toBe('ALREADY_ACKNOWLEDGED')
  })

  it('refuses an acknowledgement from the dashboard (no token) with 403', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    const res = await asLocal.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:32:30Z' }).expect(403)
    expect(res.body.error.code).toBe('DEVICE_ONLY')
    expect((await asLocal.get(app, '/api/v1/alerts/evt-1').expect(200)).body.event.acknowledgement).toBeNull()
  })

  it('refuses to acknowledge an alert that never reached an unreachable watch (409)', async () => {
    const { app } = start()
    // A questionable cuff reading typed in on the dashboard; no watch has checked in.
    const manual = await asLocal.post(app, '/api/v1/measurements', { measurements: [cuffReading()] }).expect(201)
    expect(manual.body.results[0]).toMatchObject({ outcome: 'CREATED', workspace: 'mission' })
    expect(manual.body.createdEvents).toEqual(['dq-cuff-1'])
    const event = (await asLocal.get(app, '/api/v1/alerts/dq-cuff-1').expect(200)).body.event
    expect(event).toMatchObject({ category: 'VERIFY_SOURCE', status: 'WATCH_UNREACHABLE' })
    const res = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/ack', { deviceId: 'watch-1', acknowledgedAt: iso() }).expect(409)
    expect(res.body.error.code).toBe('NOT_PRESENTED')
  })

  it('refuses a watch report on a demo-only alert and reports unknown alerts as 404', async () => {
    const { app } = start()
    const res = await asDevice.post(app, '/api/v1/alerts/sim-evt-20261112-a/ack', { deviceId: 'watch-1', acknowledgedAt: iso() }).expect(409)
    expect(res.body.error.code).toBe('SIMULATED_EVENT')
    await asDevice.post(app, '/api/v1/alerts/no-such-alert/ack', { deviceId: 'watch-1', acknowledgedAt: iso() }).expect(404)
    await asDevice.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: 'now' }).expect(422)
  })
})

describe('7. review on the dashboard', () => {
  it('marks reviewed only with every checklist item, keeps the acknowledgement, then closes', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    await asDevice.post(app, '/api/v1/alerts/evt-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:32:30Z' }).expect(200)

    const incomplete = await asLocal
      .post(app, '/api/v1/alerts/evt-1/review', { action: 'MARK_REVIEWED', reviewer: 'Crew medical officer', checkedItems: ALL_ITEMS.slice(1), notes: null })
      .expect(422)
    expect(incomplete.body.error.code).toBe('CHECKLIST_INCOMPLETE')
    const noReviewer = await asLocal.post(app, '/api/v1/alerts/evt-1/review', { action: 'MARK_REVIEWED', reviewer: '  ', checkedItems: ALL_ITEMS }).expect(422)
    expect(noReviewer.body.error.details.join(' ')).toMatch(/reviewer/)

    advance(60)
    const reviewed = await asLocal
      .post(app, '/api/v1/alerts/evt-1/review', { action: 'MARK_REVIEWED', reviewer: 'Crew medical officer', checkedItems: ALL_ITEMS, notes: 'Discussed.' })
      .expect(200)
    expect(reviewed.body.event.status).toBe('REVIEWED')
    expect(reviewed.body.event.acknowledgement).toEqual({ acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-1' })
    expect(reviewed.body.event.review).toMatchObject({ state: 'REVIEWED', reviewer: 'Crew medical officer', reviewedAt: '2026-11-14T19:41:00.000Z' })

    const closed = await asLocal.post(app, '/api/v1/alerts/evt-1/review', { action: 'CLOSE', reviewer: 'Crew medical officer', notes: null }).expect(200)
    expect(closed.body.event.status).toBe('CLOSED')
    expect(closed.body.event.statusHistory.map((h: { status: string }) => h.status)).toEqual(['CREATED', 'DELIVERED', 'ACKNOWLEDGED', 'REVIEWED', 'CLOSED'])
    await asLocal.post(app, '/api/v1/alerts/evt-1/review', { action: 'CLOSE', reviewer: 'Crew medical officer', notes: null }).expect(409)
  })

  it('lists open events before reviewed ones and reviews demo events in the demo workspace', async () => {
    const { app } = start()
    const r = await asLocal
      .post(app, '/api/v1/alerts/sim-evt-20261113-b/review?workspace=demo', { action: 'MARK_REVIEWED', reviewer: 'Demo reviewer', checkedItems: ALL_ITEMS, notes: null })
      .expect(200)
    expect(r.body.event.status).toBe('REVIEWED')
    const list = await asLocal.get(app, '/api/v1/alerts?workspace=demo').expect(200)
    const statuses = list.body.events.map((e: { status: string }) => e.status)
    expect(statuses[statuses.length - 1]).toBe('REVIEWED')
    await asLocal.post(app, '/api/v1/alerts/sim-evt-20261113-b/review', { action: 'CLOSE', reviewer: 'x', notes: null }).expect(404)
  })
})

describe('8. security', () => {
  it('refuses a Host header that is not this computer (DNS rebinding)', async () => {
    const { app } = start()
    const res = await request(app).get('/api/v1/health').set('Host', 'evil.example:4317').expect(403)
    expect(res.body.error.code).toBe('HOST_NOT_ALLOWED')
    await request(app).get('/api/v1/snapshot').set('Host', 'localhost.evil.example').expect(403)
    await request(app).get('/api/v1/health').set('Host', 'localhost:4317').expect(200)
  })

  it('refuses POST bodies that are not application/json with 415 (blocks cross-site form posts)', async () => {
    const { app } = start()
    const plain = await request(app).post('/api/v1/import').set('Content-Type', 'text/plain').send('{"fileName":"x","content":[]}').expect(415)
    expect(plain.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    await request(app).post('/api/v1/demo/reset').type('form').send({ a: '1' }).expect(415)
    await request(app).post('/api/v1/demo/trigger').expect(415)
    await request(app).post('/api/v1/device/heartbeat').set('Authorization', AUTH).set('Content-Type', 'text/plain').send(JSON.stringify(heartbeat())).expect(415)
  })

  it('refuses a wrong bearer token with 401, even from this computer', async () => {
    const { app } = start()
    const res = await request(app).get('/api/v1/snapshot').set('Authorization', 'Bearer wrong-token-wrong-token').expect(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/)
    await request(app).post('/api/v1/sessions').set('Authorization', 'Bearer wrong-token-wrong-token').send(watchSession()).expect(401)
  })

  it('does not let the device token read health records (403)', async () => {
    const { app } = start()
    for (const url of ['/api/v1/snapshot', '/api/v1/sessions', '/api/v1/alerts', '/api/v1/devices', '/api/v1/integration', '/api/v1/sessions/x', '/api/v1/alerts/x']) {
      const res = await asDevice.get(app, url).expect(403)
      expect(res.body.error.code).toBe('LOCAL_USER_ONLY')
    }
    await asDevice.post(app, '/api/v1/demo/reset', {}).expect(403)
    await asDevice.post(app, '/api/v1/import', { fileName: 'x.json', content: [] }).expect(403)
  })

  it('needs the token for requests from another machine', async () => {
    const lanAddress = () => '192.168.1.50'
    const { app } = start(undefined, { clientAddress: lanAddress })
    expect((await request(app).get('/api/v1/snapshot').expect(401)).body.error.code).toBe('UNAUTHORIZED')
    await request(app).post('/api/v1/device/heartbeat').send(heartbeat()).expect(401)
    await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat()).expect(200)
    await asDevice.get(app, '/api/v1/snapshot').expect(403)
    await request(app).get('/api/v1/health').expect(200)
  })

  it('sends no CORS headers and forbids framing', async () => {
    const { app } = start()
    const res = await request(app).get('/api/v1/health').set('Origin', 'http://evil.example').expect(200)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['cache-control']).toBe('no-store')
    const preflight = await request(app).options('/api/v1/import').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'POST')
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers unknown API routes, bad workspaces and prototype-named ids with JSON errors', async () => {
    const { app } = start()
    const missing = await request(app).get('/api/v1/nope').expect(404)
    expect(missing.body.error.code).toBe('NOT_FOUND')
    expect(missing.headers['content-type']).toMatch(/application\/json/)
    await request(app).get('/api/v2/health').expect(404)
    expect((await asLocal.get(app, '/api/v1/sessions?workspace=both').expect(400)).body.error.code).toBe('INVALID_WORKSPACE')
    await asLocal.get(app, '/api/v1/sessions?workspace=demo&workspace=mission').expect(400)
    await asLocal.get(app, '/api/v1/sessions/constructor').expect(404)
    await asLocal.get(app, '/api/v1/alerts/toString').expect(404)
  })
})

describe('9. simulated demo pathway', () => {
  it('reset loads the fixture bundle into demo only; trigger adds a simulated event to demo only', async () => {
    const { app, dataDir } = start()
    await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(201)
    const missionBefore = fileBytes(dataDir, 'mission.json')

    const reset = await asLocal.post(app, '/api/v1/demo/reset', {}).expect(200)
    expect(reset.body).toEqual({ workspace: 'demo', sessions: 7, events: 4, readings: 2, createdEvents: ['dq-sim-b-20261113b'] })

    const trig = await asLocal.post(app, '/api/v1/demo/trigger', {}).expect(201)
    expect(trig.body.sessionId).toBe('sim-trigger-20261114T194000Z')
    expect(trig.body.eventId).toBe('sim-trigger-20261114T194000Z-evt')
    const demoAlerts = await asLocal.get(app, '/api/v1/alerts?workspace=demo').expect(200)
    const triggered = demoAlerts.body.events.find((e: { eventId: string }) => e.eventId === trig.body.eventId)
    expect(triggered).toMatchObject({ isSimulated: true, status: 'DELIVERED', origin: { kind: 'DEMO_TRIGGER' } })
    expect(triggered.provenance.ingestPath).toBe('DEMO_TRIGGER')

    const missionAlerts = await asLocal.get(app, '/api/v1/alerts').expect(200)
    expect(missionAlerts.body.events).toEqual([])
    expect(fileBytes(dataDir, 'mission.json').equals(missionBefore)).toBe(true)

    const devices = await asLocal.get(app, '/api/v1/devices?workspace=demo').expect(200)
    expect(devices.body.devices.find((d: { deviceId: string }) => d.deviceId === 'sim-watch-a')).toMatchObject({
      isSimulated: true,
      lastSeenAt: iso(),
      lastSyncAt: iso(),
      linkState: 'SIMULATED',
    })

    // A double click in the same second is a repeat, not a second event.
    clock = new Date(clock.getTime() + 400)
    const again = await asLocal.post(app, '/api/v1/demo/trigger', {}).expect(200)
    expect(again.body.eventId).toBe(trig.body.eventId)

    const ack = await asLocal.post(app, `/api/v1/demo/alerts/${trig.body.eventId}/simulate-ack`, {}).expect(200)
    expect(ack.body.event.acknowledgement).toMatchObject({ via: 'SIMULATED_WATCH' })
    expect(ack.body.event.status).toBe('ACKNOWLEDGED')
    expect(fileBytes(dataDir, 'mission.json').equals(missionBefore)).toBe(true)

    await asLocal.post(app, '/api/v1/demo/alerts/dq-sim-b-20261113b/simulate-ack', {}).expect(409)
    await asLocal.post(app, '/api/v1/demo/alerts/no-such/simulate-ack', {}).expect(404)
  })

  it('reset restores the fixture state after demo changes', async () => {
    const { app } = start()
    await asLocal.post(app, '/api/v1/demo/trigger', {}).expect(201)
    expect((await request(app).get('/api/v1/health')).body.workspaces.demo.sessions).toBe(8)
    await asLocal.post(app, '/api/v1/demo/reset', {}).expect(200)
    expect((await request(app).get('/api/v1/health')).body.workspaces.demo).toMatchObject({ sessions: 7, events: 4, readings: 2 })
  })

  it('refuses a simulated acknowledgement on a real event', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    expect((await asLocal.post(app, '/api/v1/demo/alerts/evt-1/simulate-ack', {}).expect(409)).body.error.code).toBe('REAL_EVENT')
  })
})

describe('10. file import', () => {
  it('imports a watch export into mission as saved device data, and a repeat import is all DUPLICATE', async () => {
    const { app } = start()
    const content = watchBundle([watchSession()], [watchEvent()])
    const first = await asLocal.post(app, '/api/v1/import', { fileName: 'watch-export.json', content }).expect(201)
    expect(first.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['CREATED', 'CREATED'])
    expect(first.body.workspaces).toEqual(['mission'])
    const s = await asLocal.get(app, '/api/v1/sessions/ses-1').expect(200)
    expect(s.body.session.provenance).toMatchObject({ ingestPath: 'SAVED_DEVICE_FILE', importFileName: 'watch-export.json' })
    expect(s.body.session.measurements[0].provenance.ingestPath).toBe('SAVED_DEVICE_FILE')
    expect(s.body.events.map((e: { eventId: string }) => e.eventId)).toEqual(['evt-1'])

    advance(10)
    const second = await asLocal.post(app, '/api/v1/import', { fileName: 'watch-export.json', content }).expect(200)
    expect(second.body.results.map((r: { outcome: string }) => r.outcome)).toEqual(['DUPLICATE', 'DUPLICATE'])
  })

  it('stores nothing from a file with one malformed record (422)', async () => {
    const { app } = start()
    const broken = { ...watchSession({ sessionId: 'ses-3' }), startedAt: 'yesterday' }
    const content = watchBundle([watchSession({ sessionId: 'ses-2' }), broken], [])
    const res = await asLocal.post(app, '/api/v1/import', { fileName: 'bad.json', content }).expect(422)
    expect(res.body.error.code).toBe('VALIDATION_FAILED')
    expect(res.body.error.message).toMatch(/Nothing was stored/)
    expect(res.body.error.details).toContain('record 2 (ses-3): startedAt: must be a UTC ISO-8601 timestamp such as 2026-11-14T19:30:05Z')
    expect(res.body.results.every((r: { outcome: string }) => r.outcome === 'REJECTED')).toBe(true)
    expect((await asLocal.get(app, '/api/v1/sessions').expect(200)).body.sessions).toEqual([])
  })

  it('refuses a malformed bundle envelope and a missing file body', async () => {
    const { app } = start()
    const env = await asLocal.post(app, '/api/v1/import', { fileName: 'x.json', content: { ...watchBundle([], []), sessions: 'none' } }).expect(422)
    expect(env.body.error.code).toBe('INVALID_BUNDLE')
    await asLocal.post(app, '/api/v1/import', { fileName: 'x.json' }).expect(422)
    await asLocal.post(app, '/api/v1/import', { content: [] }).expect(422)
  })

  it('sends a simulated file to the demo workspace', async () => {
    const { app } = start()
    const res = await asLocal.post(app, '/api/v1/import', { fileName: 'sim.json', content: watchBundle([watchSession({ simulated: true })], []) }).expect(201)
    expect(res.body.workspaces).toEqual(['demo'])
  })
})

describe('11. damaged data files', () => {
  it('refuses to start on a corrupted mission.json and leaves it byte-identical', () => {
    const dir = tempDir()
    const file = path.join(dir, 'mission.json')
    writeFileSync(file, '{"workspace": "mission", "formatVersion": 1, "sessions": {"ses-1": ')
    const before = readFileSync(file)
    expect(() => createApp({ dataDir: dir, token: TOKEN, maintenanceIntervalMs: 0 })).toThrow(/mission\.json is not valid JSON/)
    expect(readFileSync(file).equals(before)).toBe(true)
    expect(existsSync(path.join(dir, 'demo.json'))).toBe(false)
  })

  it('refuses a file with the wrong format version or workspace', () => {
    const dir = tempDir()
    const good = start(dir)
    void good
    const file = path.join(dir, 'demo.json')
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace('"formatVersion": 1', '"formatVersion": 2'))
    const before = readFileSync(file)
    expect(() => createApp({ dataDir: dir, token: TOKEN, maintenanceIntervalMs: 0 })).toThrow(/demo\.json is not a GRAVITYGUARD "demo" dataset: formatVersion is 2/)
    expect(readFileSync(file).equals(before)).toBe(true)
    writeFileSync(path.join(dir, 'mission.json'), JSON.stringify({ ...JSON.parse(text), formatVersion: 1 }))
    expect(() => createApp({ dataDir: dir, token: TOKEN, maintenanceIntervalMs: 0 })).toThrow(/mission\.json .*workspace is "demo", expected "mission"/)
  })
})

describe('12. watch link', () => {
  it('shows a watch as VERIFIED after a heartbeat and WATCH_UNREACHABLE 61 s later', async () => {
    const { app } = start()
    const hb = await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat()).expect(200)
    expect(hb.body).toMatchObject({ linkState: 'VERIFIED', serverTime: '2026-11-14T19:40:00.000Z', device: { deviceId: 'watch-1', subjectId: 'crew-a', isSimulated: false } })
    const now = await asLocal.get(app, '/api/v1/devices').expect(200)
    expect(now.body.devices).toEqual([expect.objectContaining({ deviceId: 'watch-1', linkState: 'VERIFIED' })])
    advance(61)
    const later = await asLocal.get(app, '/api/v1/devices').expect(200)
    expect(later.body.devices[0].linkState).toBe('WATCH_UNREACHABLE')
    const snap = await asLocal.get(app, '/api/v1/snapshot').expect(200)
    expect(snap.body.links).toEqual({ 'watch-1': 'WATCH_UNREACHABLE' })
    expect(snap.body.dataset).not.toHaveProperty('fingerprints')
  })
})

describe('alerts sent by the computer to the watch', () => {
  it('queues a data-check alert for a reachable watch, which reports it displayed and acknowledged', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat()).expect(200)
    const manual = await asLocal.post(app, '/api/v1/measurements', { measurements: [cuffReading()] }).expect(201)
    expect(manual.body.createdEvents).toEqual(['dq-cuff-1'])

    const outbox = await asDevice.get(app, '/api/v1/device/outbox?deviceId=watch-1').expect(200)
    expect(outbox.body).toMatchObject({ deviceId: 'watch-1', deviceKnown: true, subjectId: 'crew-a' })
    expect(outbox.body.events).toEqual([
      {
        eventId: 'dq-cuff-1',
        subjectId: 'crew-a',
        createdAt: '2026-11-14T19:40:00.000Z',
        category: 'VERIFY_SOURCE',
        severity: 'NOTICE',
        reasonCodes: ['SOURCE_REVIEW_REQUIRED'],
        watchMessage: { title: 'VERIFY SOURCE', body: 'CHECK MISSION COMPUTER' },
        delivery: { channel: 'COMPUTER_TO_WATCH', state: 'QUEUED' },
      },
    ])

    advance(5)
    const shown = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-1', presentedAt: '2026-11-14T19:40:04Z', hapticRequested: true }).expect(200)
    expect(shown.body.event.status).toBe('DELIVERED')
    expect(shown.body.event.delivery).toMatchObject({ state: 'PRESENTED', confirmedBy: 'WATCH_APP', hapticRequested: true })
    expect((await asDevice.get(app, '/api/v1/device/outbox?deviceId=watch-1').expect(200)).body.events).toEqual([])

    const acked = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:40:09Z' }).expect(200)
    expect(acked.body.event.status).toBe('ACKNOWLEDGED')
    await asLocal.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-1', presentedAt: iso(), hapticRequested: null }).expect(403)
  })

  it('marks a queued alert DELIVERY_UNCONFIRMED when the watch does not confirm it within 120 s', async () => {
    const { app, dataDir, runMaintenance } = start()
    await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat()).expect(200)
    await asLocal.post(app, '/api/v1/measurements', { measurements: [cuffReading()] }).expect(201)
    advance(60)
    expect(await runMaintenance()).toEqual([])
    advance(61)
    expect(await runMaintenance()).toEqual(['dq-cuff-1'])
    const e = (await asLocal.get(app, '/api/v1/alerts/dq-cuff-1').expect(200)).body.event
    expect(e.status).toBe('DELIVERY_UNCONFIRMED')
    expect(JSON.parse(fileBytes(dataDir, 'mission.json').toString('utf8')).events['dq-cuff-1'].status).toBe('DELIVERY_UNCONFIRMED')
    // A late display is still reported truthfully.
    const late = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-1', presentedAt: iso(), hapticRequested: false }).expect(200)
    expect(late.body.event.status).toBe('DELIVERED')
  })

  it('asks for a deviceId on the outbox and returns nothing for an unknown watch', async () => {
    const { app } = start()
    expect((await asDevice.get(app, '/api/v1/device/outbox').expect(400)).body.error.code).toBe('INVALID_QUERY')
    expect((await asDevice.get(app, '/api/v1/device/outbox?deviceId=watch-9').expect(200)).body).toMatchObject({ deviceKnown: false, events: [] })
  })
})

describe('stand-alone measurements', () => {
  it('rejects a watch reading typed in on the dashboard and anything that is not a measurement', async () => {
    const { app } = start()
    const watchReading = { ...cuffReading({ measurementId: 'hr-typed', indicator: 'HEART_RATE', unit: 'bpm', value: 80 }), source: { kind: 'APPLE_WATCH', device: null, sensor: null } }
    const r = await asLocal.post(app, '/api/v1/measurements', { measurements: [watchReading] }).expect(422)
    expect(r.body.results[0].outcome).toBe('REJECTED')
    expect(r.body.error.details[0]).toMatch(/manual entry is only for readings from an external instrument/)
    await asLocal.post(app, '/api/v1/measurements', { measurements: [watchSession()] }).expect(422)
    await asLocal.post(app, '/api/v1/measurements', { measurements: [] }).expect(422)
    await asLocal.post(app, '/api/v1/measurements', [cuffReading()]).expect(422)
  })

  it('stores readings from the watch over live sync and reports a changed re-send as a conflict', async () => {
    const { app } = start()
    const reading = cuffReading({ provenance: { origin: 'WATCH_APP', deviceId: 'watch-1' } })
    const res = await asDevice.post(app, '/api/v1/measurements', { measurements: [reading] }).expect(201)
    expect(res.body.results[0]).toMatchObject({ outcome: 'CREATED', workspace: 'mission' })
    await asDevice.post(app, '/api/v1/measurements', { measurements: [reading] }).expect(200)
    const changed = await asDevice.post(app, '/api/v1/measurements', { measurements: [{ ...reading, value: 150 }] }).expect(409)
    expect(changed.body.error.code).toBe('CONFLICT')
  })
})

describe('integration details for the System Status page', () => {
  it('gives the dashboard the token, URLs and endpoint list', async () => {
    const { app } = start()
    const res = await asLocal.get(app, '/api/v1/integration').expect(200)
    expect(res.body).toMatchObject({ token: TOKEN, tokenFile: null, tokenSource: 'option', lan: false })
    expect(res.body.urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(res.body.endpoints).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/v1/sessions', actor: 'DEVICE' }))
    expect(res.body.endpoints).toContainEqual(expect.objectContaining({ method: 'GET', path: '/api/v1/snapshot', actor: 'LOCAL_USER' }))
  })

  it('creates and reports a token file when no token is configured', async () => {
    const saved = process.env.GG_DEVICE_TOKEN
    delete process.env.GG_DEVICE_TOKEN
    try {
      const dir = tempDir()
      const mc = createApp({ dataDir: dir, now: () => clock, maintenanceIntervalMs: 0 })
      running.push(mc)
      expect(mc.info).toMatchObject({ tokenSource: 'file', tokenFile: path.join(dir, 'device-token'), tokenCreated: true })
      const res = await asLocal.get(mc.app, '/api/v1/integration').expect(200)
      expect(res.body.token).toBe(readFileSync(path.join(dir, 'device-token'), 'utf8').trim())
      expect(mc.info.tokenPrefix).toBe(`${res.body.token.slice(0, 4)}…`)
    } finally {
      if (saved !== undefined) process.env.GG_DEVICE_TOKEN = saved
    }
  })
})

describe('storage', () => {
  it('stores every one of many simultaneous uploads exactly once', async () => {
    const { app, dataDir } = start()
    const posts = Array.from({ length: 25 }, (_, i) => asDevice.post(app, '/api/v1/sessions', watchSession({ sessionId: `ses-par-${i}` })))
    const results = await Promise.all(posts)
    expect(results.map((r) => r.status)).toEqual(Array(25).fill(201))
    const onDisk = JSON.parse(fileBytes(dataDir, 'mission.json').toString('utf8'))
    expect(Object.keys(onDisk.sessions)).toHaveLength(25)
    expect(readdirSync(dataDir).filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('answers 503 when the disk write fails, serves nothing unsaved, and accepts the retry', async () => {
    let fail = true
    const { app } = start(undefined, {
      writeFile: async (file, text) => {
        if (fail) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
        await writeFileAtomic(file, text)
      },
    })
    const res = await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(503)
    expect(res.body.error.code).toBe('STORAGE_WRITE_FAILED')
    expect((await asLocal.get(app, '/api/v1/sessions').expect(200)).body.sessions).toEqual([])
    const health = await request(app).get('/api/v1/health').expect(200)
    expect(health.body).toMatchObject({ ok: false, storage: { writable: false } })
    fail = false
    expect((await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(201)).body.result.outcome).toBe('CREATED')
  })

  it('refuses changes after close()', async () => {
    const mc = start()
    await mc.close()
    const res = await asDevice.post(mc.app, '/api/v1/sessions', watchSession()).expect(503)
    expect(res.body.error.code).toBe('SHUTTING_DOWN')
  })
})

describe('built dashboard', () => {
  it('serves static files with an index.html fallback, but never for /api', async () => {
    const staticDir = tempDir()
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>GG</title>')
    writeFileSync(path.join(staticDir, 'app.js'), 'console.log(1)')
    const { app } = start(undefined, { staticDir })
    expect((await request(app).get('/').expect(200)).text).toContain('<title>GG</title>')
    expect((await request(app).get('/sessions/ses-1').expect(200)).text).toContain('<title>GG</title>')
    expect((await request(app).get('/app.js').expect(200)).text).toBe('console.log(1)')
    const api = await request(app).get('/api/v1/unknown').expect(404)
    expect(api.body.error.code).toBe('NOT_FOUND')
    await request(app).get('/').set('Host', 'evil.example').expect(403)
  })

  it('answers non-API paths with a JSON hint when no dashboard build is served', async () => {
    const { app } = start()
    const res = await request(app).get('/').expect(404)
    expect(res.body.error.message).toMatch(/Vite/)
  })
})

describe('review fixes: what the device may send and see', () => {
  const nested = (levels: number) => {
    const root: Record<string, unknown> = {}
    let o = root
    for (let i = 1; i < levels; i++) {
      const next: Record<string, unknown> = {}
      o.a = next
      o = next
    }
    return root
  }
  const queuedCuffAlert = async (app: App) => {
    await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat()).expect(200)
    await asLocal.post(app, '/api/v1/measurements', { measurements: [cuffReading()] }).expect(201)
    await asLocal
      .post(app, '/api/v1/alerts/dq-cuff-1/review', { action: 'SAVE_PROGRESS', reviewer: 'Crew medical officer', checkedItems: [], notes: 'Private note: discussed with the flight surgeon' })
      .expect(200)
  }

  it('refuses deeply nested extensions with 422 and keeps accepting records afterwards', async () => {
    const { app } = start()
    // Serialized here: the test client's own serializer is recursive and cannot write 10,000 levels.
    const body = JSON.stringify(watchEvent({ extensions: nested(10_000) }))
    const res = await request(app).post('/api/v1/alerts').set('Authorization', AUTH).set('Content-Type', 'application/json').send(body).expect(422)
    expect(res.body.error.details.join('\n')).toMatch(/^extensions: /m)
    await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(201)
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    const health = await request(app).get('/api/v1/health').expect(200)
    expect(health.body).toMatchObject({ ok: true, workspaces: { mission: { sessions: 1, events: 1 } } })
  })

  it('gives the watch only the alert fields it needs from its outbox, never review notes', async () => {
    const { app } = start()
    await queuedCuffAlert(app)
    const outbox = await asDevice.get(app, '/api/v1/device/outbox?deviceId=watch-1').expect(200)
    expect(Object.keys(outbox.body.events[0]).sort()).toEqual(['category', 'createdAt', 'delivery', 'eventId', 'reasonCodes', 'severity', 'subjectId', 'watchMessage'])
    expect(outbox.body.events[0].delivery).toEqual({ channel: 'COMPUTER_TO_WATCH', state: 'QUEUED' })
    expect(JSON.stringify(outbox.body)).not.toMatch(/flight surgeon|Crew medical officer/)
  })

  it('answers delivery and acknowledgement reports with the alert state only, and records the reporting device', async () => {
    const { app } = start()
    await queuedCuffAlert(app)
    const shown = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-1', presentedAt: '2026-11-14T19:40:04Z', hapticRequested: true }).expect(200)
    expect(shown.body).toEqual({
      event: {
        eventId: 'dq-cuff-1',
        subjectId: 'crew-a',
        createdAt: '2026-11-14T19:40:00.000Z',
        category: 'VERIFY_SOURCE',
        severity: 'NOTICE',
        reasonCodes: ['SOURCE_REVIEW_REQUIRED'],
        watchMessage: { title: 'VERIFY SOURCE', body: 'CHECK MISSION COMPUTER' },
        status: 'DELIVERED',
        delivery: {
          channel: 'COMPUTER_TO_WATCH',
          state: 'PRESENTED',
          presentedAt: '2026-11-14T19:40:04Z',
          hapticRequested: true,
          confirmedBy: 'WATCH_APP',
          confirmedByDeviceId: 'watch-1',
        },
        acknowledgement: null,
      },
    })
    const acked = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/ack', { deviceId: 'watch-1', acknowledgedAt: '2026-11-14T19:40:09Z' }).expect(200)
    expect(acked.body.event).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:40:09Z', via: 'WATCH', deviceId: 'watch-1' } })
    expect(JSON.stringify([shown.body, acked.body])).not.toMatch(/flight surgeon|Crew medical officer|statusHistory|evidence|provenance/)
    const stored = (await asLocal.get(app, '/api/v1/alerts/dq-cuff-1').expect(200)).body.event
    const notes = stored.statusHistory.filter((h: { status: string }) => h.status === 'DELIVERED' || h.status === 'ACKNOWLEDGED').map((h: { note: string }) => h.note)
    expect(notes).toHaveLength(2)
    for (const n of notes) expect(n).toMatch(/watch-1/)
  })

  it('refuses delivery and acknowledgement reports from a watch bound to another crew member', async () => {
    const { app } = start()
    await queuedCuffAlert(app)
    await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat({ deviceId: 'watch-2', subjectId: 'crew-b' })).expect(200)
    const wrongDelivery = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-2', presentedAt: iso(), hapticRequested: true }).expect(409)
    expect(wrongDelivery.body.error.code).toBe('DEVICE_SUBJECT_MISMATCH')
    await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/delivery', { deviceId: 'watch-1', presentedAt: iso(), hapticRequested: true }).expect(200)
    const wrongAck = await asDevice.post(app, '/api/v1/alerts/dq-cuff-1/ack', { deviceId: 'watch-2', acknowledgedAt: iso() }).expect(409)
    expect(wrongAck.body.error.code).toBe('DEVICE_SUBJECT_MISMATCH')
    expect((await asLocal.get(app, '/api/v1/alerts/dq-cuff-1').expect(200)).body.event.acknowledgement).toBeNull()
  })

  it('applies a heartbeat flagged isSimulated to the demo workspace only', async () => {
    const { app } = start()
    const res = await asDevice.post(app, '/api/v1/device/heartbeat', heartbeat({ isSimulated: true })).expect(200)
    expect(res.body).toMatchObject({ linkState: 'SIMULATED', device: { deviceId: 'watch-1', isSimulated: true } })
    expect((await asLocal.get(app, '/api/v1/devices').expect(200)).body.devices).toEqual([])
    const demo = (await asLocal.get(app, '/api/v1/devices?workspace=demo').expect(200)).body.devices
    expect(demo.find((d: { deviceId: string }) => d.deviceId === 'watch-1')).toMatchObject({ isSimulated: true, linkState: 'SIMULATED' })
  })

  it('does not let a dashboard file import report delivery or acknowledgement for the watch', async () => {
    const { app } = start()
    await asDevice.post(app, '/api/v1/alerts', watchEvent()).expect(201)
    const acked = watchEvent({ status: 'ACKNOWLEDGED', acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH' } })
    const res = await asLocal.post(app, '/api/v1/import', { fileName: 'watch-export.json', content: watchBundle([], [acked]) }).expect(409)
    expect(res.body.results[0]).toMatchObject({
      outcome: 'CONFLICT',
      detail: 'delivery and acknowledgement of a stored event can only be reported by the watch over the device API',
    })
    expect((await asLocal.get(app, '/api/v1/alerts/evt-1').expect(200)).body.event.acknowledgement).toBeNull()
  })

  it('refuses events that claim to be computer checks or link to another subject\'s session', async () => {
    const { app } = start()
    const forged = await asDevice.post(app, '/api/v1/alerts', watchEvent({ origin: { kind: 'MISSION_COMPUTER_CHECK', ruleSet: null, deviceId: null } })).expect(422)
    expect(forged.body.error.details.join('\n')).toMatch(/^origin\.kind: /m)
    await asDevice.post(app, '/api/v1/sessions', watchSession()).expect(201)
    const crossed = await asDevice.post(app, '/api/v1/alerts', watchEvent({ subjectId: 'crew-b' })).expect(422)
    expect(crossed.body.result.outcome).toBe('REJECTED')
    expect(crossed.body.error.message).toMatch(/different subject/)
  })
})
