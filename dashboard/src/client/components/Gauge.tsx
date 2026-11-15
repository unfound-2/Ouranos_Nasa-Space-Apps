import { useId, type ReactNode } from 'react'
import type { Tone } from '../lib/view'
import type { RingValue } from './Ring'
import { TONE } from './ui'

/*
 * Instruments in the style of the team's references: a dial with ticks and a needle (the Ts-3002
 * console), ring gauges, glowing line bars and dotted column bars (the NASA dashboard). Every one
 * shows a real recorded value or says plainly that there is none; none of them invents a score.
 */

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const s = polar(cx, cy, r, from)
  const e = polar(cx, cy, r, to)
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${e.x} ${e.y}`
}

/** A dial: 240 degrees of track, tick marks, a needle at the value, the reading in the middle. */
export function Dial({
  value,
  min,
  max,
  unit,
  label,
  caption,
  tone = 'cyan',
  unavailable = 'No reading',
  size = 168,
  majorStep,
  testId,
}: {
  value: number | null
  min: number
  max: number
  unit: string
  label: string
  caption?: ReactNode
  tone?: Tone
  unavailable?: string
  size?: number
  /** Distance between labelled ticks, in the value's unit. */
  majorStep?: number
  testId?: string
}) {
  const id = useId()
  const c = size / 2
  const r = size / 2 - 16
  const from = -120
  const to = 120
  const color = TONE[tone].stroke
  const v = value === null ? null : Math.min(max, Math.max(min, value))
  const deg = v === null ? null : from + ((v - min) / (max - min)) * (to - from)
  const step = majorStep ?? (max - min) / 4
  const majors: number[] = []
  for (let t = min; t <= max + 1e-9; t += step) majors.push(t)
  const minors: number[] = []
  for (let t = min; t <= max + 1e-9; t += step / 5) minors.push(t)
  const angle = (t: number) => from + ((t - min) / (max - min)) * (to - from)
  return (
    <figure className="flex min-w-0 flex-col items-center" data-testid={testId}>
      <svg
        width={size}
        height={size * 0.86}
        viewBox={`0 0 ${size} ${size * 0.86}`}
        role="img"
        aria-label={`${label}: ${value === null ? unavailable : `${value} ${unit}`}`}
        className="overflow-visible"
      >
        <defs>
          <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {minors.map((t, i) => {
          const a = polar(c, c, r + 9, angle(t))
          const b = polar(c, c, r + 5, angle(t))
          return <line key={`m${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgb(238 243 250 / 0.16)" strokeWidth={1} />
        })}
        {majors.map((t, i) => {
          const a = polar(c, c, r + 11, angle(t))
          const b = polar(c, c, r + 3, angle(t))
          return <line key={`M${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgb(238 243 250 / 0.42)" strokeWidth={1.25} />
        })}
        <path d={arc(c, c, r - 4, from, to)} fill="none" stroke="rgb(238 243 250 / 0.08)" strokeWidth={3} strokeLinecap="round" />
        {deg !== null && deg > from && <path d={arc(c, c, r - 4, from, deg)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" filter={`url(#${id}-glow)`} />}
        {deg !== null && (
          <g>
            <line x1={polar(c, c, 14, deg).x} y1={polar(c, c, 14, deg).y} x2={polar(c, c, r - 12, deg).x} y2={polar(c, c, r - 12, deg).y} stroke={color} strokeWidth={2} strokeLinecap="round" filter={`url(#${id}-glow)`} />
            <circle cx={c} cy={c} r={4} fill="var(--color-void)" stroke={color} strokeWidth={1.5} />
          </g>
        )}
        <text x={c} y={c + r * 0.52} textAnchor="middle" className="figure" fill={value === null ? 'var(--color-ink-3)' : 'var(--color-ink)'} fontSize={value === null ? size * 0.13 : size * 0.17}>
          {value === null ? 'N/A' : value}
        </text>
        <text x={c} y={c + r * 0.52 + 15} textAnchor="middle" fill="var(--color-ink-3)" fontSize={10.5} fontWeight={500}>
          {value === null ? unavailable : unit}
        </text>
      </svg>
      <figcaption className="-mt-1 text-center">
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {caption && <div className="mt-0.5 max-w-[22ch] text-[11px] leading-snug text-ink-3">{caption}</div>}
      </figcaption>
    </figure>
  )
}

/** A ring for a ratio of two counts, e.g. 5 of 5 protocol steps. N/A with the reason otherwise. */
export function RingGauge({
  value,
  tone = 'cyan',
  label,
  caption,
  unavailable = 'Insufficient data',
  size = 112,
  testId,
}: {
  value: RingValue | null
  tone?: Tone
  label: string
  caption?: ReactNode
  unavailable?: string
  size?: number
  testId?: string
}) {
  const id = useId()
  const stroke = 5
  const r = size / 2 - stroke - 4
  const circ = 2 * Math.PI * r
  const c = size / 2
  const color = TONE[tone].stroke
  const pct = value ? Math.round(value.fraction * 100) : null
  return (
    <figure className="flex min-w-0 flex-col items-center gap-2 text-center" data-testid={testId}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${value ? `${value.numerator} of ${value.denominator}, ${pct} percent` : unavailable}`}>
          <defs>
            <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx={c} cy={c} r={r + 7} fill="none" stroke="rgb(238 243 250 / 0.06)" strokeWidth={1} strokeDasharray="1 4" />
          <circle cx={c} cy={c} r={r} fill="none" stroke="rgb(238 243 250 / 0.08)" strokeWidth={stroke} />
          {value && value.fraction > 0 && (
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - Math.min(1, value.fraction))}
              transform={`rotate(-90 ${c} ${c})`}
              filter={`url(#${id}-glow)`}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          {value ? (
            <div>
              <div className="figure text-ink" style={{ fontSize: Math.round(size * 0.22) }}>
                {pct}
                <span className="unit ml-0.5 text-[0.5em]">%</span>
              </div>
              <div className="mt-1 text-[11px] text-ink-3 tnum">
                {value.numerator} / {value.denominator}
              </div>
            </div>
          ) : (
            <div className="px-3">
              <div className="figure text-ink-3" style={{ fontSize: Math.round(size * 0.16) }}>
                N/A
              </div>
              <div className="mt-1 text-[10px] leading-tight text-ink-3">{unavailable}</div>
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {caption && <div className="mt-0.5 max-w-[20ch] text-[11px] leading-snug text-ink-3">{caption}</div>}
      </figcaption>
    </figure>
  )
}

/** A label, a thin glowing line filled to the fraction, and the value: the reference's "by purpose" rows. */
export function BarRow({ label, value, fraction, tone = 'cyan', detail, testId }: { label: ReactNode; value: ReactNode; fraction: number | null; tone?: Tone; detail?: ReactNode; testId?: string }) {
  const color = TONE[tone].stroke
  const f = fraction === null ? null : Math.min(1, Math.max(0, fraction))
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[12.5px] text-ink-2">{label}</span>
        <span className="shrink-0 text-[13px] font-semibold text-ink tnum">{value}</span>
      </div>
      <div className="relative mt-2 h-[2px] rounded-full bg-white/[0.08]" aria-hidden>
        {f !== null && f > 0 && (
          <>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${f * 100}%`, background: `linear-gradient(90deg, color-mix(in oklab, ${color} 25%, transparent), ${color})`, boxShadow: `0 0 8px ${color}` }} />
            <div className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${f * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }} />
          </>
        )}
      </div>
      {detail && <div className="mt-1.5 text-[11px] text-ink-3">{detail}</div>}
    </div>
  )
}

export interface ColumnDatum {
  key: string
  label: string
  /** null draws an empty column: no value was recorded. */
  value: number | null
  display: string
  tone?: Tone
  /** Emphasise this column, e.g. the latest session. */
  current?: boolean
  href?: string
}

/** Columns filled with a dot grid and capped with a glowing dot (the reference's "by country" chart). */
export function DottedColumns({ data, max, height = 132, ariaLabel }: { data: ColumnDatum[]; max: number; height?: number; ariaLabel: string }) {
  const id = useId()
  return (
    <div role="img" aria-label={ariaLabel} className="flex items-end gap-3">
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <pattern id={`${id}-dots`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect x="1" y="1" width="2.2" height="2.2" rx="0.6" fill="rgb(238 243 250 / 0.22)" />
          </pattern>
        </defs>
      </svg>
      {data.map((d) => {
        const color = TONE[d.tone ?? 'cyan'].stroke
        const h = d.value === null || max <= 0 ? 0 : Math.max(10, (Math.max(0, d.value) / max) * (height - 18))
        const col = (
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className={`text-[11px] tnum ${d.current ? 'font-semibold text-ink' : 'text-ink-3'}`}>{d.display}</span>
            <svg width={32} height={height} viewBox={`0 0 32 ${height}`} aria-hidden className="overflow-visible">
              <rect x="2" y="0" width="28" height={height} rx="9" fill="rgb(255 255 255 / 0.025)" stroke="rgb(150 180 220 / 0.1)" />
              {h > 0 && (
                <>
                  <rect x="2" y={height - h} width="28" height={h} rx="9" fill={`url(#${id}-dots)`} stroke={d.current ? color : 'rgb(150 180 220 / 0.22)'} />
                  <circle cx="16" cy={height - h + 8} r="4.2" fill={color} style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
                </>
              )}
            </svg>
            <span className={`max-w-full truncate text-[11px] ${d.current ? 'text-ink' : 'text-ink-3'}`}>{d.label}</span>
          </div>
        )
        return d.href ? (
          <a key={d.key} href={d.href} className="flex min-w-0 flex-1 rounded-[10px] transition-colors hover:bg-white/[0.03]" aria-label={`${d.label}: ${d.display}`}>
            {col}
          </a>
        ) : (
          <div key={d.key} className="flex min-w-0 flex-1">
            {col}
          </div>
        )
      })}
    </div>
  )
}
