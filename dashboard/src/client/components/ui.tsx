import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

export const TONE: Record<Tone, { text: string; border: string; bg: string; dot: string; stroke: string }> = {
  mint: { text: 'text-mint', border: 'border-mint/55', bg: 'bg-mint', dot: 'bg-mint', stroke: 'var(--color-mint)' },
  cyan: { text: 'text-cyan', border: 'border-cyan/55', bg: 'bg-cyan', dot: 'bg-cyan', stroke: 'var(--color-cyan)' },
  violet: { text: 'text-violet', border: 'border-violet/60', bg: 'bg-violet', dot: 'bg-violet', stroke: 'var(--color-violet)' },
  coral: { text: 'text-coral', border: 'border-coral/60', bg: 'bg-coral', dot: 'bg-coral', stroke: 'var(--color-coral)' },
  amber: { text: 'text-amber', border: 'border-amber/60', bg: 'bg-amber', dot: 'bg-amber', stroke: 'var(--color-amber)' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-raised', dot: 'bg-ink-2', stroke: 'var(--color-ink-2)' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-transparent', dot: 'bg-ink-3', stroke: 'var(--color-ink-3)' },
}

/** A status tag: coloured text with a 1 px border. Never a tinted fill. */
export function Pill({ tone = 'neutral', children, title, dot = false, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  const t = TONE[tone]
  return (
    <span title={title} className={`inline-flex h-[22px] items-center gap-1.5 rounded-[3px] border px-2 text-[11px] font-semibold tracking-[0.03em] whitespace-nowrap uppercase ${t.border} ${t.text} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  )
}

/** Shown on every simulated record. Violet is reserved for simulation across the whole app. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`inline-flex h-[18px] items-center rounded-[3px] border border-violet/65 px-1.5 text-[10.5px] font-bold tracking-[0.06em] text-violet ${className}`}>
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`inline-flex h-[18px] items-center rounded-[3px] border border-line px-1.5 text-[10.5px] font-bold tracking-[0.06em] text-ink-2 ${className}`}>
      REAL
    </span>
  )
}

/** A console pane: a title bar, then the body. */
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
  return <code className="code rounded-[3px] border border-hair bg-void px-1.5 py-0.5 whitespace-pre-wrap text-ink-2">{children}</code>
}
