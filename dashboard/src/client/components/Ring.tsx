import type { Tone } from '../lib/view'
import { TONE } from './ui'

export interface RingValue {
  fraction: number
  numerator: number
  denominator: number
}

/** "4 of 5, 80 percent" or the reason it cannot be counted, for screen readers. */
export function meterLabel(label: string, value: RingValue | null, unavailable: string) {
  return `${label}: ${value ? `${value.numerator} of ${value.denominator}, ${Math.round(value.fraction * 100)} percent` : unavailable}`
}

/** A thin bar for a ratio of two counts. */
export function MeterBar({ value, tone, className = '' }: { value: RingValue | null; tone: Tone; className?: string }) {
  return (
    <span className={`block h-[5px] overflow-hidden rounded-[1px] bg-hair ${className}`} aria-hidden>
      {value && value.fraction > 0 && <span className="block h-full" style={{ width: `${Math.min(100, value.fraction * 100)}%`, background: TONE[tone].stroke }} />}
    </span>
  )
}

/**
 * A ratio that is fully explained by its counts: "4 / 5" over a thin bar. It never shows a
 * health score: the caption says what is being counted, and N/A appears when it cannot be.
 */
export function Meter({
  value,
  tone,
  label,
  caption,
  unavailable = 'Insufficient data',
}: {
  value: RingValue | null
  tone: Tone
  label: string
  caption: string
  unavailable?: string
}) {
  const pct = value ? Math.round(value.fraction * 100) : null
  return (
    <figure className="min-w-0" role="img" aria-label={meterLabel(label, value, unavailable)}>
      <div className="flex items-baseline justify-between gap-3">
        <figcaption className="text-[12.5px] font-semibold text-ink">{label}</figcaption>
        <span className={`text-[15px] font-semibold tnum ${value ? 'text-ink' : 'text-ink-3'}`}>{value ? `${value.numerator} / ${value.denominator}` : 'N/A'}</span>
      </div>
      <MeterBar value={value} tone={tone} className="mt-1.5" />
      <div className="mt-1 flex items-baseline justify-between gap-3 text-[11.5px] text-ink-3">
        <span>{value ? caption : unavailable}</span>
        {pct !== null && <span className="tnum">{pct}%</span>}
      </div>
    </figure>
  )
}
