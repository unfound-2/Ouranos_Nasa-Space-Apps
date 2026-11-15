import { useId, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Tone } from '../lib/view'
import type { RingValue } from './Ring'
import { TONE } from './ui'

/*
 * Dashboard pieces modelled on Tremor (tremor.so, Apache-2.0): the KPI card, the spark area chart,
 * the bar chart and the progress bar, drawn with Recharts like Tremor itself. Every one shows a
 * recorded value or says plainly that there is none.
 */

/** Tremor KPI card: label, metric, one line of context, then an optional chart or bar. */
export function Kpi({
  label,
  value,
  unit,
  sub,
  mark,
  children,
  testId,
  href,
}: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  mark?: ReactNode
  children?: ReactNode
  testId?: string
  href?: string
}) {
  return (
    <section className="panel flex min-w-0 flex-col px-5 pt-4 pb-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <span className="micro">{label}</span>
        {mark}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="figure text-[28px] text-ink">{value}</span>
        {unit && <span className="unit text-[14px]">{unit}</span>}
      </div>
      {sub && <div className="mt-1 min-h-5 truncate text-[13px] text-ink-2">{sub}</div>}
      {children && <div className="mt-auto pt-4">{children}</div>}
      {href && (
        <a href={href} className="absolute inset-0 rounded-[12px]" aria-label={`Open ${label.toLowerCase()}`}>
          <span className="sr-only">Open {label}</span>
        </a>
      )}
    </section>
  )
}

/** Tremor progress bar: a thin track filled to the fraction of two counts. */
export function Progress({ value, tone = 'cyan', label }: { value: RingValue | null; tone?: Tone; label: string }) {
  const pct = value ? Math.round(value.fraction * 100) : null
  return (
    <div>
      <div
        className="h-1.5 overflow-hidden rounded-[2px] bg-raised"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={value?.denominator ?? 0}
        aria-valuenow={value?.numerator ?? 0}
        aria-valuetext={value ? `${value.numerator} of ${value.denominator}` : 'Not available'}
      >
        {value && value.fraction > 0 && <div className="h-full" style={{ width: `${Math.min(100, value.fraction * 100)}%`, background: TONE[tone].stroke }} />}
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-ink-3 tnum">
        <span>{value ? `${value.numerator} of ${value.denominator}` : 'Not available'}</span>
        <span>{pct === null ? '' : `${pct}%`}</span>
      </div>
    </div>
  )
}

/** Tremor SparkAreaChart: a small area line with no axes, for the trend behind a metric. */
export function Spark({ data, tone = 'cyan', height = 44, ariaLabel }: { data: { x: number; y: number }[]; tone?: Tone; height?: number; ariaLabel: string }) {
  const id = useId().replace(/:/g, '')
  const color = TONE[tone].stroke
  if (data.length < 2) return <div className="grid text-[12px] text-ink-3" style={{ height }}>Not enough readings for a trend</div>
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide />
          <YAxis domain={['dataMin - 4', 'dataMax + 4']} hide />
          <Area type="linear" dataKey="y" stroke={color} strokeWidth={1.5} fill={`url(#${id}-fill)`} isAnimationActive={false} dot={false} activeDot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface BarDatum {
  key: string
  label: string
  /** null: nothing to plot (too few readings). */
  value: number | null
  display: string
  tone?: Tone
  current?: boolean
  href?: string
  note?: string
}

function BarTip({ active, payload }: { active?: boolean; payload?: { payload: BarDatum }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-[6px] border border-line bg-panel px-3 py-2 text-[12px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]">
      <div className="font-medium text-ink">{d.label}</div>
      <div className="mt-0.5 text-ink-2 tnum">{d.display}</div>
      {d.note && <div className="mt-0.5 text-ink-3">{d.note}</div>}
    </div>
  )
}

/** Tremor BarChart: thin bars, dashed horizontal grid, no axis lines, a plain tooltip. */
export function Bars({ data, height = 168, unit, ariaLabel, onSelect }: { data: BarDatum[]; height?: number; unit?: string; ariaLabel: string; onSelect?: (d: BarDatum) => void }) {
  const rows = data.map((d) => ({ ...d, plot: d.value ?? 0 }))
  return (
    <div role="img" aria-label={ariaLabel} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: -12 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#1f1f1f" strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#8f8f8f', fontSize: 12 }} dy={6} interval={0} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: '#8f8f8f', fontSize: 12 }} width={44} tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}${unit ? '' : ''}`} allowDecimals={false} />
          <ReferenceLine y={0} stroke="#2e2e2e" />
          <Tooltip content={<BarTip />} cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} isAnimationActive={false} />
          <Bar
            dataKey="plot"
            radius={[3, 3, 0, 0]}
            maxBarSize={30}
            isAnimationActive={false}
            onClick={(entry: unknown) => {
              const d = (entry as { payload?: BarDatum }).payload
              if (d && onSelect) onSelect(d)
            }}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
          >
            {rows.map((d) => (
              <Cell key={d.key} fill={TONE[d.tone ?? 'cyan'].stroke} fillOpacity={d.value === null ? 0 : d.current ? 1 : 0.55} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
