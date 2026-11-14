import { describe, expect, it } from 'vitest'
import {
  comparePhases,
  freshnessAt,
  externalReadingFindings,
  hrCoverage,
  median,
  personalBaseline,
  sessionCompleteness,
  summarizePhase,
} from './analysis'
import { buildExternalReading, buildSession } from './testing'

describe('median', () => {
  it('three rest samples [70, 72, 74] give 72 bpm', () => {
    expect(median([70, 72, 74])).toBe(72)
  })
  it('three recovery samples [82, 84, 86] give 84 bpm', () => {
    expect(median([82, 84, 86])).toBe(84)
  })
  it('does not depend on sample order', () => {
    expect(median([74, 70, 72])).toBe(72)
  })
  it('averages the middle pair for an even count', () => {
    expect(median([70, 71, 73, 80])).toBe(72)
  })
  it('has no median for an empty list', () => {
    expect(median([])).toBeNull()
  })
})

describe('phase comparison', () => {
  it('reports the descriptive delta of +12 bpm for [70,72,74] -> [82,84,86]', () => {
    const c = comparePhases(buildSession({ rest: [70, 72, 74], recovery: [82, 84, 86] }))
    expect(c.status).toBe('CALCULATED')
    expect(c.restMedian).toBe(72)
    expect(c.recoveryMedian).toBe(84)
    expect(c.observedDelta).toBe(12)
  })

  it('refuses to calculate a delta from one sample per phase', () => {
    const c = comparePhases(buildSession({ rest: [70], recovery: [90] }))
    expect(c.status).toBe('INSUFFICIENT_SAMPLES')
    expect(c.observedDelta).toBeNull()
    expect(c.restMedian).toBeNull()
    expect(c.recoveryMedian).toBeNull()
  })

  it('never turns a missing reading into zero', () => {
    // If the two nulls were counted as 0 bpm the median would be 70, not 72.
    const s = summarizePhase(buildSession({ rest: [70, null, 72, null, 74] }), 'REST')
    expect(s.median).toBe(72)
    expect(s.valid).toHaveLength(3)
    expect(s.excluded.map((e) => e.reason)).toEqual(['NO_VALUE', 'NO_VALUE'])
  })

  it('leaves out readings the source marked invalid or questionable', () => {
    const s = summarizePhase(buildSession({ rest: [70, 72, 74, { v: 200, q: 'INVALID' }, { v: 190, q: 'QUESTIONABLE' }] }), 'REST')
    expect(s.median).toBe(72)
    expect(s.excluded.map((e) => e.reason)).toEqual(['QUALITY_INVALID', 'QUALITY_QUESTIONABLE'])
  })

  it('leaves out a rest-tagged reading timestamped inside the recovery phase', () => {
    const s = summarizePhase(
      buildSession({ rest: [70, 72, 74, { at: '2026-11-14T19:31:20Z', v: 120 }] }),
      'REST',
    )
    expect(s.median).toBe(72)
    expect(s.excluded.map((e) => e.reason)).toEqual(['OUTSIDE_PHASE_WINDOW'])
  })

  it('cannot use readings for a phase that has no recorded start', () => {
    const s = summarizePhase(buildSession({ rest: [70, 72, 74], restPhase: 'absent' }), 'REST')
    expect(s.median).toBeNull()
    expect(s.excluded.map((e) => e.reason)).toEqual(['PHASE_NOT_RECORDED', 'PHASE_NOT_RECORDED', 'PHASE_NOT_RECORDED'])
  })

  it('reports the phase duration from its recorded start and end', () => {
    expect(summarizePhase(buildSession({ rest: [70] }), 'REST').durationSeconds).toBe(45)
    expect(summarizePhase(buildSession({ rest: [70], restPhase: 'open' }), 'REST').durationSeconds).toBeNull()
  })
})

describe('heart-rate coverage', () => {
  it('counts the 10-second intervals in each phase that hold a valid reading', () => {
    // Rest 19:30:05-19:30:50 is 5 intervals; readings at +8, +13 and +18 s fall in the first two.
    // Recovery 19:31:05-19:31:50 is 5 intervals; readings every 5 s from +68 s cover all of them.
    const s = buildSession({ rest: [70, 71, 72], recovery: [80, 81, 82, 83, 84, 85, 86, 87, 88] })
    const c = hrCoverage(s)
    expect(c.status).toBe('CALCULATED')
    expect(c.totalIntervals).toBe(10)
    expect(c.coveredIntervals).toBe(7)
    expect(c.fraction).toBeCloseTo(0.7)
  })

  it('is not available when no phase has both a start and an end', () => {
    const s = buildSession({ rest: [70, 71, 72], restPhase: 'open', recoveryPhase: 'absent' })
    expect(hrCoverage(s).status).toBe('NOT_AVAILABLE')
    expect(hrCoverage(s).fraction).toBeNull()
  })
})

describe('session completeness', () => {
  it('counts all five protocol steps for a finished session', () => {
    const c = sessionCompleteness(buildSession({ rest: [70], recovery: [80] }))
    expect([c.done, c.total]).toEqual([5, 5])
  })

  it('does not count an unanswered symptom check or an open recovery phase', () => {
    const c = sessionCompleteness(
      buildSession({ rest: [70], recovery: [80], symptomStatus: 'NOT_ASKED', recoveryPhase: 'open' }),
    )
    expect([c.done, c.total]).toEqual([3, 5])
    expect(c.steps.filter((s) => !s.done).map((s) => s.id)).toEqual(['RECOVERY_RECORDED', 'SYMPTOM_CHECK'])
  })
})

describe('personal baseline', () => {
  const prior = (id: string, day: number, rest: number[], recovery: number[], extra = {}) =>
    buildSession({ sessionId: id, startedAt: `2026-11-${String(day).padStart(2, '0')}T15:00:00Z`, rest, recovery, ...extra })
  const current = prior('now', 13, [70, 70, 70], [94, 94, 94])

  it('is established from three prior comparable sessions and reported descriptively', () => {
    const history = [prior('a', 9, [70, 70, 70], [79, 79, 79]), prior('b', 10, [70, 70, 70], [81, 81, 81]), prior('c', 11, [70, 70, 70], [82, 82, 82])]
    const b = personalBaseline(current, [...history, current])
    expect(b.status).toBe('ESTABLISHED')
    expect(b.baselineDelta).toBe(11)
    expect(b.currentDelta).toBe(24)
    expect(b.differenceFromBaseline).toBe(13)
  })

  it('is not established from two comparable sessions', () => {
    const history = [prior('a', 9, [70, 70, 70], [79, 79, 79]), prior('b', 10, [70, 70, 70], [81, 81, 81])]
    const b = personalBaseline(current, [...history, current])
    expect(b.status).toBe('NOT_ESTABLISHED')
    expect(b.compatibleCount).toBe(2)
    expect(b.baselineDelta).toBeNull()
  })

  it('never counts simulated, other-protocol, later or insufficient sessions toward a real baseline', () => {
    const history = [
      prior('a', 9, [70, 70, 70], [79, 79, 79]),
      prior('b', 10, [70, 70, 70], [81, 81, 81]),
      prior('sim', 11, [70, 70, 70], [82, 82, 82], { isSimulated: true }),
      prior('train', 11, [70, 70, 70], [82, 82, 82], { protocolId: 'TRAINING_DEMO' }),
      prior('thin', 12, [70], [82]),
      prior('later', 14, [70, 70, 70], [82, 82, 82]),
    ]
    const b = personalBaseline(current, [...history, current])
    expect(b.status).toBe('NOT_ESTABLISHED')
    expect(b.compatibleCount).toBe(2)
    expect(Object.fromEntries(b.excluded.map((e) => [e.sessionId, e.reason]))).toEqual({
      sim: 'SIMULATION_MISMATCH',
      train: 'DIFFERENT_PROTOCOL',
      thin: 'INSUFFICIENT_SAMPLES',
      later: 'NOT_EARLIER',
    })
  })

  it('ignores other crew members', () => {
    const history = [1, 2, 3].map((i) => prior(`b${i}`, 8 + i, [70, 70, 70], [80, 80, 80], { subjectId: 'crew-b' }))
    expect(personalBaseline(current, [...history, current]).compatibleCount).toBe(0)
  })
})

describe('external readings', () => {
  const session = buildSession({ rest: [70, 72, 74], recovery: [82, 84, 86] })

  it('flags a cuff reading taken six hours before the session as stale', () => {
    const r = buildExternalReading({ measurementId: 'bp-1', sessionId: 'ses-1', measuredAt: '2026-11-14T13:30:00Z', value: 118 })
    expect(externalReadingFindings(session, [r]).map((f) => f.reasonCode)).toEqual(['SENSOR_DATA_STALE'])
  })

  it('flags a reading its instrument marked questionable', () => {
    const r = buildExternalReading({ measurementId: 'bp-2', sessionId: 'ses-1', measuredAt: '2026-11-14T19:29:00Z', value: 118, quality: 'QUESTIONABLE' })
    expect(externalReadingFindings(session, [r]).map((f) => f.reasonCode)).toEqual(['SOURCE_REVIEW_REQUIRED'])
  })

  it('raises nothing for a valid reading taken during the session', () => {
    const r = buildExternalReading({ measurementId: 'bp-3', sessionId: 'ses-1', measuredAt: '2026-11-14T19:31:00Z', value: 118 })
    expect(externalReadingFindings(session, [r])).toEqual([])
  })
})

describe('review fixes: analysis', () => {
  it('coverage ignores a phase window that cannot be real (a reset watch clock) and stays fast', () => {
    const s = buildSession({ rest: [70, 71, 72], recovery: [80, 81, 82, 83, 84, 85, 86, 87, 88] })
    s.phases[0] = { ...s.phases[0], startedAt: '2001-01-01T00:00:00Z' }
    const t0 = Date.now()
    const c = hrCoverage(s)
    expect(Date.now() - t0).toBeLessThan(200)
    expect(c.totalIntervals).toBe(5)
    expect(c.coveredIntervals).toBe(5)
  })

  it('does not call a cuff reading "after the session ended" while the session is still in progress', () => {
    const s = buildSession({ rest: [70, 72, 74], endReason: 'IN_PROGRESS' })
    const r = buildExternalReading({ measurementId: 'bp-9', sessionId: 'ses-1', measuredAt: '2026-11-14T20:10:00Z', value: 118 })
    expect(externalReadingFindings(s, [r])).toEqual([])
  })

  it('judges freshness from the latest reading at or before the event, never a later one', () => {
    const s = buildSession({ rest: [70, 72, 74], recovery: [82, 84, 86, 88, 90, 92, 94, 96, 98] })
    // Event raised at 19:31:20, while recovery readings continued until 19:31:48.
    const f = freshnessAt(s, '2026-11-14T19:31:20Z')
    expect(f.latestValidAt).toBe('2026-11-14T19:31:18Z')
    expect(f.ageSeconds).toBe(2)
    expect(f.laterValidReadings).toBe(6)
  })
})
