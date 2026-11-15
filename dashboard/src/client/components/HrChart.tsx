import { useMemo, useState } from 'react'
import { CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { EXCLUSION_LABEL, type PhaseComparison } from '../../shared/analysis'
import type { StoredMeasurement, StoredSession } from '../../shared/contract'
import { SYMPTOM_LABEL, utcClock, utcStamp } from '../../shared/format'

type Kind = 'used' | 'excluded' | 'missing'
interface Pt {
  t: number
  v: number
  kind: Kind
  m: StoredMeasurement
  reason: string | null
  sel?: boolean
}

const C = {
  cyan: '#41c8f5',
  violet: '#a783ff',
  amber: '#f0b45c',
  coral: '#ff526b',
  ink: '#f5f8ff',
  ink2: '#98a7be',
  ink3: '#8391aa',
  line: '#293346',
  hair: '#1b2231',
  panel: '#101520',
}

function points(session: StoredSession, c: PhaseComparison, floor: number): Pt[] {
  const used = new Set([...c.rest.valid, ...c.recovery.valid].map((m) => m.measurementId))
  const reasons = new Map([...c.rest.excluded, ...c.recovery.excluded].map((x) => [x.measurement.measurementId, EXCLUSION_LABEL[x.reason]]))
  return session.measurements
    .filter((m) => m.indicator === 'HEART_RATE')
    .map((m) => {
      const kind: Kind = used.has(m.measurementId) ? 'used' : m.value === null ? 'missing' : 'excluded'
      return {
        t: Date.parse(m.measuredAt),
        v: m.value ?? floor,
        kind,
        m,
        reason: kind === 'used' ? null : (reasons.get(m.measurementId) ?? 'Not tagged with a phase'),
      }
    })
}

/* Scatter shapes: each has a transparent 11 px hit area so the hover target is bigger than the mark. */
type ShapeProps = { cx?: number; cy?: number; payload?: Pt }
const SelRing = ({ cx = 0, cy = 0, payload }: ShapeProps) =>
  payload?.sel ? <circle cx={cx} cy={cy} r={9} fill="none" stroke={C.ink} strokeWidth={1.5} /> : null
const UsedDot = ({ cx = 0, cy = 0, payload }: ShapeProps) => (
  <g style={{ cursor: 'pointer' }}>
    <SelRing cx={cx} cy={cy} payload={payload} />
    <circle cx={cx} cy={cy} r={11} fill="transparent" />
    <circle cx={cx} cy={cy} r={4.5} fill={C.cyan} stroke={C.panel} strokeWidth={2} />
  </g>
)
const ExcludedDot = ({ cx = 0, cy = 0, payload }: ShapeProps) => (
  <g style={{ cursor: 'pointer' }}>
    <SelRing cx={cx} cy={cy} payload={payload} />
    <circle cx={cx} cy={cy} r={11} fill="transparent" />
    <circle cx={cx} cy={cy} r={5} fill={C.panel} stroke={C.amber} strokeWidth={1.5} />
    <path d={`M${cx - 2.6} ${cy - 2.6} L${cx + 2.6} ${cy + 2.6} M${cx + 2.6} ${cy - 2.6} L${cx - 2.6} ${cy + 2.6}`} stroke={C.amber} strokeWidth={1.3} />
  </g>
)
const MissingMark = ({ cx = 0, cy = 0, payload }: ShapeProps) => (
  <g style={{ cursor: 'pointer' }}>
    <SelRing cx={cx} cy={cy} payload={payload} />
    <circle cx={cx} cy={cy - 4} r={11} fill="transparent" />
    <line x1={cx} y1={cy - 12} x2={cx} y2={cy - 2} stroke={C.ink3} strokeWidth={1.5} strokeDasharray="2 2" />
    <circle cx={cx} cy={cy} r={2.2} fill={C.ink3} />
  </g>
)

function HrTooltip({ active, payload }: { active?: boolean; payload?: { payload: Pt }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2.5 shadow-2xl shadow-black/50">
      <div className="text-[14px] font-bold text-ink">{p.m.value === null ? 'No value recorded' : `${p.m.value} bpm`}</div>
      <div className="mt-1 tnum text-[11px] text-ink-2">{utcStamp(p.m.measuredAt)}</div>
      <div className="mt-1 text-[11.5px] text-ink-2">
        {p.m.phase ? `${p.m.phase.toLowerCase()} phase` : 'no phase'} · quality {p.m.quality.toLowerCase()}
      </div>
      <div className="text-[11.5px] text-ink-3">{p.m.source.device ?? p.m.source.kind}</div>
      {p.reason && <div className="mt-1 text-[11.5px] text-amber">Left out of the median: {p.reason.toLowerCase()}</div>}
      <div className="mt-1 font-mono text-[10px] text-ink-3">{p.m.measurementId}</div>
    </div>
  )
}

export function HrChart({
  session,
  comparison,
  height = 300,
  selectedId = null,
  onSelect,
}: {
  session: StoredSession
  comparison: PhaseComparison
  height?: number
  selectedId?: string | null
  onSelect?: (measurementId: string) => void
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const model = useMemo(() => {
    const values = session.measurements.filter((m) => m.indicator === 'HEART_RATE' && m.value !== null).map((m) => m.value as number)
    const lo = values.length ? Math.max(0, Math.floor((Math.min(...values) - 8) / 5) * 5) : 50
    const hi = values.length ? Math.ceil((Math.max(...values) + 6) / 5) * 5 : 120
    const band = Math.max(4, Math.round((hi - lo) * 0.14))
    const pts = points(session, comparison, lo - band / 2).map((p) => ({ ...p, sel: p.m.measurementId === selectedId }))
    const x0 = Date.parse(session.startedAt)
    const lastT = Math.max(x0 + 60_000, ...pts.map((p) => p.t), session.endedAt ? Date.parse(session.endedAt) : 0)
    const span = lastT - x0
    const step = span <= 180_000 ? 15_000 : span <= 600_000 ? 60_000 : 300_000
    const ticks: number[] = []
    for (let x = Math.ceil(x0 / step) * step; x <= lastT; x += step) ticks.push(x)
    const ystep = hi - lo <= 40 ? 10 : 20
    const yticks: number[] = []
    for (let v = Math.ceil(lo / ystep) * ystep; v <= hi; v += ystep) yticks.push(v)
    return { lo, hi, band, pts, x0, x1: lastT, ticks, yticks }
  }, [session, comparison, selectedId])

  const phases = session.phases.map((p) => ({ ...p, a: Date.parse(p.startedAt), b: p.endedAt ? Date.parse(p.endedAt) : model.x1 }))
  const medians = [comparison.rest, comparison.recovery]
    .map((s) => ({ s, ph: phases.find((p) => p.phase === s.phase) }))
    .filter((x) => x.s.median !== null && x.ph)
  const hrReadings = session.measurements.filter((m) => m.indicator === 'HEART_RATE')

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill={C.cyan} />
          </svg>
          Valid reading, used in the median
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill="none" stroke={C.amber} strokeWidth="1.5" />
            <path d="M3.6 3.6 L8.4 8.4 M8.4 3.6 L3.6 8.4" stroke={C.amber} strokeWidth="1.2" />
          </svg>
          Left out of the median
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <line x1="6" y1="1" x2="6" y2="8" stroke={C.ink3} strokeWidth="1.5" strokeDasharray="2 2" />
            <circle cx="6" cy="10" r="2" fill={C.ink3} />
          </svg>
          Attempted, no value
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="12" aria-hidden>
            <line x1="1" y1="6" x2="15" y2="6" stroke={C.ink} strokeOpacity="0.8" strokeWidth="1.5" />
          </svg>
          Phase median
        </span>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-line" role="tablist" aria-label="Chart or table">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] ${view === v ? 'bg-raised text-ink' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'chart' ? (
        <div style={{ height }} data-testid="hr-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 26, right: 18, bottom: 6, left: 0 }}>
              <CartesianGrid stroke={C.hair} vertical={false} />
              {phases.map((p) => (
                <ReferenceArea
                  key={p.phase}
                  x1={p.a}
                  x2={p.b}
                  y1={model.lo}
                  y2={model.hi}
                  fill={p.phase === 'REST' ? C.cyan : C.violet}
                  fillOpacity={0.07}
                  stroke={p.phase === 'REST' ? C.cyan : C.violet}
                  strokeOpacity={0.22}
                  ifOverflow="hidden"
                  label={{ value: `${p.phase}${p.endedAt ? '' : ' · NO END TIME'}`, position: 'insideTopLeft', fill: C.ink2, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}
                />
              ))}
              <XAxis
                type="number"
                dataKey="t"
                domain={[model.x0, model.x1]}
                ticks={model.ticks}
                tickFormatter={(v: number) => utcClock(new Date(v).toISOString())}
                stroke={C.line}
                tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'Mona Sans Variable' }}
                tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="v"
                domain={[model.lo - model.band, model.hi]}
                ticks={model.yticks}
                interval={0}
                stroke={C.line}
                tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'Mona Sans Variable' }}
                tickLine={false}
                width={44}
                unit=""
                label={{ value: 'BPM', angle: 0, position: 'insideTopLeft', dy: -22, dx: 8, fill: C.ink3, fontSize: 10, letterSpacing: 1.5 }}
              />
              {model.pts.some((p) => p.kind === 'missing') && (
                <ReferenceArea
                  y1={model.lo - model.band}
                  y2={model.lo}
                  fill="#0a0b12"
                  fillOpacity={0.55}
                  ifOverflow="hidden"
                  label={{ value: 'NO VALUE', position: 'insideLeft', fill: C.ink3, fontSize: 9, letterSpacing: 1.2 }}
                />
              )}
              {medians.map(({ s, ph }) => (
                <ReferenceLine key={s.phase} segment={[{ x: ph!.a, y: s.median! }, { x: ph!.b, y: s.median! }]} stroke={C.ink} strokeOpacity={0.75} strokeWidth={1.5} ifOverflow="hidden" />
              ))}
              {session.symptoms.map((s) => (
                <ReferenceLine
                  key={s.symptomId}
                  x={Date.parse(s.reportedAt)}
                  stroke={C.coral}
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={(props: { viewBox?: { x?: number; y?: number } }) => {
                    // Written up the line, just left of it: it never meets the phase labels across the top.
                    const x = (props.viewBox?.x ?? 0) - 5
                    const y = (props.viewBox?.y ?? 0) + 4
                    return (
                      <text x={x} y={y} transform={`rotate(-90 ${x} ${y})`} textAnchor="end" fill={C.coral} fontSize={10} fontWeight={700} letterSpacing={1}>
                        {SYMPTOM_LABEL[s.code]} · {s.reportedBy === 'SELF_REPORTED' ? 'SELF-REPORTED' : 'CREW-OBSERVED'}
                      </text>
                    )
                  }}
                />
              ))}
              <Tooltip content={<HrTooltip />} cursor={{ stroke: C.cyan, strokeOpacity: 0.35, strokeDasharray: '3 3' }} isAnimationActive={false} />
              <Scatter data={model.pts.filter((p) => p.kind === 'missing')} shape={<MissingMark />} isAnimationActive={false} onClick={(d: { payload?: Pt }) => d?.payload && onSelect?.(d.payload.m.measurementId)} />
              <Scatter data={model.pts.filter((p) => p.kind === 'excluded')} shape={<ExcludedDot />} isAnimationActive={false} onClick={(d: { payload?: Pt }) => d?.payload && onSelect?.(d.payload.m.measurementId)} />
              <Scatter data={model.pts.filter((p) => p.kind === 'used')} shape={<UsedDot />} isAnimationActive={false} onClick={(d: { payload?: Pt }) => d?.payload && onSelect?.(d.payload.m.measurementId)} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[340px] overflow-auto" data-testid="hr-table">
          <table className="data-table">
            <thead className="sticky top-0 bg-panel">
              <tr>
                <th>Measured (UTC)</th>
                <th>Phase</th>
                <th>Value</th>
                <th>Quality</th>
                <th>Used</th>
                <th>Source</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {model.pts
                .slice()
                .sort((a, b) => a.t - b.t)
                .map((p) => (
                  <tr
                    key={p.m.measurementId}
                    className={onSelect ? 'row-link' : undefined}
                    data-selected={p.m.measurementId === selectedId}
                    onClick={() => onSelect?.(p.m.measurementId)}
                  >
                    <td className="tnum text-ink-2">{utcStamp(p.m.measuredAt)}</td>
                    <td>{p.m.phase ?? '--'}</td>
                    <td className="font-mono">{p.m.value === null ? '--' : `${p.m.value} bpm`}</td>
                    <td>{p.m.quality}</td>
                    <td className={p.kind === 'used' ? 'text-cyan' : 'text-amber'}>{p.kind === 'used' ? 'Yes' : `No · ${p.reason?.toLowerCase()}`}</td>
                    <td className="text-ink-2">{p.m.source.device ?? p.m.source.kind}</td>
                    <td className="font-mono text-[11px] text-ink-3">{p.m.measurementId}</td>
                  </tr>
                ))}
              {!hrReadings.length && (
                <tr>
                  <td colSpan={7} className="text-ink-3">
                    No heart-rate readings in this record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
