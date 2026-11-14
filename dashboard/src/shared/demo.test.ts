import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { comparePhases, personalBaseline } from './analysis'
import { emptyDataset, ingestRecords, resolveEvidence, stableStringify, type Datasets } from './dataset'
import { buildDemoBundle, buildTriggeredDemo, loadDemo } from './demo'

const LOAD_AT = '2026-11-14T19:00:00Z'
const fileBundle = JSON.parse(readFileSync(new URL('../../fixtures/simulated/demo-bundle.json', import.meta.url), 'utf8'))

function loaded(): Datasets {
  const ds: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
  loadDemo(ds, fileBundle, LOAD_AT)
  return ds
}

describe('simulated demo fixtures', () => {
  it('the committed fixture file is exactly what the builder produces', () => {
    expect(stableStringify(fileBundle)).toBe(stableStringify(buildDemoBundle()))
  })

  it('loads only into the demo workspace and every record is simulated', () => {
    const ds = loaded()
    expect(Object.keys(ds.mission.sessions)).toHaveLength(0)
    expect(Object.keys(ds.mission.events)).toHaveLength(0)
    const all = [...Object.values(ds.demo.sessions), ...Object.values(ds.demo.events), ...Object.values(ds.demo.readings)]
    expect(all.length).toBe(7 + 4 + 2)
    expect(all.every((r) => r.isSimulated)).toBe(true)
  })

  it('A: a normal recording with no symptoms and no event, delta +12 bpm', () => {
    const ds = loaded()
    const a = ds.demo.sessions['sim-a-20261111']
    expect(a.symptomCheck.status).toBe('NONE_REPORTED')
    expect(comparePhases(a).observedDelta).toBe(12)
    expect(Object.values(ds.demo.events).some((e) => e.sessionId === a.sessionId)).toBe(false)
  })

  it('B: dizziness event with a +23 bpm delta, 12 bpm above a baseline of three earlier sessions', () => {
    const ds = loaded()
    const b = ds.demo.sessions['sim-a-20261112']
    const c = comparePhases(b)
    expect([c.restMedian, c.recoveryMedian, c.observedDelta]).toEqual([71, 94, 23])
    const base = personalBaseline(b, Object.values(ds.demo.sessions))
    expect([base.status, base.compatibleCount, base.baselineDelta, base.differenceFromBaseline]).toEqual(['ESTABLISHED', 3, 11, 12])
    const evt = ds.demo.events['sim-evt-20261112-a']
    const [ev] = resolveEvidence(evt, ds.demo)
    expect(ev.found && ev.kind === 'SYMPTOM' && ev.symptom.code).toBe('DIZZY')
  })

  it('C: one valid sample per phase, so no comparison is calculated', () => {
    const ds = loaded()
    const c = comparePhases(ds.demo.sessions['sim-b-20261112'])
    expect(c.status).toBe('INSUFFICIENT_SAMPLES')
    expect([c.rest.valid.length, c.recovery.valid.length]).toEqual([1, 1])
  })

  it('D and E: one VERIFY_SOURCE event for the stale, questionable cuff pair, not deliverable to the watch', () => {
    const ds = loaded()
    const e = ds.demo.events['dq-sim-b-20261113b']
    expect(e.category).toBe('VERIFY_SOURCE')
    expect(e.reasonCodes).toEqual(['SOURCE_REVIEW_REQUIRED', 'SENSOR_DATA_STALE'])
    expect(e.status).toBe('WATCH_UNREACHABLE')
    expect(e.createdAt).toBe(LOAD_AT)
  })

  it('F: acknowledged on the simulated watch, not reviewed', () => {
    const e = loaded().demo.events['sim-evt-20261113-b']
    expect(e.status).toBe('ACKNOWLEDGED')
    expect(e.acknowledgement?.via).toBe('SIMULATED_WATCH')
    expect(e.review.state).toBe('NOT_STARTED')
  })

  it('a triggered demo event is simulated, created at the press time, and nothing is dated after it', () => {
    const now = '2026-11-14T20:00:00Z'
    const ds = loaded()
    const { session, event } = buildTriggeredDemo(now)
    const r = ingestRecords(ds, [session, event], { now, path: 'DEMO_TRIGGER' })
    expect(r.results.map((x) => x.outcome)).toEqual(['CREATED', 'CREATED'])
    const json = JSON.stringify([session, event])
    const stamps = [...json.matchAll(/"(\d{4}-\d{2}-\d{2}T[\d:.]+Z)"/g)].map((m) => Date.parse(m[1]))
    expect(Math.max(...stamps)).toBeLessThanOrEqual(Date.parse(now))
    expect(ds.demo.events[event.eventId].isSimulated).toBe(true)
  })
})
