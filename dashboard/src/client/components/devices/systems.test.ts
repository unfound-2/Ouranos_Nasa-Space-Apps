import { describe, expect, it } from 'vitest'
import type { WatchFrame } from '../../../shared/watch-link'
import {
  frameIsCurrent,
  latestReadings,
  linkMeta,
  readingsBelongIn,
  resolveSystemKind,
  sparkMetric,
  sparkPoints,
  systemKindFromSource,
  systemLinkState,
} from './systems'

const frame = (over: Partial<WatchFrame> = {}): WatchFrame => ({
  version: 1,
  source: 'Chest strap simulation',
  observedAt: 1_800_000_000,
  simulated: true,
  readings: [
    { metric: 'ECG heart rate', value: 72, unit: 'bpm', quality: 'valid', status: 'nominal', measuredAt: 1_800_000_000 },
    { metric: 'Respiration', value: 15, unit: '/min', quality: 'missing', status: 'nominal' },
  ],
  ...over,
})

describe('system kind from the frame source', () => {
  it('maps every label the mock and the watch send', () => {
    expect(systemKindFromSource('Mock watch simulation')).toBe('ouranos-watch')
    expect(systemKindFromSource('Watch sensors')).toBe('ouranos-watch')
    expect(systemKindFromSource('ISS EMU / Bio-Monitor simulation')).toBe('ouranos-watch')
    expect(systemKindFromSource('Chest strap simulation')).toBe('chest-strap')
    expect(systemKindFromSource('Blood pressure cuff simulation')).toBe('bp-cuff')
    expect(systemKindFromSource('Suit biomonitor simulation')).toBe('suit-biomonitor')
    expect(systemKindFromSource('Chest strap')).toBe('chest-strap')
  })

  it('ignores case and extra spaces', () => {
    expect(systemKindFromSource('  chest   STRAP simulation ')).toBe('chest-strap')
  })

  it('treats anything unknown as a generic monitoring system', () => {
    expect(systemKindFromSource('Pairing test simulator')).toBe('generic')
    expect(systemKindFromSource('')).toBe('generic')
    expect(systemKindFromSource(null)).toBe('generic')
    expect(systemKindFromSource('chest strap simulation v2')).toBe('generic')
  })

  it('lets the latest frame win over the kind saved at pairing', () => {
    expect(resolveSystemKind(frame({ source: 'Suit biomonitor simulation' }), 'bp-cuff')).toBe('suit-biomonitor')
    expect(resolveSystemKind(frame({ source: 'Something new' }), 'bp-cuff')).toBe('generic')
    expect(resolveSystemKind(null, 'bp-cuff')).toBe('bp-cuff')
    expect(resolveSystemKind(null, 'toaster')).toBe('generic')
    expect(resolveSystemKind(undefined)).toBe('generic')
  })
})

describe('system link state', () => {
  const nowMs = 1_800_000_100_000
  it('is not paired when the server no longer lists the link', () => {
    expect(systemLinkState({ listed: false, serverLink: 'VERIFIED', lastFrameAt: nowMs / 1000, nowMs })).toBe('NOT_PAIRED')
  })
  it('is verified by a server heartbeat or a frame within 60 s', () => {
    expect(systemLinkState({ listed: true, serverLink: 'VERIFIED', nowMs })).toBe('VERIFIED')
    expect(systemLinkState({ listed: true, lastFrameAt: nowMs / 1000 - 60, nowMs })).toBe('VERIFIED')
  })
  it('is unreachable after 60 s without contact', () => {
    expect(systemLinkState({ listed: true, serverLink: 'WATCH_UNREACHABLE', lastFrameAt: nowMs / 1000 - 61, nowMs })).toBe('WATCH_UNREACHABLE')
    expect(systemLinkState({ listed: true, nowMs })).toBe('WATCH_UNREACHABLE')
  })
  it('keeps the watch wording for the watch and drops it for other systems', () => {
    expect(linkMeta('WATCH_UNREACHABLE', 'ouranos-watch').label).toBe('Watch unreachable')
    expect(linkMeta('WATCH_UNREACHABLE', 'chest-strap').label).toBe('System unreachable')
    expect(linkMeta('WATCH_UNREACHABLE', 'chest-strap').tone).toBe('amber')
  })
})

describe('system readings', () => {
  it('keeps unit, time, source, quality and the simulated flag, and a missing value stays null', () => {
    const [hr, resp] = latestReadings(frame())
    expect(hr).toMatchObject({ metric: 'ECG heart rate', value: 72, unit: 'bpm', quality: 'valid', time: 1_800_000_000, source: 'Chest strap simulation', simulated: true })
    expect(resp.value).toBeNull()
    expect(resp.quality).toBe('missing')
    expect(resp.time).toBe(1_800_000_000)
  })

  it('a frame is current only within its declared freshness', () => {
    const f = frame({ freshnessSeconds: 20 })
    expect(frameIsCurrent(f, (f.observedAt + 20) * 1000)).toBe(true)
    expect(frameIsCurrent(f, (f.observedAt + 21) * 1000)).toBe(false)
    expect(frameIsCurrent(frame(), (f.observedAt + 16) * 1000)).toBe(false)
  })

  it('the sparkline follows heart rate and leaves gaps for invalid readings', () => {
    expect(sparkMetric(frame())).toEqual({ metric: 'ECG heart rate', unit: 'bpm' })
    const cuff = frame({ readings: [{ metric: 'Systolic blood pressure', value: 118, unit: 'mmHg', quality: 'valid', status: 'nominal' }] })
    expect(sparkMetric(cuff)).toEqual({ metric: 'Systolic blood pressure', unit: 'mmHg' })
    const frames = [
      frame({ observedAt: 1_800_000_004, readings: [{ metric: 'ECG heart rate', value: 75, unit: 'bpm', quality: 'valid', status: 'nominal' }] }),
      frame({ observedAt: 1_800_000_002, readings: [{ metric: 'ECG heart rate', value: 0, unit: 'bpm', quality: 'suspect', status: 'nominal' }] }),
      frame({ observedAt: 1_800_000_000, readings: [{ metric: 'ECG heart rate', value: 72, unit: 'bpm', quality: 'valid', status: 'nominal' }] }),
    ]
    expect(sparkPoints(frames, 'ECG heart rate', 'bpm')).toEqual([
      { t: 1_800_000_000_000, v: 72 },
      { t: 1_800_000_002_000, v: null },
      { t: 1_800_000_004_000, v: 75 },
    ])
  })

  it('shows simulated readings only in the demo and real ones only with mission records', () => {
    expect(readingsBelongIn({ simulated: true }, 'demo')).toBe(true)
    expect(readingsBelongIn({ simulated: true }, 'mission')).toBe(false)
    expect(readingsBelongIn({ simulated: false }, 'mission')).toBe(true)
    expect(readingsBelongIn({ simulated: false }, 'demo')).toBe(false)
  })
})
