import { describe, expect, it } from 'vitest'
import { ago, plural, signed, utcStamp, utcTime } from './format'

describe('format', () => {
  it('signs whole numbers with a true minus sign', () => {
    expect([signed(23), signed(-4), signed(0)]).toEqual(['+23', '−4', '0'])
  })
  it('keeps the half of a median instead of rounding it away', () => {
    expect(signed(11.5)).toBe('+11.5')
    expect(signed(-0.5)).toBe('−0.5')
  })
  it('shows UTC regardless of the machine time zone', () => {
    expect(utcTime('2026-11-12T14:11:55Z')).toBe('14:11:55 UTC')
    expect(utcStamp('2026-11-12T14:11:55.250Z')).toBe('2026-11-12 14:11:55Z')
  })
  it('pluralises counts', () => {
    expect([plural(1, 'reading'), plural(3, 'reading')]).toEqual(['1 reading', '3 readings'])
  })
  it('describes ages coarsely', () => {
    const now = Date.parse('2026-11-14T12:00:00Z')
    expect(ago('2026-11-14T11:59:30Z', now)).toBe('30 s ago')
    expect(ago('2026-11-14T09:00:00Z', now)).toBe('3 h 0 min ago')
  })
})
