import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { maskSecret } from '../lib/integration'

const REVEAL_SECONDS = 15

/**
 * A secret, masked by default. Revealing it is an explicit action that times out, and it is
 * masked again as soon as the page is hidden. Copy puts it on the clipboard without showing it.
 * Only the masked form is in the page while it is hidden, so a screenshot cannot catch it.
 */
export function Secret({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const [until, setUntil] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const [copy, setCopy] = useState<'copied' | 'blocked' | null>(null)
  const shown = until !== null

  useEffect(() => {
    if (until === null) return
    const tick = () => {
      const s = Math.ceil((until - Date.now()) / 1000)
      if (s <= 0) setUntil(null)
      else setLeft(s)
    }
    tick()
    const id = window.setInterval(tick, 250)
    const hide = () => document.hidden && setUntil(null)
    document.addEventListener('visibilitychange', hide)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [until])

  useEffect(() => {
    if (!copy) return
    const id = window.setTimeout(() => setCopy(null), 2200)
    return () => window.clearTimeout(id)
  }, [copy])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <code
          className={`min-w-0 rounded-lg border bg-void px-3 py-2 font-mono text-[12px] break-all ${shown ? 'border-amber/50 text-ink' : 'border-line text-ink-2'}`}
          aria-label={`${label}, ${shown ? 'shown' : 'hidden'}`}
          data-testid={testId}
          data-revealed={shown}
        >
          {shown ? value : maskSecret(value)}
        </code>
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={shown} onClick={() => setUntil(shown ? null : Date.now() + REVEAL_SECONDS * 1000)}>
          {shown ? <EyeOff size={13} /> : <Eye size={13} />}
          {shown ? `Hide · ${left} s` : 'Reveal'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopy('copied')
            } catch {
              setCopy('blocked')
            }
          }}
        >
          {copy === 'copied' ? <Check size={13} /> : <Copy size={13} />}
          {copy === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-[11.5px] text-ink-3" role="status">
        {copy === 'blocked'
          ? 'This browser blocked the clipboard. Reveal it and copy it by hand.'
          : shown
            ? `Visible for ${left} s, and hidden at once if you switch away from this page.`
            : null}
      </p>
    </div>
  )
}
