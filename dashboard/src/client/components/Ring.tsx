import { useEffect, useState } from 'react'
import type { Tone } from '../lib/view'
import { TONE } from './ui'

export interface RingValue {
  fraction: number
  numerator: number
  denominator: number
}

/**
 * A radial indicator for a ratio that is fully explained by its counts. It never shows a
 * health score: the caption says what is being counted, and N/A appears when it cannot be.
 */
export function Ring({
  value,
  tone,
  label,
  caption,
  unavailable = 'Insufficient data',
  size = 136,
}: {
  value: RingValue | null
  tone: Tone
  label: string
  caption: string
  unavailable?: string
  size?: number
}) {
  const stroke = 6
  const r = size / 2 - stroke - 7
  const c = 2 * Math.PI * r
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value?.fraction ?? 0))
    return () => cancelAnimationFrame(id)
  }, [value?.fraction])
  const pct = value ? Math.round(value.fraction * 100) : null
  const ticks = Array.from({ length: 60 }, (_, i) => i)
  const cx = size / 2
  return (
    <figure className="flex min-w-0 flex-col items-center gap-3 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}: ${pct === null ? unavailable : `${pct} percent, ${value?.numerator} of ${value?.denominator}`}`}>
          {ticks.map((i) => {
            const a = (i / 60) * Math.PI * 2 - Math.PI / 2
            const long = i % 5 === 0
            const r1 = size / 2 - 3
            const r2 = r1 - (long ? 5 : 2.5)
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * r1}
                y1={cx + Math.sin(a) * r1}
                x2={cx + Math.cos(a) * r2}
                y2={cx + Math.sin(a) * r2}
                stroke="var(--color-ink-3)"
                strokeOpacity={long ? 0.55 : 0.25}
                strokeWidth={1}
              />
            )
          })}
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
          {value && (
            <circle
              cx={cx}
              cy={cx}
              r={r}
              fill="none"
              stroke={TONE[tone].stroke}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - shown)}
              transform={`rotate(-90 ${cx} ${cx})`}
              style={{ transition: 'stroke-dashoffset 1200ms var(--ease-out-expo)', filter: `drop-shadow(0 0 6px color-mix(in oklab, ${TONE[tone].stroke} 45%, transparent))` }}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          {pct !== null ? (
            <div>
              <div className="figure text-ink" style={{ fontSize: Math.round(size * 0.235) }}>
                {pct}
                <span className="unit ml-0.5 text-[0.5em]">%</span>
              </div>
              <div className="micro mt-1 tnum">
                {value!.numerator} / {value!.denominator}
              </div>
            </div>
          ) : (
            <div className="px-6">
              <div className="figure text-ink-3" style={{ fontSize: Math.round(size * 0.17) }}>
                N/A
              </div>
              <div className="micro mt-1 text-[8.5px] leading-tight">{unavailable}</div>
            </div>
          )}
        </div>
      </div>
      <figcaption className="max-w-[22ch]">
        <div className="label text-[10.5px] text-ink">{label}</div>
        <div className="mt-1 text-[11px] leading-snug text-ink-3">{caption}</div>
      </figcaption>
    </figure>
  )
}
