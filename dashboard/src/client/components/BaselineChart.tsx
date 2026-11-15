import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { signed, utcDate, utcStamp } from '../../shared/format'

interface Pt {
  t: number
  v: number
  sessionId: string
  startedAt: string
  current: boolean
}

const C = { cyan: 'var(--color-cyan)', ink: 'var(--color-ink)', ink2: 'var(--color-ink-2)', ink3: 'var(--color-ink-3)', line: 'var(--color-line)', hair: 'var(--color-hair)', panel: 'var(--color-panel)' }

function evenTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  const step = span <= 20 ? 5 : span <= 50 ? 10 : 20
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}

type ShapeProps = { cx?: number; cy?: number; payload?: Pt }
const Dot = ({ cx = 0, cy = 0, payload }: ShapeProps) =>
  payload?.current ? (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={9} fill="none" stroke={C.ink} strokeOpacity={0.4} />
      <circle cx={cx} cy={cy} r={5.5} fill={C.ink} stroke={C.panel} strokeWidth={2} />
      <text x={cx - 12} y={cy + 4} textAnchor="end" fill={C.ink} fontSize={10.5} fontWeight={700}>
        this session {signed(payload.v)}
      </text>
    </g>
  ) : (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="transparent" />
      <circle cx={cx} cy={cy} r={4.5} fill={C.cyan} stroke={C.panel} strokeWidth={1.5} style={{ filter: 'drop-shadow(0 0 4px rgb(124 200 255 / 0.85))' }} />
    </g>
  )

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Pt }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-[3px] border border-line bg-panel px-3 py-2 shadow-[0_6px_20px_rgb(20_24_29/0.14)]">
      <div className="text-[13px] font-bold">{signed(p.v)} bpm recovery − rest</div>
      <div className="mt-1 tnum text-[11px] text-ink-2">{utcStamp(p.startedAt)}</div>
      <div className="font-mono text-[10px] text-ink-3">{p.sessionId}</div>
      {p.current && <div className="mt-1 text-[11px] font-semibold text-ink">This session</div>}
    </div>
  )
}

/** Observed delta per comparable session, with the baseline median as a labelled reference. */
export function BaselineChart({
  prior,
  current,
  baseline,
  height = 190,
}: {
  prior: { sessionId: string; startedAt: string; observedDelta: number }[]
  current: { sessionId: string; startedAt: string; observedDelta: number } | null
  baseline: number | null
  height?: number
}) {
  const pts: Pt[] = [
    ...prior.map((p) => ({ t: Date.parse(p.startedAt), v: p.observedDelta, sessionId: p.sessionId, startedAt: p.startedAt, current: false })),
    ...(current ? [{ t: Date.parse(current.startedAt), v: current.observedDelta, sessionId: current.sessionId, startedAt: current.startedAt, current: true }] : []),
  ]
  const vs = [...pts.map((p) => p.v), 0, baseline ?? 0]
  const lo = Math.floor((Math.min(...vs) - 4) / 5) * 5
  const hi = Math.ceil((Math.max(...vs) + 6) / 5) * 5
  const ts = pts.map((p) => p.t)
  const pad = 12 * 3600_000
  const x0 = Math.min(...ts) - pad
  const x1 = Math.max(...ts) + pad
  return (
    <div style={{ height }} data-testid="baseline-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 14, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={C.hair} vertical={false} />
          <XAxis
            type="number"
            dataKey="t"
            domain={[x0, x1]}
            ticks={pts.map((p) => p.t)}
            interval={0}
            tickFormatter={(v: number) => utcDate(new Date(v).toISOString()).replace(/ \d{4}$/, '')}
            stroke={C.line}
            tick={{ fill: C.ink3, fontSize: 10.5 }}
            tickLine={false}
          />
          <YAxis type="number" dataKey="v" domain={[lo, hi]} ticks={evenTicks(lo, hi)} interval={0} stroke={C.line} tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'B612' }} tickLine={false} width={40} />
          <ReferenceLine y={0} stroke={C.line} />
          {baseline !== null && (
            <ReferenceLine
              y={baseline}
              stroke={C.ink2}
              strokeWidth={1.25}
              label={{ value: `baseline ${signed(baseline)} bpm`, position: 'insideBottomLeft', fill: C.ink2, fontSize: 10.5, fontWeight: 700 }}
            />
          )}
          <Tooltip content={<Tip />} cursor={false} isAnimationActive={false} />
          <Scatter data={pts} shape={<Dot />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
