import { X } from 'lucide-react'
import { useEffect } from 'react'
import { focusLabel } from '../../shared/explain'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'

/**
 * Shown for a few seconds after "Trigger simulated watch event". It is a picture of what the
 * watch app would display, labelled as a simulation; no real device is involved.
 */
export function SimWatchOverlay() {
  const { trigger, dismissTrigger, snapshot } = useData()
  useEffect(() => {
    if (!trigger) return
    const id = window.setTimeout(dismissTrigger, 9000)
    return () => window.clearTimeout(id)
  }, [trigger, dismissTrigger])
  if (!trigger) return null
  const event = snapshot?.dataset.events[trigger.eventId] ?? null
  const label = event ? focusLabel(event) : 'REVIEW EVENT'
  return (
    <aside
      aria-live="polite"
      data-testid="sim-watch"
      className="slide-in fixed right-4 top-[100px] z-40 w-[228px] rounded-[6px] border border-violet/60 bg-panel p-3.5 shadow-lg shadow-black/40 sm:right-6"
    >
      <div className="flex items-center justify-between">
        <span className="label text-violet">Simulated watch</span>
        <button className="rounded-md p-1 text-ink-3 hover:text-ink" onClick={dismissTrigger} aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <div className="relative mx-auto mt-3 h-[180px] w-[150px]">
        <div className="absolute inset-0 rounded-[38px] border-[3px] border-line bg-void p-[9px]">
          <div className="flex h-full flex-col items-center justify-center rounded-[29px] bg-black text-center">
            <span className="text-[8px] tracking-[0.06em] text-ink-3">GRAVITYGUARD</span>
            <span className="mt-3 px-2 text-[13px] leading-tight font-bold tracking-[0.06em] text-coral">{label}</span>
            <span className="mt-2 px-3 text-[9.5px] leading-snug tracking-[0.04em] text-ink-2">OPEN MISSION COMPUTER</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-snug text-ink-3">Picture of the watch screen for the demo. Not a real device.</p>
      <button
        className="btn btn-alert btn-sm mt-3 w-full justify-center"
        onClick={() => {
          dismissTrigger()
          navigate(href.event(trigger.eventId))
        }}
      >
        Open evidence
      </button>
    </aside>
  )
}
