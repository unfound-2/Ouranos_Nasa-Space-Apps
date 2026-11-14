import { useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { comparePhases, externalReadingFindings, formatDuration } from '../../shared/analysis'
import type { StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, type Dataset } from '../../shared/dataset'
import { signed, SYMPTOM_LABEL, utcDate, utcStamp } from '../../shared/format'
import { Empty, Panel, Pill, SimTag } from '../components/ui'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { eventsOf, REVIEW_META, sessionsOf, subjectLabel, subjectsOf } from '../lib/view'

export interface SessionRow {
  s: StoredSession
  durationS: number | null
  rest: ReturnType<typeof comparePhases>['rest']
  recovery: ReturnType<typeof comparePhases>['recovery']
  delta: number | null
  events: ReturnType<typeof eventsOf>
  flags: string[]
}

export function sessionRows(ds: Dataset, subjectId: string | null): SessionRow[] {
  return sessionsOf(ds, subjectId).map((s) => {
    const c = comparePhases(s)
    const events = eventsOf(ds, null).filter((e) => e.sessionId === s.sessionId)
    const excluded = c.rest.excluded.length + c.recovery.excluded.length
    const flags: string[] = []
    if (excluded) flags.push(`${excluded} left out`)
    if (c.status !== 'CALCULATED') flags.push('Insufficient samples')
    if (s.phases.some((p) => !p.endedAt)) flags.push('Phase end missing')
    if (s.endReason !== 'COMPLETED') flags.push(s.endReason.replace(/_/g, ' ').toLowerCase())
    if (externalReadingFindings(s, linkedReadings(ds, s.sessionId)).length) flags.push('External reading flagged')
    return {
      s,
      durationS: s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000 : null,
      rest: c.rest,
      recovery: c.recovery,
      delta: c.observedDelta,
      events,
      flags,
    }
  })
}

function evenTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  const step = span <= 20 ? 5 : span <= 50 ? 10 : 20
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}

const C = { cyan: '#45c4fa', coral: '#ff4b65', ink3: '#7d879f', line: '#2b3042', hair: '#20253a', panel: '#141721' }

function DeltaChart({ rows }: { rows: SessionRow[] }) {
  const pts = rows
    .filter((r) => r.delta !== null)
    .map((r) => ({ t: Date.parse(r.s.startedAt), v: r.delta as number, id: r.s.sessionId, at: r.s.startedAt, symptom: r.s.symptoms.length > 0 }))
  const skipped = rows.length - pts.length
  if (!pts.length) return <Empty title="No session has enough readings for a phase comparison">Sessions with fewer than 3 valid readings in a phase are listed below without a difference.</Empty>
  const vs = [0, ...pts.map((p) => p.v)]
  const lo = Math.floor((Math.min(...vs) - 4) / 5) * 5
  const hi = Math.ceil((Math.max(...vs) + 6) / 5) * 5
  const pad = 12 * 3600_000
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill={C.cyan} />
          </svg>
          No symptom reported
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill={C.coral} />
          </svg>
          Symptom reported in that check
        </span>
        {skipped > 0 && <span className="text-ink-3">{skipped} session(s) without enough readings are not plotted</span>}
      </div>
      <div style={{ height: 220 }} data-testid="delta-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={C.hair} vertical={false} />
            <XAxis
              type="number"
              dataKey="t"
              domain={[Math.min(...pts.map((p) => p.t)) - pad, Math.max(...pts.map((p) => p.t)) + pad]}
              ticks={pts.map((p) => p.t)}
              interval={0}
              tickFormatter={(v: number) => utcDate(new Date(v).toISOString()).replace(/ \d{4}$/, '')}
              stroke={C.line}
              tick={{ fill: C.ink3, fontSize: 10.5 }}
              tickLine={false}
            />
            <YAxis type="number" dataKey="v" domain={[lo, hi]} ticks={evenTicks(lo, hi)} interval={0} stroke={C.line} tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'B612' }} tickLine={false} width={40} />
            <Tooltip
              cursor={false}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as (typeof pts)[number]
                return (
                  <div className="rounded-lg border border-line bg-raised px-3 py-2 shadow-2xl shadow-black/50">
                    <div className="text-[13px] font-bold">{signed(p.v)} bpm recovery − rest</div>
                    <div className="mt-1 tnum text-[11px] text-ink-2">{utcStamp(p.at)}</div>
                    <div className="font-mono text-[10px] text-ink-3">{p.id}</div>
                  </div>
                )
              }}
            />
            <Scatter
              data={pts}
              isAnimationActive={false}
              onClick={(d: { payload?: { id?: string } }) => d?.payload?.id && navigate(href.session(d.payload.id))}
              shape={(props: { cx?: number; cy?: number; payload?: { symptom: boolean } }) => (
                <g style={{ cursor: 'pointer' }}>
                  <circle cx={props.cx} cy={props.cy} r={11} fill="transparent" />
                  <circle cx={props.cx} cy={props.cy} r={5} fill={props.payload?.symptom ? C.coral : C.cyan} stroke={C.panel} strokeWidth={2} />
                </g>
              )}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Recovery median minus rest median for each check with enough readings. Descriptive; not compared with any clinical threshold.</p>
    </div>
  )
}

export function SessionsTable({ rows, ds }: { rows: SessionRow[]; ds: Dataset }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[980px]" data-testid="sessions-table">
        <thead>
          <tr>
            <th>Started (UTC)</th>
            <th>Astronaut</th>
            <th>Duration</th>
            <th>Rest</th>
            <th>Recovery</th>
            <th>Difference</th>
            <th>Symptoms</th>
            <th>Events</th>
            <th>Quality</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.s.sessionId} className="row-link" onClick={() => navigate(href.session(r.s.sessionId))} data-testid={`session-row-${r.s.sessionId}`}>
              <td>
                <a href={href.session(r.s.sessionId)} className="tnum text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                  {utcStamp(r.s.startedAt)}
                </a>
              </td>
              <td className="text-ink-2">
                {subjectLabel(r.s.subjectId)} {r.s.isSimulated && <SimTag className="ml-1" />}
              </td>
              <td className="font-mono text-ink-2">{r.durationS === null ? 'In progress' : formatDuration(r.durationS)}</td>
              <td className="font-mono">
                {r.rest.median ?? '--'} <span className="text-ink-3">· {r.rest.valid.length} valid</span>
              </td>
              <td className="font-mono">
                {r.recovery.median ?? '--'} <span className="text-ink-3">· {r.recovery.valid.length} valid</span>
              </td>
              <td className="font-mono font-bold">{r.delta === null ? <span className="font-normal text-ink-3">N/A</span> : `${signed(r.delta)} bpm`}</td>
              <td>
                {r.s.symptomCheck.status === 'REPORTED' ? (
                  <span className="text-coral">{r.s.symptoms.map((x) => SYMPTOM_LABEL[x.code]).join(', ')}</span>
                ) : (
                  <span className="text-ink-3">{r.s.symptomCheck.status === 'NONE_REPORTED' ? 'None' : 'Not answered'}</span>
                )}
              </td>
              <td>
                {r.events.length ? (
                  <div className="flex flex-col gap-1">
                    {r.events.map((e) => (
                      <a key={e.eventId} href={href.event(e.eventId)} onClick={(ev) => ev.stopPropagation()} className="text-[11.5px] text-ink-2 hover:text-ink">
                        {e.category.replace(/_/g, ' ').toLowerCase()} · <span className="text-ink-3">{REVIEW_META[e.review.state].label.toLowerCase()}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-3">None</span>
                )}
              </td>
              <td>{r.flags.length ? <span className="text-amber">{r.flags.join(' · ')}</span> : <span className="text-ink-3">No flags</span>}</td>
              <td className="text-[11.5px] text-ink-2">{recordSourceMode(r.s, 'NOT_PAIRED') === 'SIMULATED DEMO' ? 'Simulated' : (r.s.provenance.ingestPath ?? '--').replace(/_/g, ' ').toLowerCase()}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={10} className="text-ink-3">
                No sessions match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!Object.keys(ds.sessions).length && <p className="mt-3 text-[12px] text-ink-3">No sessions on this computer yet.</p>}
    </div>
  )
}

const SYMPTOM_FILTERS = ['ANY', 'NONE', 'DIZZY', 'WEAK', 'NAUSEATED', 'OTHER'] as const

export function CrewHealth() {
  const { snapshot, subjectId, setSubjectId, workspace } = useData()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [symptom, setSymptom] = useState<(typeof SYMPTOM_FILTERS)[number]>('ANY')
  const [review, setReview] = useState<'ANY' | 'OPEN' | 'REVIEWED' | 'NO_EVENT'>('ANY')
  const ds = snapshot?.dataset
  const all = useMemo(() => (ds ? sessionRows(ds, subjectId) : []), [ds, subjectId])
  if (!ds) return null
  const rows = all.filter((r) => {
    const day = r.s.startedAt.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (symptom === 'NONE' && r.s.symptoms.length) return false
    if (symptom !== 'ANY' && symptom !== 'NONE' && !r.s.symptoms.some((x) => x.code === symptom)) return false
    if (review === 'NO_EVENT' && r.events.length) return false
    if (review === 'OPEN' && !r.events.some((e) => e.status !== 'REVIEWED' && e.status !== 'CLOSED')) return false
    if (review === 'REVIEWED' && !r.events.some((e) => e.review.state === 'REVIEWED' || e.review.state === 'CLOSED')) return false
    return true
  })
  const subjects = subjectsOf(ds)
  return (
    <div className="flex flex-col gap-5">
      <div className="rise">
        <div className="micro">Crew health</div>
        <h1 className="mt-2 font-display text-[clamp(24px,2.6vw,34px)] tracking-[0.06em]">RECOVERY HISTORY</h1>
        <p className="mt-2 max-w-[70ch] text-[13.5px] text-ink-2">Every recorded recovery assessment, with the readings behind each number. Select a session for its full report.</p>
      </div>
      <div className="panel flex flex-wrap items-end gap-4 px-5 py-4" role="search" aria-label="Filter sessions">
        <label className="flex flex-col gap-1.5">
          <span className="micro">Astronaut</span>
          <select className="field" value={subjectId ?? ''} onChange={(e) => setSubjectId(e.target.value || null)} data-testid="filter-subject">
            <option value="">All crew</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">From (UTC date)</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">To (UTC date)</span>
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Symptom</span>
          <select className="field" value={symptom} onChange={(e) => setSymptom(e.target.value as typeof symptom)} data-testid="filter-symptom">
            <option value="ANY">Any</option>
            <option value="NONE">None reported</option>
            <option value="DIZZY">Dizziness</option>
            <option value="WEAK">Weakness</option>
            <option value="NAUSEATED">Nausea</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Review status</span>
          <select className="field" value={review} onChange={(e) => setReview(e.target.value as typeof review)}>
            <option value="ANY">Any</option>
            <option value="OPEN">Has an open event</option>
            <option value="REVIEWED">Has a reviewed event</option>
            <option value="NO_EVENT">No event</option>
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="micro">Data</span>
          <Pill tone={workspace === 'demo' ? 'violet' : 'cyan'} className="h-9">
            {workspace === 'demo' ? 'Simulated demo only' : 'Real mission records only'}
          </Pill>
        </div>
      </div>
      <Panel title="Recovery − rest difference by session" meta={subjectId ? <span className="text-[12px] text-ink-2">{subjectLabel(subjectId)}</span> : <span className="text-[12px] text-ink-3">All crew</span>}>
        <DeltaChart rows={rows} />
      </Panel>
      <Panel title="Recorded assessments" meta={<span className="text-[12px] text-ink-3">{rows.length} of {all.length}</span>} bodyClassName="px-2 pb-3">
        <SessionsTable rows={rows} ds={ds} />
      </Panel>
    </div>
  )
}
