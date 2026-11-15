import { Bell } from 'lucide-react'
import { eventTitle, buildEventContext } from '../../shared/explain'
import { utcStamp } from '../../shared/format'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { isOpen, SEVERITY_META, sortEvents } from '../lib/view'

export function WarningInbox() {
  const { snapshot, workspace } = useData()
  const warnings = snapshot && workspace === 'demo' ? sortEvents(Object.values(snapshot.dataset.events)).filter((event) => isOpen(event) && event.isSimulated && event.severity === 'PRIORITY_REVIEW') : []
  if (!warnings.length) return null
  return (
    <details className="fixed top-[64px] right-4 z-40 max-w-[calc(100vw-2rem)] rounded-xl bg-[#17191e]">
      <summary className="flex cursor-pointer list-none items-center justify-end gap-2 px-3 py-2 text-[13px]">
        <Bell size={16} aria-hidden />
        <span role="status" aria-atomic="true">
          {warnings.length} simulated {warnings.length === 1 ? 'warning' : 'warnings'}
        </span>
      </summary>
      <div className="w-[320px] max-w-full px-3 pb-3">
        {snapshot && (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {warnings.map((event) => (
              <li key={event.eventId}>
                <a className="block rounded-lg bg-panel px-3 py-2 hover:bg-raised" href={href.event(event.eventId)} onClick={(e) => {
                  const inbox = e.currentTarget.closest('details')
                  if (inbox) inbox.open = false
                }}>
                  <span className="block">{eventTitle(buildEventContext(event, snapshot.dataset, snapshot.serverTime))}</span>
                  <span className="block text-[12px] text-ink-2">{SEVERITY_META[event.severity].label}<span className="ml-2">{utcStamp(event.createdAt)}</span></span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <a className="mt-2 inline-block underline" href={href.events}>Review events</a>
      </div>
    </details>
  )
}
