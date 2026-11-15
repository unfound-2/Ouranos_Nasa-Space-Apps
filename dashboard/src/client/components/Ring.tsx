import type { Tone } from '../lib/view'
import { TONE } from './ui'

export interface RingValue {
  fraction: number
  numerator: number
  denominator: number
}

/**
 * A radial gauge for a ratio that is fully explained by its counts. It never shows a health
 * score: the caption says what is being counted, and N/A appears when it cannot be.
 */
export function Ring({
  value,
  tone,
  label,
  caption,
  unavailable = 'Insufficient data',
  size = 96,
}: {
  value: RingValue | null
  tone: Tone
  label: string
  caption: string
  unavailable?: string
  size?: number
}) {
  const stroke = 5
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const cx = size / 2
  const pct = value ? Math.round(value.fraction * 100) : null
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}: ${pct === null ? unavailable : `${pct} percent, ${value?.numerator} of ${value?.denominator}`}`}>
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-raised)" strokeWidth={stroke} />
          {value && value.fraction > 0 && (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={TONE[tone].stroke}
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - value.fraction)}
              transform={`rotate(-90 ${cx} ${cx})`}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          {pct !== null ? (
            <div>
              <div className="figure text-ink" style={{ fontSize: Math.round(size * 0.24) }}>
                {pct}
                <span className="unit ml-px text-[0.5em]">%</span>
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-3 tnum">
                {value!.numerator}/{value!.denominator}
              </div>
            </div>
          ) : (
            <div className="px-4">
              <div className="figure text-ink-3" style={{ fontSize: Math.round(size * 0.18) }}>
                N/A
              </div>
              <div className="mt-0.5 text-[9.5px] leading-tight text-ink-3">{unavailable}</div>
            </div>
          )}
        </div>
      </div>
      <figcaption className="max-w-[20ch]">
        <div className="text-[12px] font-semibold text-ink">{label}</div>
        <div className="text-[11px] leading-snug text-ink-3">{caption}</div>
      </figcaption>
    </figure>
  )
}
