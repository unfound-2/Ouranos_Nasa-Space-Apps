import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyDataset, type Datasets } from './dataset'
import { loadDemo } from './demo'
import { buildEventContext, explainEvent, knownsAndUnknowns, reasonInfo, timelineFor } from './explain'

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
