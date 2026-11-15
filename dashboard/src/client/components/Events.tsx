import type { StoredEvent } from '../../shared/contract'
import type { Dataset } from '../../shared/dataset'
import { resolveEvidence } from '../../shared/dataset'
import type { TimelineItem } from '../../shared/explain'
import { utcDate, utcStamp, utcTime } from '../../shared/format'
import { href } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SEVERITY_META, STATUS_META, subjectLabel } from '../lib/view'
import { Pill, SimTag, TONE } from './ui'

export function ackLabel(e: StoredEvent): { text: string; tone: 'cyan' | 'muted' | 'amber' } {
  if (e.acknowledgement) return { text: `Acknowledged ${utcTime(e.acknowledgement.acknowledgedAt)}${e.acknowledgement.via === 'SIMULATED_WATCH' ? ' (sim)' : ''}`, tone: 'cyan' }
  if (e.delivery.state === 'PRESENTED') return { text: 'Presented · not acknowledged', tone: 'muted' }
  if (e.delivery.state === 'WATCH_UNREACHABLE') return { text: 'Not delivered · watch unreachable', tone: 'amber' }
  if (e.delivery.state === 'UNCONFIRMED') return { text: 'Delivery unconfirmed', tone: 'amber' }
  if (e.delivery.state === 'QUEUED') return { text: 'Queued for the watch', tone: 'muted' }
  return { text: 'No delivery attempted', tone: 'muted' }
}

export function evidenceLabel(e: StoredEvent, ds: Dataset): { text: string; ok: boolean } {
  const resolved = resolveEvidence(e, ds)
  const found = resolved.filter((r) => r.found).length
  if (e.sessionId && !ds.sessions[e.sessionId]) return { text: 'Session not received yet', ok: false }
  if (!resolved.length) return { text: e.sessionId ? 'Session record available' : 'No evidence cited', ok: !!e.sessionId }
  return { text: `${found} of ${resolved.length} cited records available`, ok: found === resolved.length }
}

/** One row of the active-events feed. The whole row links to the investigation view. */
export function EventRow({ e, ds, compact = false }: { e: StoredEvent; ds: Dataset; compact?: boolean }) {
  const cat = CATEGORY_META[e.category]
  const status = STATUS_META[e.status]
  const ack = ackLabel(e)
  const ev = evidenceLabel(e, ds)
  const review = REVIEW_META[e.review.state]
  return (
    <a
      href={href.event(e.eventId)}
      data-testid={`event-row-${e.eventId}`}
      className="group block rounded-[4px] border border-hair bg-void/30 px-4 py-3.5 transition-colors hover:border-line hover:bg-raised/60"
    >
      <div className="flex items-start gap-3">
        <span className={`status-mark mt-1.5 ${TONE[SEVERITY_META[e.severity].tone].dot} ${e.status === 'REVIEWED' || e.status === 'CLOSED' ? 'opacity-40' : ''}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate text-[11.5px] font-bold uppercase tracking-[0.04em] ${TONE[cat.tone].text}`}>{cat.label}</span>
            <Pill tone={status.tone} className="shrink-0">
              {status.label}
            </Pill>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink">
            {subjectLabel(e.subjectId)} <span className="text-ink-3">·</span> <span className="tnum text-[11.5px] text-ink-2">{utcStamp(e.createdAt)}</span>
            {e.isSimulated && <SimTag />}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.reasonCodes.map((c) => (
              <span key={c} className="font-mono text-[12px] text-ink-2">
                {c}
              </span>
            ))}
          </div>
          {!compact && (
            <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px]">
              <div className="truncate text-ink-3">
                Source <span className="text-ink-2">{ORIGIN_LABEL[e.origin.kind]}</span>
              </div>
              <div className={`truncate ${TONE[ack.tone].text}`}>{ack.text}</div>
              <div className={`truncate ${TONE[review.tone].text}`}>{review.label}</div>
              <div className={`truncate ${ev.ok ? 'text-ink-2' : 'text-ink'}`}>{ev.text}</div>
            </dl>
          )}
        </div>
      </div>
    </a>
  )
}

const TONE_DOT: Record<TimelineItem['tone'], string> = {
  neutral: 'bg-ink-3',
  data: 'bg-cyan',
  symptom: 'bg-coral',
  event: 'bg-violet',
  review: 'bg-mint',
  warning: 'bg-amber',
}

/** A vertical log of what happened, with UTC times. Only recorded transitions appear. */
export function Timeline({ items, empty = 'Nothing recorded yet.' }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <div className="text-[13px] text-ink-3">{empty}</div>
  let lastDate = ''
  return (
    <ol className="relative" data-testid="timeline">
      {items.map((i, idx) => {
        const date = utcDate(i.at)
        const showDate = date !== lastDate
        lastDate = date
        return (
          <li key={`${i.kind}-${idx}`} className="relative grid grid-cols-[74px_18px_1fr] gap-x-2 pb-4 last:pb-0">
            <div className="pt-0.5 text-right tnum text-[11px] leading-tight text-ink-2">
              {utcTime(i.at).replace(' UTC', '')}
              {showDate && <div className="mt-0.5 text-[9.5px] text-ink-3">{date}</div>}
            </div>
            <div className="relative flex justify-center">
              {idx < items.length - 1 && <span className="absolute top-3 bottom-[-6px] w-px bg-line" aria-hidden />}
              <span className={`status-mark relative mt-1.5 ring-4 ring-panel ${TONE_DOT[i.tone]}`} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-ink">{i.label}</div>
              {i.detail && <div className="mt-0.5 text-[11.5px] text-ink-3">{i.detail}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
