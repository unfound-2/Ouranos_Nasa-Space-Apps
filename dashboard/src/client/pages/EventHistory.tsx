import { Search } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { EventCategoryT, EventStatusT, StoredEvent } from '../../shared/contract'
import { utcClock, utcStamp } from '../../shared/format'
import { ackLabel, evidenceLabel } from '../components/Events'
import { Disclosure, Pill, SimTag, TONE } from '../components/ui'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SEVERITY_META, sortEvents, STATUS_META, subjectLabel, subjectsOf } from '../lib/view'
import './tabs.css'

const CATEGORIES = Object.keys(CATEGORY_META) as EventCategoryT[]
const STATUSES = Object.keys(STATUS_META) as EventStatusT[]
const isOpenEvent = (e: StoredEvent) => e.status !== 'REVIEWED' && e.status !== 'CLOSED'

interface Point {
  t: number
  lane: number
  e: StoredEvent
}

function TimelineTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null
  const { e } = payload[0].payload
  return (
    <div className="tab-tooltip">
      <div className="font-semibold text-ink">{CATEGORY_META[e.category].label}</div>
      <div className="mt-1 tnum text-ink-2">{utcStamp(e.createdAt)}</div>
      <div className="text-ink-2">
        {subjectLabel(e.subjectId)} · {STATUS_META[e.status].label}
      </div>
      {e.isSimulated && <div className="text-ink-2">Simulated record</div>}
      <div className="mt-1 font-mono text-[10.5px] text-ink-3">{e.eventId}</div>
    </div>
  )
}

function EventDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const p = props.payload
  const color = p ? TONE[CATEGORY_META[p.e.category].tone].stroke : '#8f8f8f'
  const open = p ? isOpenEvent(p.e) : false
  return (
    <g style={{ cursor: 'pointer' }}>
      <circle cx={props.cx} cy={props.cy} r={11} fill={color} fillOpacity={0.14} />
      <circle cx={props.cx} cy={props.cy} r={6} fill={open ? color : '#0b1626'} stroke={color} strokeWidth={2} />
    </g>
  )
}

/** When each event was created, one lane per category. Filled dots are still open; rings are reviewed or closed. */
function EventTimeline({ events }: { events: StoredEvent[] }) {
  const pts: Point[] = events.map((e) => ({ t: Date.parse(e.createdAt), lane: CATEGORIES.indexOf(e.category), e }))
  if (!pts.length) return <p className="text-[13px] text-ink-3">No events to place on the timeline.</p>
  const lo = Math.min(...pts.map((p) => p.t))
  const hi = Math.max(...pts.map((p) => p.t))
  const pad = Math.max((hi - lo) * 0.06, 30 * 60 * 1000)
  const x0 = lo - pad
  const x1 = hi + pad
  const ticks = [0, 1, 2, 3, 4].map((i) => x0 + ((x1 - x0) * i) / 4)
  const multiDay = x1 - x0 > 20 * 3600 * 1000
  const tick = (v: number) => {
    const iso = new Date(v).toISOString()
    return multiDay ? utcStamp(iso).slice(5, 16) : utcClock(iso).slice(0, 5)
  }
  return (
    <>
      <div className="tab-chart" data-testid="event-timeline">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 18, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="rgb(132 175 245 / 0.12)" strokeDasharray="3 4" horizontal vertical={false} />
            <XAxis
              type="number"
              dataKey="t"
              domain={[x0, x1]}
              ticks={ticks}
              tickFormatter={tick}
              stroke="rgb(132 175 245 / 0.18)"
              tick={{ fill: 'var(--color-ink-3)', fontSize: 10.5, fontFamily: 'inherit' }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="lane"
              domain={[-0.6, CATEGORIES.length - 0.4]}
              ticks={CATEGORIES.map((_, i) => i)}
              interval={0}
              reversed
              tickFormatter={(i: number) => CATEGORY_META[CATEGORIES[i]]?.label ?? ''}
              axisLine={false}
              tickLine={false}
              width={124}
              tick={{ fill: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'inherit' }}
            />
            <Tooltip content={<TimelineTooltip />} cursor={{ stroke: '#8cceff', strokeOpacity: 0.3, strokeDasharray: '3 3' }} isAnimationActive={false} />
            <Scatter
              data={pts}
              isAnimationActive={false}
              onClick={(d: { payload?: Point }) => d?.payload && navigate(href.event(d.payload.e.eventId))}
              shape={<EventDot />}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="tab-chart-note">Times in UTC. A filled dot is still open; a ring has been reviewed or closed. Select a dot to open its evidence.</p>
    </>
  )
}

export function EventHistory() {
  const { snapshot, workspace } = useData()
  const [status, setStatus] = useState<'ANY' | 'OPEN' | EventStatusT>('ANY')
  const [category, setCategory] = useState<'ANY' | EventCategoryT>('ANY')
  const [subject, setSubject] = useState('')
  const [query, setQuery] = useState('')
  if (!snapshot) return null
  const ds = snapshot.dataset
  const all = sortEvents(Object.values(ds.events))
  const q = query.trim().toLowerCase()
  const rows = all.filter((e) => {
    if (q) {
      const hay = [e.eventId, e.sessionId ?? '', subjectLabel(e.subjectId), CATEGORY_META[e.category].label, STATUS_META[e.status].label, ORIGIN_LABEL[e.origin.kind], ...e.reasonCodes, e.review.reviewer ?? '']
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (subject && e.subjectId !== subject) return false
    if (category !== 'ANY' && e.category !== category) return false
    if (status === 'OPEN') return isOpenEvent(e)
    if (status !== 'ANY' && e.status !== status) return false
    return true
  })
  const openCount = all.filter(isOpenEvent).length
  const statusCounts = STATUSES.map((s) => ({ s, n: all.filter((e) => e.status === s).length })).filter((x) => x.n > 0)
  const simulated = all.some((e) => e.isSimulated)
  const tiles: { key: 'ANY' | 'OPEN'; label: string; value: number; note: string }[] = [
    { key: 'ANY', label: 'Events', value: all.length, note: 'Show every event' },
    { key: 'OPEN', label: 'Open', value: openCount, note: 'Not yet reviewed or closed' },
  ]
  return (
    <div className="tab-page">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Review events</h1>
        <p>
          <span>Event history</span>
          <span>{workspace === 'demo' ? 'Simulated demo' : 'Mission records'}</span>
          <span>Source, delivery to the wrist, and review</span>
        </p>
      </header>

      <section className="tab-stats" aria-label="Event counts">
        {tiles.map((t) => (
          <button key={t.key} type="button" className="tab-card tab-stat" aria-pressed={status === t.key} onClick={() => setStatus(t.key)}>
            <span className="tab-stat-label">{t.label}</span>
            <span className="tab-stat-value">{t.value}</span>
            <span className="tab-stat-note">{t.note}</span>
          </button>
        ))}
        <div className="tab-card tab-stat">
          <span className="tab-stat-label">Reviewed or closed</span>
          <span className="tab-stat-value">{all.length - openCount}</span>
          <span className="tab-stat-note">A review is not a medical clearance</span>
        </div>
      </section>

      <section className="panel px-5 py-5" aria-labelledby="status-mix-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="status-mix-title" className="label">Where each event stands</h2>
          <span className="text-[12px] text-ink-3">Select a status to filter the list</span>
        </div>
        {all.length ? (
          <>
            <div className="tab-strip mt-3" role="img" aria-label={statusCounts.map((x) => `${x.n} ${STATUS_META[x.s].label.toLowerCase()}`).join(', ')}>
              {statusCounts.map((x) => (
                <span key={x.s} className={TONE[STATUS_META[x.s].tone].bg} style={{ flexGrow: x.n }} title={`${STATUS_META[x.s].label}: ${x.n}`} />
              ))}
            </div>
            <div className="tab-legend">
              {statusCounts.map((x) => (
                <button key={x.s} type="button" aria-pressed={status === x.s} onClick={() => setStatus(status === x.s ? 'ANY' : x.s)} className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 ${status === x.s ? 'bg-[#1a3557] text-white' : ''}`}>
                  <span className={`status-mark ${TONE[STATUS_META[x.s].tone].bg}`} aria-hidden />
                  {STATUS_META[x.s].label} <b>{x.n}</b>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-ink-3">No events recorded.</p>
        )}
      </section>

      <section className="panel px-5 pt-5 pb-4" aria-labelledby="timeline-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="timeline-title" className="label">Timeline</h2>
          <span className="flex items-center gap-3 text-[12px] text-ink-3">
            {simulated && <SimTag />}
            <span className="tnum">{rows.length} shown</span>
          </span>
        </div>
        <EventTimeline events={rows} />
      </section>

      <Disclosure title="Filters">
      <div className="panel flex flex-wrap items-end gap-3 px-4 py-3" role="search" aria-label="Filter events">
        <label className="flex min-w-[min(100%,260px)] flex-1 flex-col gap-1.5">
          <span className="micro">Search</span>
          <span className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              type="search"
              className="field w-full pl-8"
              placeholder="Event ID, reason code, crew member, reviewer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="event-search"
            />
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Status</span>
          <select className="field" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} data-testid="filter-status">
            <option value="ANY">Any</option>
            <option value="OPEN">Open (not reviewed)</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Category</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            <option value="ANY">Any</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Astronaut</span>
          <select className="field" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All crew</option>
            {subjectsOf(ds).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="micro">Data</span>
          <Pill tone={workspace === 'demo' ? 'violet' : 'cyan'} className="h-8">
            {workspace === 'demo' ? 'Simulated demo only' : 'Real mission records only'}
          </Pill>
        </div>
      </div>
      </Disclosure>

      <section aria-labelledby="audit-title">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 id="audit-title" className="display faded-label tab-section-title">Audit trail</h2>
          <span className="text-[12px] text-ink-3 tnum">
            {rows.length} of {all.length}
          </span>
        </header>
        <table className="event-cards" data-testid="events-table">
          <thead>
            <tr>
              <th>Created (UTC)</th>
              <th>Category</th>
              <th>Astronaut</th>
              <th>Source</th>
              <th>Reason codes</th>
              <th>Status</th>
              <th>On the watch</th>
              <th>Review</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const ack = ackLabel(e)
              const ev = evidenceLabel(e, ds)
              return (
                <tr key={e.eventId} className="row-link" style={{ '--tone': TONE[CATEGORY_META[e.category].tone].stroke } as CSSProperties} onClick={() => navigate(href.event(e.eventId))}>
                  <td className="event-card-lead" data-label="Created (UTC)">
                    <a href={href.event(e.eventId)} className="text-[15px] font-semibold tnum text-ink hover:underline" onClick={(x) => x.stopPropagation()}>
                      {utcStamp(e.createdAt)}
                    </a>
                    <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{e.eventId}</div>
                  </td>
                  <td data-label="Category">
                    <span className={`font-semibold ${TONE[CATEGORY_META[e.category].tone].text}`}>{CATEGORY_META[e.category].label}</span>
                    <div className={`text-[11px] ${TONE[SEVERITY_META[e.severity].tone].text}`}>{SEVERITY_META[e.severity].label}</div>
                  </td>
                  <td className="text-ink-2" data-label="Astronaut">
                    {subjectLabel(e.subjectId)} {e.isSimulated && <SimTag className="ml-1" />}
                  </td>
                  <td className="text-ink-2" data-label="Source">{ORIGIN_LABEL[e.origin.kind]}</td>
                  <td data-label="Reason codes">
                    <div className="flex flex-wrap gap-1">
                      {e.reasonCodes.map((c) => (
                        <span key={c} className="font-mono text-[12px] text-ink-2">
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Status">
                    <Pill tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</Pill>
                  </td>
                  <td className={TONE[ack.tone].text} data-label="On the watch">{ack.text}</td>
                  <td className={TONE[REVIEW_META[e.review.state].tone].text} data-label="Review">
                    {REVIEW_META[e.review.state].label}
                    {e.review.reviewer && <div className="text-[11px] text-ink-3">by {e.review.reviewer}</div>}
                  </td>
                  <td className={ev.ok ? 'text-ink-2' : 'text-ink'} data-label="Evidence">{ev.text}</td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="text-ink-3">
                  {q ? `No event matches “${query.trim()}”.` : 'No events match these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
