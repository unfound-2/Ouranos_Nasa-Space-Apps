import { Plus } from 'lucide-react'
import { utcTime } from '../../../shared/format'
import type { WatchFrame } from '../../../shared/watch-link'
import { crewSystems, saveCrew, useCrewProfile, withoutSystem, type CrewSystem } from '../../lib/crew-profile'
import { useData, useNow } from '../../lib/data'
import { watchSignIn } from '../../lib/watch-pairing'
import { Pill, SimTag } from '../ui'
import { DeviceModel } from './DeviceModel'
import {
  ago,
  frameIsCurrent,
  latestReadings,
  linkMeta,
  QUALITY_LABEL,
  readingsBelongIn,
  resolveSystemKind,
  sparkMetric,
  sparkPoints,
  SYSTEM_KIND_META,
  systemLinkState,
  type SystemReading,
} from './systems'

export const PAIR_SYSTEM_HREF = '#/pair?mode=system'

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

function Sparkline({ frames, frame }: { frames: readonly WatchFrame[]; frame: WatchFrame }) {
  const pick = sparkMetric(frame)
  if (!pick) return null
  const points = sparkPoints(frames.filter((f) => f.source === frame.source), pick.metric, pick.unit)
  const values = points.flatMap((p) => (p.v === null ? [] : [p.v]))
  if (points.length < 2 || !values.length) {
    return <p className="system-spark-note">{pick.metric} trend appears after two readings.</p>
  }
  const W = 240
  const H = 44
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const t0 = points[0].t
  const span = Math.max(1, points.at(-1)!.t - t0)
  const x = (t: number) => ((t - t0) / span) * W
  const y = (v: number) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8))
  // Invalid readings break the line instead of dropping to zero.
  const d = points.map((p, i) => (p.v === null ? '' : `${i && points[i - 1].v !== null ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)).join('')
  const last = points.at(-1)!
  const summary = `${pick.metric}, ${points.length} readings from ${utcTime(new Date(t0).toISOString())} to ${utcTime(new Date(last.t).toISOString())}, ${lo} to ${hi} ${pick.unit}`
  return (
    <figure className="system-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary}>
        <path d={d} className="system-spark-line" vectorEffect="non-scaling-stroke" />
        {last.v !== null && <circle cx={x(last.t)} cy={y(last.v)} r="2.6" className="system-spark-dot" />}
      </svg>
      <figcaption>{pick.metric} · {points.length} readings · {lo} to {hi} {pick.unit}{frame.simulated ? ' · simulated' : ''}</figcaption>
    </figure>
  )
}

function ReadingRow({ r }: { r: SystemReading }) {
  return (
    <li className="system-reading" data-testid="system-reading">
      <span className="system-reading-metric">{r.metric}</span>
      <span className="system-reading-value tnum">
        {r.value === null ? 'No value' : r.value}
        {r.value !== null && r.unit && <span className="unit"> {r.unit}</span>}
      </span>
      <span className="system-reading-meta tnum">
        <time dateTime={iso(r.time)}>{utcTime(iso(r.time))}</time>
        <span>{QUALITY_LABEL[r.quality]}</span>
        {r.flagged && <span>Flagged for review</span>}
        {r.simulated && <span className="system-sim-tag" title="Simulated reading. Not astronaut data."><span>SIMULATED</span></span>}
      </span>
    </li>
  )
}

function SystemCard({ system, nowMs, owned, onRemove }: { system: CrewSystem; nowMs: number; owned: boolean; onRemove: () => void }) {
  const { watchLinks, watchHistory, snapshot, workspace, setWorkspace } = useData()
  const link = watchLinks?.find((l) => l.deviceId === system.deviceId) ?? null
  const frames = watchHistory[system.deviceId] ?? []
  const frame = link?.watch ?? null
  const kind = resolveSystemKind(frame, system.kind)
  const meta = SYSTEM_KIND_META[kind]
  const state = systemLinkState({ listed: link !== null, serverLink: snapshot?.links[system.deviceId], lastFrameAt: frame?.observedAt, nowMs })
  const linkInfo = linkMeta(state, kind)
  const readings = latestReadings(frame)
  const current = frame ? frameIsCurrent(frame, nowMs) : false
  const shown = frame !== null && readingsBelongIn(frame, workspace)
  return (
    <article className="system-card" data-testid="system-card" data-kind={kind} data-link={state} aria-label={`${meta.name}, ${linkInfo.label}`}>
      <div className="system-card-top">
        <DeviceModel kind={kind} label={`3D model of a ${meta.name.toLowerCase()}`} />
        <div className="system-card-id">
          <h3 className="system-card-name">{meta.name}</h3>
          <p className="system-card-kind">{frame ? frame.source : 'Waiting for its first reading'}</p>
          <p className="system-card-measures">{meta.measures}</p>
          <Pill tone={linkInfo.tone} title={linkInfo.hint} testId="system-link">{linkInfo.label}</Pill>
          <p className="system-card-contact tnum">
            {frame ? <>Latest frame {ago(frame.observedAt, nowMs)} · <time dateTime={iso(frame.observedAt)}>{utcTime(iso(frame.observedAt))}</time></> : 'No frame received yet'}
          </p>
          {frame?.simulated && <SimTag />}
        </div>
      </div>

      {frame && shown && (
        <>
          {!current && <div className="system-card-note" role="status"><p>Not current. The latest reading is {ago(frame.observedAt, nowMs)} old.</p></div>}
          <ul className={`system-readings ${current ? '' : 'is-stale'}`} aria-label={`Latest readings from the ${meta.name.toLowerCase()}`}>
            {readings.map((r) => <ReadingRow key={`${r.metric}|${r.unit}`} r={r} />)}
          </ul>
          <Sparkline frames={frames} frame={frame} />
        </>
      )}
      {frame && !shown && (
        <div className="system-card-note">
          <p>
            {frame.simulated
              ? 'This system is sending simulated readings. They show only in the simulated demo, never with mission records.'
              : 'This system is sending real readings. They show only with mission records, never in the simulated demo.'}
          </p>
          <button type="button" className="btn btn-ghost mt-2 h-8" onClick={() => setWorkspace(frame.simulated ? 'demo' : 'mission')}>
            {frame.simulated ? 'Show in the simulated demo' : 'Show mission records'}
          </button>
        </div>
      )}
      {!frame && state !== 'NOT_PAIRED' && <div className="system-card-note"><p>Paired. Readings appear here as soon as the system sends them.</p></div>}
      {state === 'NOT_PAIRED' && owned && (
        <div className="system-card-note">
          <p>{linkInfo.hint}</p>
          <button type="button" className="btn btn-ghost mt-2 h-8" onClick={onRemove}>Remove from this crew member</button>
        </div>
      )}
    </article>
  )
}

/** The top of Crew Health: one card per monitoring system the signed-in crew member owns. */
export function MonitoringSystems() {
  const { watchLinks } = useData()
  const profile = useCrewProfile()
  const nowMs = useNow(2000)
  const signIn = watchSignIn()
  // No crew profile: the signed-in watch, else every system paired with this computer.
  const systems: CrewSystem[] = profile
    ? crewSystems(profile)
    : signIn
      ? [{ deviceId: signIn.deviceId }]
      : (watchLinks ?? []).map((l) => ({ deviceId: l.deviceId }))
  const who = profile?.name ?? signIn?.name ?? null
  return (
    <section className="crew-systems" aria-labelledby="crew-systems-title" data-testid="monitoring-systems">
      <div className="crew-systems-horizon" aria-hidden="true" />
      <header className="crew-systems-intro">
        <h2 id="crew-systems-title" className="display faded-label">Monitoring systems</h2>
        <p>{who ? `${who} · ` : ''}{systems.length === 1 ? '1 system' : `${systems.length} systems`} · each reading keeps its unit, time, source and quality</p>
        <a className="btn btn-primary crew-systems-pair" href={PAIR_SYSTEM_HREF}>
          <Plus size={16} aria-hidden /> Pair another system
        </a>
      </header>
      {systems.length ? (
        <div className="crew-systems-grid">
          {systems.map((s) => (
            <SystemCard
              key={s.deviceId}
              system={s}
              nowMs={nowMs}
              owned={profile !== null}
              onRemove={() => profile && saveCrew(withoutSystem(profile, s.deviceId))}
            />
          ))}
        </div>
      ) : (
        <div className="system-card system-card-empty">
          <p>No monitoring system is paired for this crew member yet. Pair a chest strap, blood pressure cuff, suit biomonitor or other system to see its readings here.</p>
        </div>
      )}
    </section>
  )
}
