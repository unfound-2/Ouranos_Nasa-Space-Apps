import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createWatchLink } from './watch-link'
import { demoDay } from '../shared/daily-plan'
import { HttpError } from './errors'

function setup() {
  const app = express()
  const router = createWatchLink({ now: () => new Date(), localUser: (req, res, next) => req.headers['x-console'] === 'yes' ? next() : res.sendStatus(403), onHeartbeat: async () => {}, onSignal: async () => {} })
  app.use('/api', router)
  app.use((e: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(e.status ?? 500).json({ error: e.message }))
  return app
}

describe('watch-linked daily planner', () => {
  it('shares a mission plan, accepts watch check-ins, rejects stale saves and protects access', async () => {
    const app = setup()
    const { code, watchToken } = (await request(app).post('/api/pairing').expect(201)).body
    const { deviceId } = (await request(app).post('/api/pairing/redeem').set('x-console', 'yes').send({ code }).expect(200)).body
    await request(app).get('/api/planner').expect(401)
    await request(app).get(`/api/planner/${deviceId}`).expect(403)
    const plan = { ...demoDay(), simulated: false }
    await request(app).post(`/api/planner/${deviceId}`).set('x-console', 'yes').send({ plan: { ...plan, simulated: true }, expectedRevision: 0 }).expect(422)
    const saved = (await request(app).post(`/api/planner/${deviceId}`).set('x-console', 'yes').send({ plan, expectedRevision: 0 }).expect(200)).body
    expect(saved.revision).toBe(1)
    const watch = (await request(app).get('/api/planner').set('Authorization', `Bearer ${watchToken}`).expect(200)).body
    expect(watch.tasks).toHaveLength(plan.tasks.length)
    const changed = (await request(app).post('/api/planner-action').set('Authorization', `Bearer ${watchToken}`).send({ expectedRevision: 1, action: { type: 'checkin', fatigue: 'very' } }).expect(200)).body
    expect(changed.revision).toBe(2)
    expect(changed.fatigue).toBe('very')
    await request(app).post(`/api/planner/${deviceId}`).set('x-console', 'yes').send({ plan, expectedRevision: 1 }).expect(409)
    await request(app).post('/api/planner-action').set('Authorization', `Bearer ${watchToken}`).send({ expectedRevision: 2, action: { type: 'delay', taskId: 'nonexistent', minutes: 15 } }).expect(422)
  })
})
