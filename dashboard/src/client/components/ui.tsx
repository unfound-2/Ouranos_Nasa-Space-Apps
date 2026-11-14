import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

export const TONE: Record<Tone, { text: string; border: string; bg: string; dot: string; stroke: string }> = {
  mint: { text: 'text-mint', border: 'border-mint/40', bg: 'bg-mint/10', dot: 'bg-mint', stroke: 'var(--color-mint)' },
  cyan: { text: 'text-cyan', border: 'border-cyan/40', bg: 'bg-cyan/10', dot: 'bg-cyan', stroke: 'var(--color-cyan)' },
  violet: { text: 'text-violet', border: 'border-violet/45', bg: 'bg-violet/12', dot: 'bg-violet', stroke: 'var(--color-violet)' },
  coral: { text: 'text-coral', border: 'border-coral/45', bg: 'bg-coral/12', dot: 'bg-coral', stroke: 'var(--color-coral)' },
  amber: { text: 'text-amber', border: 'border-amber/45', bg: 'bg-amber/10', dot: 'bg-amber', stroke: 'var(--color-amber)' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-raised', dot: 'bg-ink-2', stroke: 'var(--color-ink-2)' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-transparent', dot: 'bg-ink-3', stroke: 'var(--color-ink-3)' },
}

export function Pill({ tone = 'neutral', children, title, dot = false, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  const t = TONE[tone]
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] whitespace-nowrap ${t.border} ${t.bg} ${t.text} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  )
}

/** Shown on every simulated record. Violet is reserved for simulation across the whole app. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span
      title="Simulated record. Not astronaut data."
      className={`inline-flex h-5 items-center rounded-md border border-violet/50 bg-violet/12 px-1.5 font-mono text-[10px] font-bold tracking-[0.1em] text-violet ${className}`}
    >
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span
      title="Real recorded data"
      className={`inline-flex h-5 items-center rounded-md border border-line px-1.5 font-mono text-[10px] font-bold tracking-[0.1em] text-ink-2 ${className}`}
    >
      REAL
    </span>
  )
}

export function Panel({
  title,
  meta,
  children,
  className = '',
  bodyClassName = 'px-5 pb-5',
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
    <section id={id} className={`panel ${className}`}>
      {(title || meta) && (
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
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
    <div className="well flex flex-col items-start gap-2 px-5 py-6">
      <div className="label text-ink">{title}</div>
      {children && <div className="max-w-[62ch] text-[13px] text-ink-2">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function KV({ k, children, mono = false }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="micro">{k}</dt>
      <dd className={`mt-1 text-[13px] break-words text-ink ${mono ? 'font-mono text-[12px] whitespace-pre-wrap' : ''}`}>{children}</dd>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-hair bg-void px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">{children}</code>
}
