import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyDataset, ingestRecords, type Datasets } from '../../shared/dataset'
import { loadDemo } from '../../shared/demo'
import { buildEvent, buildSession } from '../../shared/testing'
import { bannerSourceMode, focusFor, recoveryCheckState, regionsFor, sortEvents } from './view'

const bundle = JSON.parse(readFileSync(new URL('../../../fixtures/simulated/demo-bundle.json', import.meta.url), 'utf8'))
function demo() {
  const ds: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
  loadDemo(ds, bundle, '2026-11-14T19:00:00Z')
  return ds.demo
}

describe('body regions', () => {
  it('scenario B: head carries the self-reported dizziness, chest the heart-rate readings, wrist the excluded readings', () => {
    const ds = demo()
    const r = regionsFor(ds.sessions['sim-a-20261112'], [])
    expect(r.HEAD.state).toBe('symptom')
    expect(r.HEAD.callout).toBe('SELF-REPORTED DIZZINESS')
    expect(r.CHEST.state).toBe('data')
    expect(r.ARMS.state).toBe('caution')
    expect(r.LEGS.state).toBe('neutral')
  })

  it('scenario F: a weakness reported at the legs lights the legs and nothing at the head', () => {
    const r = regionsFor(demo().sessions['sim-b-20261113a'], [])
    expect(r.LEGS.state).toBe('symptom')
    expect(r.LEGS.callout).toBe('SELF-REPORTED WEAKNESS')
    expect(r.HEAD.state).toBe('neutral')
  })

  it('scenario D: the chest callout names the flagged blood-pressure reading, not the heart rate', () => {
    const ds = demo()
    const s = ds.sessions['sim-b-20261113b']
    const readings = Object.values(ds.readings).filter((r) => r.sessionId === s.sessionId)
    const r = regionsFor(s, readings)
    expect(r.CHEST.state).toBe('caution')
    expect(r.CHEST.callout).toBe('BP READING · CHECK SOURCE')
  })

  it('keeps every region neutral when there is no evidence', () => {
    const r = regionsFor(buildSession({ rest: [], recovery: [] }), [])
    expect((['HEAD', 'CHEST', 'ARMS', 'LEGS'] as const).map((k) => r[k].state)).toEqual(['neutral', 'neutral', 'neutral', 'neutral'])
  })

  it('does not place a weakness without a reported location anywhere on the body', () => {
    const s = buildSession({
      rest: [70, 71, 72],
      recovery: [80, 81, 82],
      symptoms: [{ symptomId: 's1', code: 'WEAK', reportedAt: '2026-11-14T19:31:55Z', phase: 'RECOVERY', bodyRegion: null, reportedBy: 'SELF_REPORTED', note: null }],
    })
    const r = regionsFor(s, [])
    expect(r.LEGS.state).toBe('neutral')
    // The wrist may still show sensor data, but the weakness is not placed there.
    expect(r.ARMS.state).not.toBe('symptom')
    expect(r.unplaced.map((u) => u.code)).toEqual(['WEAK'])
  })
})

describe('event ordering and focus', () => {
  it('puts open events first, then by severity, then newest', () => {
    const e = (id: string, status: 'DELIVERED' | 'REVIEWED', severity: 'NOTICE' | 'REVIEW', createdAt: string) =>
      buildEvent({ eventId: id, status, severity, createdAt, review: { ...buildEvent().review, state: status === 'REVIEWED' ? 'REVIEWED' : 'NOT_STARTED' } })
    const sorted = sortEvents([
      e('old-review', 'DELIVERED', 'REVIEW', '2026-11-10T10:00:00Z'),
      e('done', 'REVIEWED', 'REVIEW', '2026-11-14T10:00:00Z'),
      e('notice', 'DELIVERED', 'NOTICE', '2026-11-14T09:00:00Z'),
      e('new-review', 'DELIVERED', 'REVIEW', '2026-11-12T10:00:00Z'),
    ])
    expect(sorted.map((x) => x.eventId)).toEqual(['new-review', 'old-review', 'notice', 'done'])
  })

  it('ranks an alert nobody has acknowledged above an acknowledged one of the same severity', () => {
    const base = buildEvent()
    const acked = buildEvent({
      eventId: 'acked',
      createdAt: '2026-11-14T12:00:00Z',
      status: 'ACKNOWLEDGED',
      acknowledgement: { acknowledgedAt: '2026-11-14T12:01:00Z', via: 'WATCH' },
    })
    const unseen = buildEvent({ eventId: 'unseen', createdAt: '2026-11-13T12:00:00Z', review: base.review })
    expect(sortEvents([acked, unseen]).map((e) => e.eventId)).toEqual(['unseen', 'acked'])
  })

  it('focuses a crew member on their most pressing open event and its session', () => {
    const f = focusFor(demo(), 'sim-crew-a')
    expect(f.event?.eventId).toBe('sim-evt-20261112-a')
    expect(f.session?.sessionId).toBe('sim-a-20261112')
  })

  it('falls back to the latest session when a crew member has no events', () => {
    const ds = demo()
    for (const id of Object.keys(ds.events)) if (ds.events[id].subjectId === 'sim-crew-a') delete ds.events[id]
    const f = focusFor(ds, 'sim-crew-a')
    expect(f.event).toBeNull()
    expect(f.session?.sessionId).toBe('sim-a-20261112')
  })
})

describe('data-source banner', () => {
  it('always reads SIMULATED DEMO in the demo workspace, even with a fresh simulated link', () => {
    const ds = demo()
    expect(bannerSourceMode(ds, { 'sim-watch-a': 'SIMULATED' }, 'sim-crew-a')).toBe('SIMULATED DEMO')
  })

  it('reads UNAVAILABLE when there are no mission records', () => {
    expect(bannerSourceMode(emptyDataset('mission'), {}, null)).toBe('UNAVAILABLE')
  })

  it('reads LIVE DEVICE only while the live-sync link is verified', () => {
    const ds: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
    const raw = { ...buildSession({ rest: [70, 71, 72] }) } as Record<string, unknown>
    raw.provenance = { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' }
    raw.measurements = (raw.measurements as Record<string, unknown>[]).map(({ provenance: _p, receivedAt: _r, ...m }) => m)
    const r = ingestRecords(ds, [raw], { now: '2026-11-14T19:33:00Z', path: 'LIVE_SYNC' })
    expect(r.results[0].outcome).toBe('CREATED')
    expect(bannerSourceMode(ds.mission, { 'watch-1': 'VERIFIED' }, 'crew-a')).toBe('LIVE DEVICE')
    expect(bannerSourceMode(ds.mission, { 'watch-1': 'WATCH_UNREACHABLE' }, 'crew-a')).toBe('SAVED DEVICE DATA')
  })
})

describe('review fixes: view', () => {
  it('calls an unfinished session live only when its data is LIVE DEVICE', () => {
    const s = buildSession({ rest: [70, 72, 74], endReason: 'IN_PROGRESS', recoveryPhase: 'open' })
    expect(recoveryCheckState(s, 'LIVE DEVICE').value).toBe('RECOVERY · live')
    expect(recoveryCheckState(s, 'SAVED DEVICE DATA').value).toBe('RECOVERY · no end time yet')
    expect(recoveryCheckState(s, 'SAVED DEVICE DATA').sub).not.toMatch(/waiting for the watch/i)
  })

  it('does not use a computer-created event as the source record for the banner', () => {
    const ds = emptyDataset('mission')
    const e = buildEvent({ eventId: 'dq-x', origin: { kind: 'MISSION_COMPUTER_CHECK', ruleSet: 'computer-checks 1.0', deviceId: null } })
    ds.events['dq-x'] = { ...e, provenance: { ...e.provenance, origin: 'MISSION_COMPUTER', ingestPath: null } }
    expect(bannerSourceMode(ds, {}, 'crew-a')).toBe('UNAVAILABLE')
  })

  it('does not crash when an event names a session id that is a built-in property name', () => {
    const ds = emptyDataset('mission')
    ds.events['e1'] = buildEvent({ eventId: 'e1', sessionId: 'constructor' })
    expect(focusFor(ds, 'crew-a').session).toBeNull()
  })
})
