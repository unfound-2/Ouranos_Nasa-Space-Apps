import { Search } from 'lucide-react'
import { useState } from 'react'
import type { EventCategoryT, EventStatusT } from '../../shared/contract'
import { utcStamp } from '../../shared/format'
import { ackLabel, evidenceLabel } from '../components/Events'
import { Disclosure, Pill, SimTag, TONE } from '../components/ui'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SEVERITY_META, sortEvents, STATUS_META, subjectLabel, subjectsOf } from '../lib/view'

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
    if (status === 'OPEN') return e.status !== 'REVIEWED' && e.status !== 'CLOSED'
    if (status !== 'ANY' && e.status !== status) return false
    return true
  })
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[28px] text-ink">Review events</h1>
          <p className="mt-1 text-[12.5px] text-ink-2">Event history · {workspace === 'demo' ? 'simulated demo' : 'mission records'} · source, delivery to the wrist, and review</p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="micro">Events</dt>
            <dd className="text-[14px] font-semibold text-ink tnum">{all.length}</dd>
          </div>
          <div>
            <dt className="micro">Open</dt>
            <dd className="text-[14px] font-semibold text-ink tnum">{all.filter((e) => e.status !== 'REVIEWED' && e.status !== 'CLOSED').length}</dd>
          </div>
          <div>
            <dt className="micro">Reviewed or closed</dt>
            <dd className="text-[14px] font-semibold text-ink tnum">{all.filter((e) => e.status === 'REVIEWED' || e.status === 'CLOSED').length}</dd>
          </div>
        </dl>
      </header>
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
            {(Object.keys(STATUS_META) as EventStatusT[]).map((s) => (
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
            {(Object.keys(CATEGORY_META) as EventCategoryT[]).map((c) => (
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
      <section className="panel overflow-hidden">
        <header className="pane-head">
          <h2 className="label">Audit trail</h2>
          <span className="text-[11.5px] text-ink-3 tnum">
            {rows.length} of {all.length}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[1100px]" data-testid="events-table">
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
                  <tr key={e.eventId} className="row-link" onClick={() => navigate(href.event(e.eventId))}>
                    <td>
                      <a href={href.event(e.eventId)} className="tnum text-ink hover:underline" onClick={(x) => x.stopPropagation()}>
                        {utcStamp(e.createdAt)}
                      </a>
                      <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{e.eventId}</div>
                    </td>
                    <td>
                      <span className={`font-semibold whitespace-nowrap ${TONE[CATEGORY_META[e.category].tone].text}`}>{CATEGORY_META[e.category].label}</span>
                      <div className={`text-[11px] ${TONE[SEVERITY_META[e.severity].tone].text}`}>{SEVERITY_META[e.severity].label}</div>
                    </td>
                    <td className="text-ink-2">
                      {subjectLabel(e.subjectId)} {e.isSimulated && <SimTag className="ml-1" />}
                    </td>
                    <td className="text-ink-2">{ORIGIN_LABEL[e.origin.kind]}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {e.reasonCodes.map((c) => (
                          <span key={c} className="font-mono text-[12px] text-ink-2">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <Pill tone={STATUS_META[e.status].tone}>{STATUS_META[e.status].label}</Pill>
                    </td>
                    <td className={TONE[ack.tone].text}>{ack.text}</td>
                    <td className={TONE[REVIEW_META[e.review.state].tone].text}>
                      {REVIEW_META[e.review.state].label}
                      {e.review.reviewer && <div className="text-[11px] text-ink-3">by {e.review.reviewer}</div>}
                    </td>
                    <td className={ev.ok ? 'text-ink-2' : 'text-ink'}>{ev.text}</td>
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
        </div>
      </section>
    </div>
  )
}
