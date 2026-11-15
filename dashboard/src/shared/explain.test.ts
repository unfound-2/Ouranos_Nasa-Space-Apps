import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyDataset, runDataChecks, type Datasets } from './dataset'
import { loadDemo } from './demo'
import { buildEventContext, conclusionsFor, eventTitle, explainEvent, focusLabel, knownsAndUnknowns, reasonInfo, reasonLine, timelineFor, whatHappened } from './explain'
import { buildEvent, buildExternalReading, buildSession } from './testing'

const bundle = JSON.parse(readFileSync(new URL('../../fixtures/simulated/demo-bundle.json', import.meta.url), 'utf8'))
function demo() {
  const ds: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
  loadDemo(ds, bundle, '2026-11-14T19:00:00Z')
  return ds.demo
}
const NOW = '2026-11-14T19:05:00Z'
const ids = (facts: { id: string }[]) => facts.map((f) => f.id)

describe('reason codes', () => {
  it('describes a known code and keeps an unknown code exactly as sent', () => {
    expect(reasonInfo('SYMPTOM_REPORTED').known).toBe(true)
    const u = reasonInfo('WATCH_CUSTOM_RULE_7')
    expect(u.known).toBe(false)
    expect(u.label).toBe('WATCH_CUSTOM_RULE_7')
  })
})

describe('event explanation (scenario B: dizziness)', () => {
  const ds = demo()
  const ctx = buildEventContext(ds.events['sim-evt-20261112-a'], ds, NOW)
  const text = explainEvent(ctx).join(' ')

  it('says why the event exists, from the recorded symptom', () => {
    expect(text).toMatch(/Review suggested because dizziness was self-reported at 14:11:55 UTC/)
  })
  it('states the phase comparison with its sample counts and calls it descriptive', () => {
    expect(text).toMatch(/rest median 71 bpm \(9 valid readings\), recovery median 94 bpm \(9 valid readings\)/)
    expect(text).toMatch(/\+23 bpm/)
    expect(text).toMatch(/descriptive/)
  })
  it('compares with the personal baseline only because three earlier sessions exist', () => {
    expect(text).toMatch(/3 earlier comparable sessions/)
    expect(text).toMatch(/\+12 bpm above/)
  })
  it('never uses diagnostic or risk language', () => {
    expect(text).not.toMatch(/diagnos(is|ed)|risk|faint|safe|cleared|orthostatic/i)
  })
})

describe('event explanation (scenario C: insufficient data)', () => {
  const ds = demo()
  const ctx = buildEventContext(ds.events['sim-evt-20261112-b'], ds, NOW)
  it('explains the missing comparison instead of computing a delta', () => {
    const text = explainEvent(ctx).join(' ')
    expect(text).toMatch(/insufficient for a phase comparison \(rest: 1 valid reading, recovery: 1 valid reading; at least 3 are needed in each\)/)
    expect(text).not.toMatch(/observed difference/)
  })
  it('lists the missing samples and the missing baseline as unknowns', () => {
    const k = knownsAndUnknowns(ctx)
    expect(ids(k.unknown)).toEqual(expect.arrayContaining(['samples', 'baseline']))
    expect(ids(k.known)).not.toContain('samples')
  })
})

describe('what we know / what we do not know', () => {
  it('scenario B knows the readings, the symptom and the baseline, and never knows blood pressure or the cause', () => {
    const ds = demo()
    const k = knownsAndUnknowns(buildEventContext(ds.events['sim-evt-20261112-a'], ds, NOW))
    expect(ids(k.known)).toEqual(expect.arrayContaining(['readings', 'samples', 'phases', 'symptoms', 'baseline', 'delivery']))
    expect(ids(k.unknown)).toEqual(expect.arrayContaining(['blood-pressure', 'cause', 'posture', 'acknowledgement']))
  })

  it('scenario E records that the alert never reached the watch', () => {
    const ds = demo()
    const k = knownsAndUnknowns(buildEventContext(ds.events['dq-sim-b-20261113b'], ds, NOW))
    const delivery = k.unknown.find((f) => f.id === 'delivery')
    expect(delivery?.text).toMatch(/not delivered/i)
  })

  it('labels simulated records as simulated instead of claiming a device sync', () => {
    const ds = demo()
    const k = knownsAndUnknowns(buildEventContext(ds.events['sim-evt-20261113-b'], ds, NOW))
    const sync = [...k.known, ...k.unknown].find((f) => f.id === 'sync')
    expect(sync?.text).toMatch(/simulated/i)
  })
})

describe('computer-created events (scenario D)', () => {
  const ds = demo()
  const ctx = buildEventContext(ds.events['dq-sim-b-20261113b'], ds, NOW)
  it('counts the readings it flagged, not the evidence entries', () => {
    expect(explainEvent(ctx)[0]).toMatch(/flagged 2 readings for source verification/)
  })
  it('does not judge heart-rate freshness against the time the computer ran its check', () => {
    const k = knownsAndUnknowns(ctx)
    expect([...k.known, ...k.unknown].map((f) => f.id)).not.toContain('freshness')
  })
})

describe('activity timeline', () => {
  it('lists only what happened, in time order (scenario F)', () => {
    const ds = demo()
    const ctx = buildEventContext(ds.events['sim-evt-20261113-b'], ds, NOW)
    const items = timelineFor(ctx.event, ctx.session)
    expect(items.map((i) => i.kind)).toEqual([
      'SESSION_STARTED',
      'REST_RECORDED',
      'RECOVERY_CONFIRMED',
      'RECOVERY_RECORDED',
      'SYMPTOM',
      'EVENT_CREATED',
      'DELIVERED',
      'SESSION_SAVED',
      'ACKNOWLEDGED',
    ])
    const times = items.map((i) => Date.parse(i.at))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('has no acknowledgement entry when the watch never acknowledged (scenario B)', () => {
    const ds = demo()
    const ctx = buildEventContext(ds.events['sim-evt-20261112-a'], ds, NOW)
    expect(timelineFor(ctx.event, ctx.session).map((i) => i.kind)).not.toContain('ACKNOWLEDGED')
  })
})

describe('review fixes: explanations', () => {
  const mission = () => emptyDataset('mission')

  it('says "reported by a crew observer" when a crew member observed the symptom', () => {
    const ds = mission()
    const session = buildSession({
      rest: [70, 72, 74],
      recovery: [82, 84, 86],
      symptoms: [{ symptomId: 'sym-1', code: 'DIZZY', reportedAt: '2026-11-14T19:31:55Z', phase: 'RECOVERY', bodyRegion: null, reportedBy: 'CREW_OBSERVED', note: null }],
    })
    ds.sessions[session.sessionId] = session
    const event = buildEvent()
    ds.events[event.eventId] = event
    const ctx = buildEventContext(event, ds, NOW)
    const all = [...knownsAndUnknowns(ctx).known, ...knownsAndUnknowns(ctx).unknown].map((f) => f.text).join(' ')
    expect(all).toMatch(/reported by a crew observer/)
    expect(all).not.toMatch(/self-reported/)
    expect(reasonInfo('SYMPTOM_REPORTED').meaning).toBe('A symptom was reported during the check.')
  })

  it('takes the link from the device that sent the event, not another watch of the same person', () => {
    const ds = mission()
    const event = buildEvent()
    ds.events[event.eventId] = event
    const dev = (deviceId: string, lastSeenAt: string) => ({ deviceId, subjectId: 'crew-a', isSimulated: false, firstSeenAt: lastSeenAt, lastSeenAt, lastSyncAt: lastSeenAt, appVersion: null, deviceModel: null, pendingRecords: null })
    ds.devices['watch-1'] = dev('watch-1', '2026-11-14T19:30:00Z')
    ds.devices['watch-2'] = dev('watch-2', '2026-11-14T19:39:55Z')
    const ctx = buildEventContext(event, ds, '2026-11-14T19:40:00Z')
    expect(ctx.link).toBe('WATCH_UNREACHABLE')
    expect(ctx.sourceMode).toBe('SAVED DEVICE DATA')
  })

  it('labels a computer check by how the cited reading arrived, not as an import', () => {
    const ds = mission()
    const r = buildExternalReading({ measurementId: 'bp-typed', sessionId: null, measuredAt: '2026-11-14T19:00:00Z', value: 150, quality: 'QUESTIONABLE' })
    ds.readings[r.measurementId] = { ...r, provenance: { ...r.provenance, ingestPath: 'MANUAL_ENTRY', origin: 'MISSION_COMPUTER' } }
    const [id] = runDataChecks(ds, NOW)
    const ctx = buildEventContext(ds.events[id], ds, NOW)
    expect(ctx.sourceMode).toBe('MANUALLY ENTERED')
    const text = [...explainEvent(ctx), ...knownsAndUnknowns(ctx).unknown.map((f) => f.text)].join(' ')
    expect(text).toMatch(/not linked to a recovery session/)
    expect(text).not.toMatch(/has not been received/)
    expect(explainEvent(ctx)[0]).toMatch(/flagged 1 reading for source verification/)
  })

  it('describes undelivered computer alerts without claiming a send that never happened', () => {
    const ds = demo()
    const e = ds.events['dq-sim-b-20261113b']
    const text = explainEvent(buildEventContext(e, ds, NOW)).join(' ')
    expect(text).toMatch(/was not sent/)
    expect(text).not.toMatch(/when this computer tried/)
    const unconfirmed = { ...e, status: 'DELIVERY_UNCONFIRMED' as const, delivery: { ...e.delivery, state: 'UNCONFIRMED' as const } }
    const t2 = explainEvent(buildEventContext(unconfirmed, ds, NOW)).join(' ')
    expect(t2).toMatch(/queued for the watch/)
    expect(t2).not.toMatch(/was sent/)
  })

  it('names how many sessions the baseline median really uses', () => {
    const ds = mission()
    const prior = (i: number, rec: number) =>
      buildSession({ sessionId: `p${i}`, startedAt: `2026-11-0${i}T10:00:00Z`, rest: [70, 70, 70], recovery: [rec, rec, rec] })
    for (const [i, rec] of [[1, 80], [2, 80], [3, 80], [4, 80], [5, 90], [6, 90], [7, 90]] as const) ds.sessions[`p${i}`] = prior(i, rec)
    const cur = buildSession({ sessionId: 'cur', startedAt: '2026-11-09T10:00:00Z', rest: [70, 70, 70], recovery: [95, 95, 95] })
    ds.sessions.cur = cur
    const ev = buildEvent({ sessionId: 'cur', evidence: [] })
    const text = explainEvent(buildEventContext(ev, ds, NOW)).join(' ')
    expect(text).toMatch(/median of the 5 most recent of 7 earlier comparable sessions/)
  })

  it('counts valid readings that carry no phase tag', () => {
    const ds = mission()
    const s = buildSession({ rest: [70, 72, 74] })
    s.measurements = s.measurements.map((m) => ({ ...m, phase: null }))
    ds.sessions[s.sessionId] = s
    const ev = buildEvent({ evidence: [] })
    const k = knownsAndUnknowns(buildEventContext(ev, ds, NOW))
    const readings = [...k.known, ...k.unknown].find((f) => f.id === 'readings')
    expect(readings?.text).toMatch(/3 valid heart-rate readings/)
    expect(readings?.text).toMatch(/3 have no phase tag/)
  })

  it('does not crash on an event whose session id is a built-in property name', () => {
    const ds = mission()
    const ev = buildEvent({ sessionId: 'constructor', evidence: [] })
    const ctx = buildEventContext(ev, ds, NOW)
    expect(ctx.session).toBeNull()
    expect(explainEvent(ctx).join(' ')).toMatch(/has not been received/)
  })
})

describe('heart-rate permission from the watch', () => {
  it('says plainly when the watch was refused heart-rate permission', () => {
    const ds = emptyDataset('mission')
    const s = { ...buildSession({ rest: [], recovery: [] }), heartRateAccess: 'DENIED' as const }
    ds.sessions[s.sessionId] = s
    const ev = buildEvent({ category: 'RECORDING_INCOMPLETE', severity: 'NOTICE', reasonCodes: ['HR_UNAVAILABLE'], evidence: [] })
    const k = knownsAndUnknowns(buildEventContext(ev, ds, NOW))
    const f = k.unknown.find((x) => x.id === 'hr-access')
    expect(f?.text).toMatch(/permission was denied on the watch/)
    expect(k.known.find((x) => x.id === 'hr-access')).toBeUndefined()
  })

  it('records granted permission as a known fact and says nothing when the watch did not report it', () => {
    const ds = emptyDataset('mission')
    const granted = { ...buildSession({ rest: [70, 72, 74] }), heartRateAccess: 'AUTHORIZED' as const }
    ds.sessions[granted.sessionId] = granted
    const ev = buildEvent({ evidence: [] })
    expect(knownsAndUnknowns(buildEventContext(ev, ds, NOW)).known.map((x) => x.id)).toContain('hr-access')
    const silent = buildSession({ sessionId: 'ses-2', rest: [70, 72, 74] })
    ds.sessions['ses-2'] = silent
    const ev2 = buildEvent({ eventId: 'evt-2', sessionId: 'ses-2', evidence: [] })
    const all = knownsAndUnknowns(buildEventContext(ev2, ds, NOW))
    expect([...all.known, ...all.unknown].map((x) => x.id)).not.toContain('hr-access')
  })
})

describe('v2 narrative', () => {
  const ds = demo()
  const ctxOf = (id: string) => buildEventContext(ds.events[id], ds, NOW)

  it('labels the focus by what the event actually is, never "required"', () => {
    expect(focusLabel(ds.events['sim-evt-20261112-a'])).toBe('REVIEW SUGGESTED')
    expect(focusLabel({ ...ds.events['sim-evt-20261112-a'], severity: 'PRIORITY_REVIEW' })).toBe('PRIORITY REVIEW SUGGESTED')
    expect(focusLabel(ds.events['dq-sim-b-20261113b'])).toBe('VERIFY SOURCE')
    expect(focusLabel(ds.events['sim-evt-20261112-b'])).toBe('RECORDING INCOMPLETE')
    const reviewed = { ...ds.events['sim-evt-20261112-a'], review: { ...ds.events['sim-evt-20261112-a'].review, state: 'REVIEWED' as const } }
    expect(focusLabel(reviewed)).toBe('REVIEWED')
  })

  it('titles and summarises each event in one line from its own record', () => {
    expect(eventTitle(ctxOf('sim-evt-20261112-a'))).toBe('Gravity recovery assessment')
    expect(reasonLine(ctxOf('sim-evt-20261112-a'))).toBe('Dizziness self-reported')
    expect(reasonLine(ctxOf('sim-evt-20261113-b'))).toBe('Weakness self-reported')
    expect(eventTitle(ctxOf('dq-sim-b-20261113b'))).toBe('Measurement source check')
    expect(reasonLine(ctxOf('dq-sim-b-20261113b'))).toBe('Source review required · Sensor data stale')
    expect(reasonLine(ctxOf('sim-evt-20261112-b'))).toBe('Insufficient heart-rate samples · Missing baseline')
  })

  it('summarises a watch telemetry flag from the readings the watch cited', () => {
    const e = {
      ...ds.events['sim-evt-20261112-a'],
      sessionId: null,
      reasonCodes: ['WATCH_TELEMETRY_FLAG'],
      evidence: [{ reasonCode: 'WATCH_TELEMETRY_FLAG', kind: 'DEVICE' as const, refId: 'watch-x', note: 'EMU bench feed · Heart rate 142 bpm · priority' }],
    }
    const ctx = buildEventContext(e, ds, NOW)
    expect(eventTitle(ctx)).toBe('Watch telemetry review')
    expect(reasonLine(ctx)).toBe('Watch flagged Heart rate 142 bpm (priority)')
  })

  it('tells what happened in time order, ending with what the watch did', () => {
    const lines = whatHappened(ctxOf('sim-evt-20261112-a'))
    expect(lines[0]).toMatch(/^14:10:00 UTC · Recovery check started/)
    expect(lines.some((l) => /Symptom logged: dizziness/.test(l))).toBe(true)
    const created = lines.findIndex((l) => /Review event created/.test(l))
    const presented = lines.findIndex((l) => /Alert presented on the simulated watch/.test(l))
    expect(created).toBeGreaterThan(-1)
    expect(presented).toBeGreaterThan(created)
  })

  it('separates what the record supports from what it cannot show', () => {
    const c = conclusionsFor(ctxOf('sim-evt-20261112-a'))
    expect(c.supported.join(' ')).toMatch(/Recovery heart rate was 23 bpm above rest/)
    expect(c.supported.join(' ')).toMatch(/12 bpm above this crew member's baseline/)
    expect(c.unsupported).toContain('Heart-rate data alone cannot diagnose orthostatic intolerance.')
    expect(c.unsupported.join(' ')).toMatch(/Blood pressure was not measured/)
    const thin = conclusionsFor(ctxOf('sim-evt-20261112-b'))
    expect(thin.unsupported.join(' ')).toMatch(/too few valid readings/)
    expect(thin.supported.join(' ')).not.toMatch(/bpm above rest/)
  })
})
