import { useState } from 'react'
import type { EventCategoryT, EventStatusT } from '../../shared/contract'
import { utcStamp } from '../../shared/format'
import { ackLabel, evidenceLabel } from '../components/Events'
import { Panel, Pill, SimTag, TONE } from '../components/ui'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SEVERITY_META, sortEvents, STATUS_META, subjectLabel, subjectsOf } from '../lib/view'

export function EventHistory() {
  const { snapshot } = useData()
  const [status, setStatus] = useState<'ANY' | 'OPEN' | EventStatusT>('ANY')
  const [category, setCategory] = useState<'ANY' | EventCategoryT>('ANY')
  const [subject, setSubject] = useState('')
  if (!snapshot) return null
  const ds = snapshot.dataset
  const all = sortEvents(Object.values(ds.events))
  const rows = all.filter((e) => {
    if (subject && e.subjectId !== subject) return false
    if (category !== 'ANY' && e.category !== category) return false
    if (status === 'OPEN') return e.status !== 'REVIEWED' && e.status !== 'CLOSED'
    if (status !== 'ANY' && e.status !== status) return false
    return true
  })
  return (
    <div className="flex flex-col gap-5">
      <div className="rise">
        <div className="micro">Event history</div>
        <h1 className="mt-2 font-display text-[clamp(24px,2.6vw,34px)] tracking-[0.06em]">REVIEW EVENTS</h1>
        <p className="mt-2 max-w-[70ch] text-[13.5px] text-ink-2">
          Every event the watch or this computer created, with where it came from, whether it reached the wrist, and whether a person has reviewed it.
        </p>
      </div>
      <div className="panel flex flex-wrap items-end gap-4 px-5 py-4" role="search" aria-label="Filter events">
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
      </div>
      <Panel title="Events" meta={<span className="text-[12px] text-ink-3">{rows.length} of {all.length}</span>} bodyClassName="px-2 pb-3">
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
                      <span className={`font-bold ${TONE[CATEGORY_META[e.category].tone].text}`}>{CATEGORY_META[e.category].label}</span>
                      <div className={`text-[11px] ${TONE[SEVERITY_META[e.severity].tone].text}`}>{SEVERITY_META[e.severity].label}</div>
                    </td>
                    <td className="text-ink-2">
                      {subjectLabel(e.subjectId)} {e.isSimulated && <SimTag className="ml-1" />}
                    </td>
                    <td className="text-ink-2">{ORIGIN_LABEL[e.origin.kind]}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {e.reasonCodes.map((c) => (
                          <span key={c} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
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
                    <td className={ev.ok ? 'text-ink-2' : 'text-amber'}>{ev.text}</td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="text-ink-3">
                    No events match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
