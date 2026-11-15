import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WatchFrame } from '../../shared/watch-link'
import { utcTime } from '../../shared/format'
import { useData } from '../lib/data'

type Point = { x: number; y: number | null }
type Series = { label: string; unit: string; points: Point[] }

function seriesFromFrames(frames: readonly WatchFrame[]) {
  const series = new Map<string, { label: string; unit: string; points: Map<number, Point> }>()
  for (const frame of frames) {
    for (const reading of frame.readings) {
      const key = JSON.stringify([reading.metric, reading.unit])
      const metric = series.get(key) ?? { label: reading.metric, unit: reading.unit, points: new Map<number, Point>() }
      const time = (reading.measuredAt ?? frame.observedAt) * 1000
      metric.points.set(time, { x: time, y: reading.quality === 'valid' ? reading.value : null })
      series.set(key, metric)
    }
  }
  return [...series.values()].map(({ label, unit, points }) => ({
    label, unit, points: [...points.values()].sort((a, b) => a.x - b.x),
  }))
}

const timeLabel = (ms: number) => utcTime(new Date(ms).toISOString())

function MetricChart({ label, unit, points }: Series) {
  const latest = points.at(-1)
  return (
    <section className="panel min-w-0 p-4">
      <h3 className="faded-label font-medium">{label}</h3>
      <p className="mt-1 text-ink-2">
        {latest?.y != null ? `${latest.y} ${unit}` : 'No valid value'}
        {latest && <span> · {timeLabel(latest.x)}</span>}
      </p>
      <div className="mt-2 h-[180px] min-w-0" aria-label={`${label} over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#272b32" />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={timeLabel} minTickGap={30} tick={{ fontSize: 10, fill: '#a1a1a1' }} />
            <YAxis width={40} domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#a1a1a1' }} />
            <Tooltip labelFormatter={(value) => timeLabel(Number(value))} contentStyle={{ background: '#17191e', border: 0 }} />
            <Line dataKey="y" name={label} unit={unit ? ` ${unit}` : ''} stroke="#92baff" strokeWidth={2} dot={points.length < 12} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function WatchCharts({ recordedHeartRate = [] }: { recordedHeartRate?: Point[] }) {
  const { workspace, watchHistory, watchLinks } = useData()
  const watches = workspace === 'mission' && watchLinks ? Object.entries(watchHistory) : []
  const showRecorded = recordedHeartRate.length > 0
  return (
    <section className="grid gap-3" aria-labelledby="watch-chart-title">
      <h2 id="watch-chart-title" className="display faded-label text-[24px]">Watch readings</h2>
      {!watches.length && !showRecorded && <p className="text-ink-2">No watch readings have arrived yet.</p>}
      {watches.map(([deviceId, frames]) => (
        <section key={deviceId} className="grid gap-2">
          <h3 className="text-ink-2">{frames.at(-1)?.source} · {deviceId.slice(-8)}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {seriesFromFrames(frames).map((series) => <MetricChart key={JSON.stringify([series.label, series.unit])} {...series} />)}
          </div>
        </section>
      ))}
      {showRecorded && <MetricChart label={workspace === 'demo' ? 'Simulated heart rate' : 'Recorded heart rate'} unit="bpm" points={recordedHeartRate} />}
    </section>
  )
}
