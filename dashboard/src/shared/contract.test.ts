import { describe, expect, it } from 'vitest'
import { isStrictUtcIso, parseHeartbeat, parseMeasurement, parseReviewEvent, parseSession } from './contract'

// Hand-written records in the shape the watch app sends. Swift's JSONEncoder omits nil
// optionals, so several nullable fields are deliberately left out here.
const hr = (id: string, phase: 'REST' | 'RECOVERY', at: string, value: number | null, quality?: string) => ({
  measurementId: id,
  subjectId: 'crew-a',
  sessionId: 'ses-1',
  indicator: 'HEART_RATE',
  value,
  unit: 'bpm',
  measuredAt: at,
  phase,
  source: { kind: 'APPLE_WATCH', device: 'Apple Watch SE', sensor: 'Optical heart sensor (HealthKit)' },
  isSimulated: false,
  quality: quality ?? (value === null ? 'MISSING' : 'VALID'),
})

function session(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'gravityguard.recovery-session.v1',
    sessionId: 'ses-1',
    subjectId: 'crew-a',
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: 'DEVICE_RECORDING',
    isSimulated: false,
    startedAt: '2026-11-14T19:30:00Z',
    endedAt: '2026-11-14T19:32:00Z',
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: '2026-11-14T19:30:05Z', endedAt: '2026-11-14T19:30:50Z' },
      {
        phase: 'RECOVERY',
        startedAt: '2026-11-14T19:31:05Z',
        endedAt: '2026-11-14T19:31:50Z',
        confirmedAt: '2026-11-14T19:31:05Z',
        confirmedBy: 'WEARER',
      },
    ],
    measurements: [
      hr('m1', 'REST', '2026-11-14T19:30:15Z', 70),
      hr('m2', 'REST', '2026-11-14T19:30:25Z', null),
      hr('m3', 'RECOVERY', '2026-11-14T19:31:20Z', 84),
    ],
    symptomCheck: { status: 'REPORTED', answeredAt: '2026-11-14T19:31:55Z' },
    symptoms: [{ symptomId: 'sym-1', code: 'DIZZY', reportedAt: '2026-11-14T19:31:55Z', reportedBy: 'SELF_REPORTED' }],
    provenance: { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' },
    ...overrides,
  }
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'gravityguard.review-event.v1',
    eventId: 'evt-1',
    subjectId: 'crew-a',
    sessionId: 'ses-1',
    createdAt: '2026-11-14T19:31:56Z',
    origin: { kind: 'WATCH_RULES', ruleSet: 'watch-rules 0.1', deviceId: 'watch-1' },
    category: 'REVIEW_SUGGESTED',
    severity: 'REVIEW',
    reasonCodes: ['SYMPTOM_REPORTED'],
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: 'sym-1' }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: {
      channel: 'WATCH_LOCAL',
      state: 'PRESENTED',
      presentedAt: '2026-11-14T19:31:57Z',
      hapticRequested: true,
      confirmedBy: 'WATCH_APP',
    },
    isSimulated: false,
    provenance: { origin: 'WATCH_APP', appVersion: '0.1.0', deviceId: 'watch-1' },
    ...overrides,
  }
}

describe('UTC timestamps', () => {
  it('accepts Swift ISO8601DateFormatter output with and without fractional seconds', () => {
    expect(isStrictUtcIso('2026-11-14T19:30:05Z')).toBe(true)
    expect(isStrictUtcIso('2026-11-14T19:30:05.123Z')).toBe(true)
  })
  it('rejects offsets, missing zone, impossible dates and free text', () => {
    expect(isStrictUtcIso('2026-11-14T19:30:05+02:00')).toBe(false)
    expect(isStrictUtcIso('2026-11-14T19:30:05')).toBe(false)
    expect(isStrictUtcIso('2026-02-30T10:00:00Z')).toBe(false)
    expect(isStrictUtcIso('2026-11-14T24:00:00Z')).toBe(false)
    expect(isStrictUtcIso('yesterday')).toBe(false)
  })
})

describe('recovery session contract', () => {
  it('accepts a well-formed watch session and fills omitted optionals with null', () => {
    const r = parseSession(session())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.phases[0].confirmedAt).toBeNull()
    expect(r.value.summary).toBeNull()
  })

  it('keeps a missing heart-rate reading as null, never zero', () => {
    const r = parseSession(session())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const missing = r.value.measurements.find((m) => m.measurementId === 'm2')
    expect(missing?.value).toBeNull()
    expect(missing?.quality).toBe('MISSING')
  })

  it('rejects a heart rate recorded in mmHg', () => {
    const bad = session({ measurements: [{ ...hr('m1', 'REST', '2026-11-14T19:30:15Z', 70), unit: 'mmHg' }] })
    const r = parseSession(bad)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join(' ')).toMatch(/unit/i)
  })

  it('rejects a session timestamp with a time-zone offset', () => {
    const r = parseSession(session({ startedAt: '2026-11-14T13:30:00-06:00' }))
    expect(r.ok).toBe(false)
  })

  it('rejects a null reading that claims to be VALID', () => {
    const r = parseSession(session({ measurements: [hr('m1', 'REST', '2026-11-14T19:30:15Z', null, 'VALID')] }))
    expect(r.ok).toBe(false)
  })

  it('rejects a session whose simulation flag disagrees with its mode', () => {
    expect(parseSession(session({ mode: 'SIMULATED_DEMO' })).ok).toBe(false)
  })

  it('rejects a simulated measurement inside a real session', () => {
    const r = parseSession(session({ measurements: [{ ...hr('m1', 'REST', '2026-11-14T19:30:15Z', 70), isSimulated: true }] }))
    expect(r.ok).toBe(false)
  })

  it('rejects reported symptoms when the symptom check says none were reported', () => {
    const r = parseSession(session({ symptomCheck: { status: 'NONE_REPORTED', answeredAt: '2026-11-14T19:31:55Z' } }))
    expect(r.ok).toBe(false)
  })

  it('rejects unknown fields so a misspelled key is caught instead of dropped', () => {
    const r = parseSession({ ...session(), started_at: '2026-11-14T19:30:00Z' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join(' ')).toMatch(/started_at/)
  })

  it('rejects a session without an identifier', () => {
    const s = session() as Record<string, unknown>
    delete s.sessionId
    expect(parseSession(s).ok).toBe(false)
  })

  it('rejects an end time before the start time', () => {
    expect(parseSession(session({ endedAt: '2026-11-14T19:29:00Z' })).ok).toBe(false)
  })
})

describe('standalone measurement contract', () => {
  it('accepts an external blood-pressure reading in mmHg', () => {
    const r = parseMeasurement({
      ...hr('bp-1', 'REST', '2026-11-14T19:29:00Z', 118),
      indicator: 'BLOOD_PRESSURE_SYSTOLIC',
      unit: 'mmHg',
      phase: null,
      source: { kind: 'EXTERNAL_INSTRUMENT', device: 'Upper-arm cuff', sensor: null },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a reading taken by the simulator that is not flagged simulated', () => {
    const r = parseMeasurement({ ...hr('m9', 'REST', '2026-11-14T19:29:00Z', 70), source: { kind: 'SIMULATOR', device: null, sensor: null } })
    expect(r.ok).toBe(false)
  })
})

describe('review event contract', () => {
  it('accepts a watch-created, presented event', () => {
    const r = parseReviewEvent(event())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.acknowledgement).toBeNull()
  })

  it('rejects a status that the delivery fields do not support', () => {
    const r = parseReviewEvent(event({ status: 'ACKNOWLEDGED' }))
    expect(r.ok).toBe(false)
  })

  it('rejects an acknowledgement for an alert that was never presented', () => {
    const r = parseReviewEvent(
      event({
        status: 'ACKNOWLEDGED',
        delivery: { channel: 'COMPUTER_TO_WATCH', state: 'WATCH_UNREACHABLE', lastAttemptAt: '2026-11-14T19:31:57Z' },
        acknowledgement: { acknowledgedAt: '2026-11-14T19:32:10Z', via: 'WATCH' },
      }),
    )
    expect(r.ok).toBe(false)
  })

  it('rejects a presented alert without a presentation time', () => {
    const r = parseReviewEvent(event({ delivery: { channel: 'WATCH_LOCAL', state: 'PRESENTED', confirmedBy: 'WATCH_APP' } }))
    expect(r.ok).toBe(false)
  })

  it('does not let a producer claim the event was medically reviewed', () => {
    expect(parseReviewEvent(event({ status: 'REVIEWED' })).ok).toBe(false)
  })

  it('rejects evidence that cites a reason code the event does not carry', () => {
    const r = parseReviewEvent(event({ evidence: [{ reasonCode: 'SENSOR_DATA_STALE', kind: 'SESSION', refId: 'ses-1' }] }))
    expect(r.ok).toBe(false)
  })

  it('keeps reason codes it does not recognise exactly as sent', () => {
    const r = parseReviewEvent(event({ reasonCodes: ['SYMPTOM_REPORTED', 'WATCH_CUSTOM_RULE_7'] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.reasonCodes).toEqual(['SYMPTOM_REPORTED', 'WATCH_CUSTOM_RULE_7'])
  })

  it('rejects a simulated-watch delivery on a real event', () => {
    const r = parseReviewEvent(
      event({ delivery: { channel: 'SIMULATED_WATCH', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', confirmedBy: 'SIMULATION' } }),
    )
    expect(r.ok).toBe(false)
  })
})

/** An object nested `levels` deep, counting itself: nested(1) is {}. Built without recursion. */
function nested(levels: number): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let o = root
  for (let i = 1; i < levels; i++) {
    const next: Record<string, unknown> = {}
    o.a = next
    o = next
  }
  return root
}

const shown = { channel: 'WATCH_LOCAL', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:57Z', hapticRequested: true, confirmedBy: 'WATCH_APP' }

describe('extensions are bounded', () => {
  it('accepts extensions up to 8 levels deep and rejects 9, on sessions and events', () => {
    expect(parseSession(session({ extensions: nested(8) })).ok).toBe(true)
    expect(parseReviewEvent(event({ extensions: nested(8) })).ok).toBe(true)
    const s = parseSession(session({ extensions: nested(9) }))
    expect(s.ok).toBe(false)
    if (!s.ok) expect(s.errors.join('\n')).toMatch(/^extensions: .*8 levels/m)
    expect(parseReviewEvent(event({ extensions: nested(9) })).ok).toBe(false)
    expect(parseSession(session({ extensions: { list: [[[[[[[[1]]]]]]]] } })).ok).toBe(false)
  })

  it('rejects an extensions object nested 200,000 levels deep without overflowing the stack', () => {
    const r = parseReviewEvent(event({ extensions: nested(200_000) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/^extensions: /m)
  })

  it('rejects extensions over 8192 bytes of JSON, counting UTF-8 bytes', () => {
    // {"blob":"..."} adds 11 bytes around the text.
    expect(parseSession(session({ extensions: { blob: 'x'.repeat(8181) } })).ok).toBe(true)
    const big = parseSession(session({ extensions: { blob: 'x'.repeat(8182) } }))
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.errors.join('\n')).toMatch(/^extensions: .*8192 bytes/m)
    // 4100 two-byte characters: 4111 characters, but 8211 bytes.
    expect(parseReviewEvent(event({ extensions: { blob: 'é'.repeat(4100) } })).ok).toBe(false)
  })
})

describe('producer events', () => {
  it('cannot claim to be a mission-computer check', () => {
    const r = parseReviewEvent(event({ origin: { kind: 'MISSION_COMPUTER_CHECK', ruleSet: null, deviceId: null } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/^origin\.kind: /m)
  })

  it('rejects a watch-shown alert presented more than 1 s before it was created', () => {
    // createdAt is 2026-11-14T19:31:56Z; the watch clock produces all three times.
    expect(parseReviewEvent(event({ delivery: { ...shown, presentedAt: '2026-11-14T19:31:55Z' } })).ok).toBe(true)
    const r = parseReviewEvent(event({ delivery: { ...shown, presentedAt: '2026-11-14T19:31:54.500Z' } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/^delivery\.presentedAt: /m)
  })

  it('rejects a watch-shown alert acknowledged before it was created', () => {
    const early = event({
      status: 'ACKNOWLEDGED',
      delivery: { ...shown, presentedAt: '2026-11-14T19:31:55.200Z' },
      acknowledgement: { acknowledgedAt: '2026-11-14T19:31:55.600Z', via: 'WATCH' },
    })
    const r = parseReviewEvent(early)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/^acknowledgement\.acknowledgedAt: /m)
  })

  it('does not apply the watch-clock ordering to alerts the computer sent', () => {
    const r = parseReviewEvent(
      event({ delivery: { channel: 'COMPUTER_TO_WATCH', state: 'PRESENTED', presentedAt: '2026-11-14T19:31:40Z', hapticRequested: null, confirmedBy: 'WATCH_APP' } }),
    )
    expect(r.ok).toBe(true)
  })

  it('carries the device that confirmed the delivery and the acknowledgement, null when left out', () => {
    const left = parseReviewEvent(event())
    expect(left.ok).toBe(true)
    if (left.ok) expect(left.value.delivery.confirmedByDeviceId).toBeNull()
    const r = parseReviewEvent(
      event({
        status: 'ACKNOWLEDGED',
        delivery: { ...shown, confirmedByDeviceId: 'watch-1' },
        acknowledgement: { acknowledgedAt: '2026-11-14T19:32:30Z', via: 'WATCH', deviceId: 'watch-1' },
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect([r.value.delivery.confirmedByDeviceId, r.value.acknowledgement?.deviceId]).toEqual(['watch-1', 'watch-1'])
    expect(parseReviewEvent(event({ delivery: { ...shown, confirmedByDeviceId: 'not an id' } })).ok).toBe(false)
  })
})

describe('heart-rate access and simulated heartbeats', () => {
  it('records whether the watch could read heart rate, null when left out', () => {
    const omitted = parseSession(session())
    expect(omitted.ok).toBe(true)
    if (omitted.ok) expect(omitted.value.heartRateAccess).toBeNull()
    for (const v of ['AUTHORIZED', 'DENIED', 'NOT_DETERMINED', 'UNAVAILABLE', null]) expect(parseSession(session({ heartRateAccess: v })).ok).toBe(true)
    expect(parseSession(session({ heartRateAccess: 'MAYBE' })).ok).toBe(false)
  })

  it('treats a heartbeat as real unless it says isSimulated: true', () => {
    const hb = { deviceId: 'watch-1', sentAt: '2026-11-14T19:40:00Z' }
    const real = parseHeartbeat(hb)
    expect(real.ok && real.value.isSimulated).toBe(false)
    const sim = parseHeartbeat({ ...hb, isSimulated: true })
    expect(sim.ok && sim.value.isSimulated).toBe(true)
    expect(parseHeartbeat({ ...hb, isSimulated: 'yes' }).ok).toBe(false)
  })
})
