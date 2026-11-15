import { useId, useState } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { WatchFrame } from '../../shared/watch-link'
import { utcTime } from '../../shared/format'
import { useCrewProfile } from '../lib/crew-profile'
import { useData, useNow } from '../lib/data'

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
  const gradient = useId()
  const bars = /respirat|breath/i.test(label)
  const pressure = /blood pressure|systolic|diastolic/i.test(label)
  const line = pressure || /oxygen/i.test(label)
  const temperature = /temperature/i.test(label)
  const colors = temperature ? ['#916bff', '#cfabff'] : pressure ? ['#5074ff', '#9daaff'] : ['#5789ff', '#64d6ff']
  const stroke = `url(#${gradient}-line)`
  const series = { dataKey: 'y', name: label, unit: unit ? ` ${unit}` : '', isAnimationActive: false }

  return (
    <section className={`panel mission-trend ${bars ? "mission-respiratory" : ""} min-w-0 p-5`}>
      <h3 className="faded-label font-medium">{label}</h3>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-ink-2">
        {latest?.y != null ? `${latest.y} ${unit}` : 'No valid value'}
        {latest && <span>{timeLabel(latest.x)}</span>}
      </p>
      <div className="mission-chart-enter mt-3 h-[210px] min-w-0" aria-label={`${label} over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${gradient}-line`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor={colors[0]} />
                <stop offset="58%" stopColor={colors[1]} />
                <stop offset="100%" stopColor="#e3f8ff" />
              </linearGradient>
              <linearGradient id={`${gradient}-bar`} x1="0" x2="0" y1="1" y2="0">
                <stop offset="0%" stopColor="#305c9e" />
                <stop offset="100%" stopColor="#8cf0f7" />
              </linearGradient>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={colors[1]} stopOpacity={0.42} />
                <stop offset="100%" stopColor={colors[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#272b32" />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={timeLabel} minTickGap={30} tick={{ fontSize: 10, fill: '#a1a1a1' }} />
            <YAxis width={40} domain={bars ? [0, 'auto'] : ['auto', 'auto']} tick={{ fontSize: 10, fill: '#a1a1a1' }} />
            <Tooltip labelFormatter={(value) => timeLabel(Number(value))} contentStyle={{ background: '#17191e', border: 0 }} />
            {bars ? (
              <Bar {...series} fill={`url(#${gradient}-bar)`} maxBarSize={20} radius={[3, 3, 0, 0]}>
                {points.map((point) => <Cell key={point.x} fill={point === latest ? '#b2f4ff' : `url(#${gradient}-bar)`} />)}
              </Bar>
            ) : line ? (
              <Line {...series} type={pressure ? 'stepAfter' : 'linear'} stroke={stroke} strokeWidth={2.4} dot={false} activeDot={false} connectNulls={false} />
            ) : (
              <Area {...series} type={temperature ? 'monotone' : 'linear'} fill={`url(#${gradient})`} stroke={stroke} strokeWidth={2.2} dot={false} activeDot={false} connectNulls={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

const effort = (i: number) => Math.max(0, 1 - Math.abs(i % 40 - 15) / 10)

const watchMetrics = [
  { label: 'Heart rate', unit: 'bpm', sample: (i: number) => Math.round(69 + effort(i) * 36 + Math.sin(i * .85) * 2) },
  { label: 'Respiratory rate', unit: 'breaths/min', sample: (i: number) => Math.round(14 + effort(i - 1) * 8 + Math.sin(i * .6)) },
]

function SimulatorPreview({ compact, metrics }: { compact: boolean; metrics: typeof watchMetrics }) {
  const [started] = useState(() => Date.now())
  const interval = 4000
  const now = useNow(interval)
  const last = 23 + Math.max(0, Math.floor((now - started) / interval))
  const samples = Array.from({ length: 24 }, (_, offset) => last - 23 + offset)
  return (
    <div className={compact ? 'grid gap-3' : 'grid gap-3 sm:grid-cols-2'}>
      {metrics.map(({ label, unit, sample }) => (
        <MetricChart key={label} label={label} unit={unit}
          points={samples.map((index) => ({ x: started + (index - 23) * interval, y: sample(index) }))} />
      ))}
    </div>
  )
}

export function OnboardSimulatorCharts() {
  const [started] = useState(() => Date.now())
  const now = useNow(4000)
  const last = 23 + Math.max(0, Math.floor((now - started) / 4000))
  const samples = Array.from({ length: 24 }, (_, offset) => {
    const i = last - 23 + offset
    return {
      time: started + (i - 23) * 4000,
      systolic: Math.round(116 + effort(i) * 18 + 2 * Math.sin(i * .37)),
      diastolic: Math.round(73 + effort(i) * 5 + 2 * Math.sin(i * .43)),
      oxygen: Number((98 - effort(i) * .6 + .25 * Math.sin(i * .47)).toFixed(1)),
      temperature: Number((33.2 + effort(i - 4) * .5 + .08 * Math.sin(i * .32)).toFixed(1)),
    }
  })
  const latest = samples[samples.length - 1]
  const oxygen = samples.map((sample) => sample.oxygen)
  const temperature = samples.map((sample) => sample.temperature)
  const lowTemperature = Math.min(...temperature)
  const highTemperature = Math.max(...temperature)
  const pressureScale = (value: number) => ((value - 60) / 90) * 100

  return (
    <section className="grid gap-4" aria-labelledby="onboard-chart-title">
      <header>
        <h2 id="onboard-chart-title" className="display faded-label text-[24px]">Onboard instrument trends</h2>
        <p className="mt-2 text-ink-2">
          Simulated exercise and recovery readings inspired by the ISS Bio-Monitor.
          {' '}<a className="underline" href="https://www.nasa.gov/missions/station/iss-research/peak-performance-in-microgravity/" target="_blank" rel="noreferrer">NASA research</a>
        </p>
      </header>
      <div className="onboard-mosaic">
        <section className="panel mission-trend onboard-pressure">
          <h3>Blood pressure</h3>
          <p className="onboard-value">{latest.systolic}/{latest.diastolic} <span>mmHg</span></p>
          <div className="onboard-pressure-legend"><span>Diastolic</span><span>Systolic</span></div>
          <ul className="onboard-pressure-history">
            {samples.filter((_, i) => i % 3 === 2).map((sample) => (
              <li key={sample.time} className="onboard-pressure-row">
                <time dateTime={new Date(sample.time).toISOString()}>{timeLabel(sample.time)}</time>
                <div className="onboard-pressure-track" aria-hidden="true">
                  <span style={{ left: `${pressureScale(sample.diastolic)}%`, width: `${pressureScale(sample.systolic) - pressureScale(sample.diastolic)}%` }} />
                </div>
                <span className="onboard-pressure-reading">{sample.systolic}/{sample.diastolic}</span>
              </li>
            ))}
          </ul>
          <div className="onboard-pressure-row onboard-pressure-axis" aria-hidden="true">
            <span />
            <div><span>60</span><span>90</span><span>120</span><span>150</span></div>
            <span>mmHg</span>
          </div>
        </section>
        <section className="panel mission-trend onboard-oxygen">
          <div>
            <h3>Oxygen saturation</h3>
            <p className="mt-2 text-ink-2">Recent range</p>
            <p className="mt-1 font-semibold">{Math.min(...oxygen).toFixed(1)}–{Math.max(...oxygen).toFixed(1)}%</p>
          </div>
          <div className="onboard-oxygen-ring" style={{ background: `conic-gradient(#6e88ff, #8ce7ff ${latest.oxygen}%, #24314b 0)` }}>
            <strong aria-label={`Latest oxygen saturation ${latest.oxygen}%`}>{latest.oxygen.toFixed(1)}<span>%</span></strong>
          </div>
        </section>
        <section className="panel mission-trend onboard-temperature">
          <h3>Skin temperature</h3>
          <p className="onboard-value">{latest.temperature.toFixed(1)} <span>°C</span></p>
          <div className="onboard-temperature-history" role="img" aria-label={`Recent skin temperatures ranged from ${lowTemperature.toFixed(1)} to ${highTemperature.toFixed(1)} degrees Celsius`}>
            {samples.map((sample) => (
              <span key={sample.time} title={`${timeLabel(sample.time)}  ${sample.temperature.toFixed(1)} °C`}
                style={{ backgroundColor: `hsl(${225 + 65 * (sample.temperature - lowTemperature) / Math.max(.1, highTemperature - lowTemperature)} 70% 63%)` }} />
            ))}
          </div>
          <div className="onboard-temperature-axis">
            <span>{timeLabel(samples[0].time)}</span><span>{timeLabel(latest.time)}</span>
          </div>
        </section>
      </div>
    </section>
  )
}

export function WatchCharts({ recordedHeartRate = [], compact = false }: { recordedHeartRate?: Point[]; compact?: boolean }) {
  const { workspace, watchHistory, watchLinks } = useData()
  const profile = useCrewProfile()
  const watches = workspace === 'mission' && watchLinks
    ? Object.entries(watchHistory).filter(([deviceId]) => !profile || profile.deviceId === deviceId)
    : []
  const showRecorded = recordedHeartRate.length > 0
  return (
    <section className={`grid gap-3 ${compact ? "watch-charts-compact" : ""}`} aria-label="Watch measurements">
      {workspace === 'demo' && <SimulatorPreview compact={compact} metrics={watchMetrics} />}
      {workspace !== 'demo' && !watches.length && !showRecorded && <div className="panel p-5"><p className="text-ink-2">No readings have arrived for this watch. Charts appear when it sends a reading.</p><a className="mt-3 inline-block underline" href="/#/system">Check watch connection</a></div>}
      {watches.map(([deviceId, frames]) => (
        <section key={deviceId} className="grid gap-2">
          <h3 className="flex flex-wrap gap-x-2 text-ink-2"><span>{frames.at(-1)?.source}</span><span>{deviceId.slice(-8)}</span></h3>
          <div className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-2"}>
            {seriesFromFrames(frames).filter(({ label }) => !/wrist motion/i.test(label)).map((series) => <MetricChart key={JSON.stringify([series.label, series.unit])} {...series} />)}
          </div>
        </section>
      ))}
      {showRecorded && workspace !== 'demo' && <MetricChart label={'Recorded heart rate'} unit="bpm" points={recordedHeartRate} />}
    </section>
  )
}
