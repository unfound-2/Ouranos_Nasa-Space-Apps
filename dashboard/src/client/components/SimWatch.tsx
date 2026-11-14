import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'

/**
 * Shown for a few seconds after "Trigger simulated watch event". It is a picture of what the
 * watch app would display, labelled as a simulation; no real device is involved.
 */
export function SimWatchOverlay() {
  const { trigger, dismissTrigger } = useData()
  useEffect(() => {
    if (!trigger) return
    const id = window.setTimeout(dismissTrigger, 9000)
    return () => window.clearTimeout(id)
  }, [trigger, dismissTrigger])
  if (!trigger) return null
  return (
    <aside
      aria-live="polite"
      data-testid="sim-watch"
      className="slide-in fixed right-4 top-[150px] z-40 w-[236px] rounded-2xl border border-violet/45 bg-panel/95 p-4 shadow-2xl shadow-black/60 backdrop-blur sm:right-6"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet">Simulated watch</span>
        <button className="rounded-md p-1 text-ink-3 hover:text-ink" onClick={dismissTrigger} aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <div className="relative mx-auto mt-3 h-[196px] w-[164px]">
        <span className="ripple absolute inset-6 rounded-[44px] border border-coral/50" aria-hidden />
        <span className="ripple absolute inset-6 rounded-[44px] border border-coral/40 [animation-delay:500ms]" aria-hidden />
        <div className="absolute inset-0 rounded-[42px] border-[3px] border-line bg-[#05060a] p-[10px] shadow-inner">
          <div className="flex h-full flex-col items-center justify-center rounded-[32px] bg-black text-center">
            <span className="text-[8px] tracking-[0.2em] text-ink-3">GRAVITYGUARD</span>
            <span className="mt-3 text-[15px] font-bold tracking-[0.06em] text-coral">HEALTH REVIEW</span>
            <span className="mt-2 px-3 text-[9.5px] leading-snug tracking-[0.1em] text-ink-2">OPEN MISSION COMPUTER</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-snug text-ink-3">A picture of the watch screen for the demo. Not a real device and no real haptic.</p>
      <button
        className="btn btn-alert mt-3 w-full justify-center"
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
