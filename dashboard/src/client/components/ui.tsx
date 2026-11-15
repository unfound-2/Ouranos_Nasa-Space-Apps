import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

/**
 * One entry per meaning. `text` and `border` make a tag; `solid` is the filled alert label
 * (with its own text colour); `dot` marks a row; `stroke` is the raw colour for SVG and bars.
 */
export const TONE: Record<Tone, { text: string; border: string; bg: string; solid: string; dot: string; stroke: string }> = {
  mint: { text: 'text-mint', border: 'border-mint/50', bg: 'bg-mint', solid: 'bg-mint text-panel', dot: 'bg-mint', stroke: 'var(--color-mint)' },
  cyan: { text: 'text-cyan', border: 'border-cyan/50', bg: 'bg-cyan', solid: 'bg-cyan text-panel', dot: 'bg-cyan', stroke: 'var(--color-cyan)' },
  violet: { text: 'text-violet', border: 'border-violet/55', bg: 'bg-violet', solid: 'bg-violet text-panel', dot: 'bg-violet', stroke: 'var(--color-violet)' },
  coral: { text: 'text-coral', border: 'border-coral/55', bg: 'bg-coral', solid: 'bg-coral text-panel', dot: 'bg-coral', stroke: 'var(--color-coral)' },
  amber: { text: 'text-amber', border: 'border-amber/55', bg: 'bg-amber-fill', solid: 'bg-amber-fill text-ink', dot: 'bg-amber-fill', stroke: 'var(--color-amber)' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-raised', solid: 'bg-ink-2 text-panel', dot: 'bg-ink-3', stroke: 'var(--color-ink-2)' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-transparent', solid: 'bg-raised text-ink-2', dot: 'bg-ink-3', stroke: 'var(--color-ink-3)' },
}

/** A status tag: coloured text with a 1 px border. Never a tinted fill. */
export function Pill({ tone = 'neutral', children, title, dot = false, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  const t = TONE[tone]
  return (
    <span title={title} className={`inline-flex h-[20px] items-center gap-1.5 rounded-[2px] border bg-panel px-1.5 text-[10.5px] font-bold tracking-[0.03em] whitespace-nowrap uppercase ${t.border} ${t.text} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  )
}

/** Shown on every simulated record. Violet is reserved for simulation across the whole app. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`inline-flex h-[17px] items-center rounded-[2px] border border-violet/60 bg-panel px-1 text-[10px] font-bold tracking-[0.05em] text-violet ${className}`}>
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`inline-flex h-[17px] items-center rounded-[2px] border border-line bg-panel px-1 text-[10px] font-bold tracking-[0.05em] text-ink-2 ${className}`}>
      REAL
    </span>
  )
}

/** A sheet: a title band, then the body. */
export function Panel({
  title,
  meta,
  children,
  className = '',
  bodyClassName = 'p-4',
  id,
}: {
  title?: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={`panel min-w-0 ${className}`}>
      {(title || meta) && (
        <header className="pane-head flex-wrap">
          {typeof title === 'string' ? <h2 className="label">{title}</h2> : title}
          {meta && <div className="flex flex-wrap items-center gap-2">{meta}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="well flex flex-col items-start gap-1.5 px-4 py-4">
      <div className="text-[13px] font-semibold text-ink">{title}</div>
      {children && <div className="max-w-[62ch] text-[12.5px] text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function KV({ k, children, mono = false }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="micro">{k}</dt>
      <dd className={`mt-0.5 text-[13px] break-words text-ink ${mono ? 'tnum whitespace-pre-wrap' : ''}`}>{children}</dd>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="code rounded-[2px] border border-hair bg-panel-2 px-1.5 py-0.5 whitespace-pre-wrap text-ink">{children}</code>
}
