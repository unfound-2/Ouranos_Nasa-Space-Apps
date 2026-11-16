import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { demoDay } from '../shared/daily-plan'
import { createCloudApp } from './cloud-app'

type Row = Record<string, unknown>
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex')

describe('hosted watch pairing', () => {
  it('redeems once, survives a new app instance, isolates reads, and accepts live telemetry and events', async () => {
    const pairs: Row[] = []
    const events: Row[] = []
    const fakeFetch: typeof fetch = async (input, options) => {
      const url = new URL(String(input))
      const method = options?.method
      const body = options?.body ? JSON.parse(String(options.body)) : null
      if (url.pathname.endsWith('/gg_pairing_attempt')) return Response.json(true)
      const rows = url.pathname.endsWith('gg_watch_events') ? events : pairs
      const found = rows.filter((row) => [...url.searchParams].every(([key, raw]) => {
        if (raw.startsWith('neq.')) return String(row[key]) !== raw.slice(4)
        if (raw.startsWith('eq.')) return String(row[key]) === raw.slice(3)
        if (raw.startsWith('in.(')) return raw.slice(4, -1).split(',').includes(String(row[key]))
        return raw !== 'is.null' || row[key] === null
      }))
      if (method === 'POST') {
        const duplicate = rows.some(row => row.device_id === body.device_id && row.event_id === body.event_id)
        if (duplicate && String(new Headers(options?.headers).get('Prefer')).includes('ignore-duplicates')) return Response.json([])
        rows.push(body)
        return String(new Headers(options?.headers).get('Prefer')).includes('return=representation') ? Response.json([body], { status: 201 }) : new Response(null, { status: 201 })
      }
      if (method === 'PATCH') found.forEach((row) => Object.assign(row, body))
      if (method === 'DELETE') found.forEach((row) => rows.splice(rows.indexOf(row), 1))
      return Response.json(found)
    }
    const app = () => request(createCloudApp({ url: 'https://database.invalid', key: 'sb_secret_test', fetch: fakeFetch }))
    const pairing = (await app().post('/api/pairing').expect(201)).body
    const bearer = `Bearer ${pairing.watchToken}`
    expect(pairs[0].watch_hash).toEqual(digest(pairing.watchToken))
    expect((await app().get('/api/device').set('Authorization', bearer).expect(200)).body.paired).toBe(false)
    const redeemed = await app().post('/api/pairing/redeem').send({ code: pairing.code }).expect(200)
    await app().post('/api/pairing/redeem').send({ code: pairing.code }).expect(404)
    const header = String(redeemed.headers['set-cookie'][0])
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    const cookie = header.split(';')[0]
    expect((await app().get('/api/device').set('Authorization', bearer).expect(200)).body.paired).toBe(true)

    // A schedule survives serverless instances, is private to the pairing, and never appears as a medical event.
    const deviceId = redeemed.body.deviceId
    const planUrl = `/api/planner/${deviceId}`
    await app().get(planUrl).expect(401)
    const plan = { ...demoDay(), simulated: false }
    await app().post(planUrl).set('Cookie', cookie).send({ plan, expectedRevision: 0 }).expect(200)
    await app().post(planUrl).set('Cookie', cookie).send({ plan, expectedRevision: 0 }).expect(409)
    const saved = (await app().get('/api/planner').set('Authorization', bearer).expect(200)).body
    expect(saved.revision).toBe(1)
    await app().post('/api/planner-action').set('Authorization', bearer).send({ expectedRevision: 1, action: { type: 'checkin', fatigue: 'very' } }).expect(200)
    expect((await app().get(planUrl).set('Cookie', cookie).expect(200)).body.fatigue).toBe('very')
    await app().post(planUrl).set('Cookie', cookie).send({ plan, expectedRevision: 1 }).expect(409)
    expect((await app().get('/api/v1/snapshot').set('Cookie', cookie).expect(200)).body.dataset.events).toEqual({})

    const now = Date.now() / 1000
    const frame = { version: 1, source: 'Watch sensors', observedAt: now, simulated: false,
      readings: [{ metric: 'Heart rate', value: 77, unit: 'bpm', quality: 'valid', status: 'review' }] }
    await app().post('/api/watch').send(frame).expect(401)
    await app().post('/api/watch').set('Authorization', bearer).send(frame).expect(202)
    expect((await app().get('/api/watch-links').expect(200)).body).toEqual([])
    const links = (await app().get('/api/watch-links').set('Cookie', cookie).expect(200)).body
    expect(links[0].watch.readings[0].value).toBe(77)
    expect(links[0].deviceId).toBe(redeemed.body.deviceId)
    const eventId = randomUUID()
    await app().post('/api/signals').set('Authorization', bearer).send({
      id: eventId, createdAt: now, frame, evidence: ['Heart rate'], action: 'Review this reading.',
    }).expect(202)
    const anonymous = await app().get('/api/v1/snapshot').expect(200)
    expect(anonymous.body.dataset.events).toEqual({})
    const owner = await app().get('/api/v1/snapshot').set('Cookie', cookie).expect(200)
    expect(owner.body.dataset.events[eventId].reasonCodes).toEqual(['WATCH_TELEMETRY_FLAG'])
    expect(owner.body.links[redeemed.body.deviceId]).toBe('VERIFIED')

    await app().delete('/api/device').set('Authorization', bearer).expect(200)
    expect((await app().get('/api/watch-links').set('Cookie', cookie).expect(200)).body).toEqual([])
  })
})
