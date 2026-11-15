import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

/**
 * One entry per meaning. Text stays in the two text greys whatever the meaning (Geist: gray-1000
 * primary, gray-900 secondary); the meaning is carried by a small square mark (`dot`) and, for
 * charts and the 3D model, by `stroke`. `bg` fills bars. `solid` is kept for callers that label an
 * alert: it is plain primary text now.
 */
export const TONE: Record<Tone, { text: string; border: string; bg: string; solid: string; dot: string; stroke: string }> = {
  mint: { text: 'text-ink', border: 'border-line', bg: 'bg-mint', solid: 'text-ink', dot: 'bg-mint', stroke: '#30a46c' },
  cyan: { text: 'text-ink', border: 'border-line', bg: 'bg-cyan', solid: 'text-ink', dot: 'bg-cyan', stroke: '#0090ff' },
  violet: { text: 'text-ink', border: 'border-line', bg: 'bg-violet', solid: 'text-ink', dot: 'bg-violet', stroke: '#6e56cf' },
  coral: { text: 'text-ink', border: 'border-line', bg: 'bg-coral', solid: 'text-ink', dot: 'bg-coral', stroke: '#e5484d' },
  amber: { text: 'text-ink', border: 'border-line', bg: 'bg-amber', solid: 'text-ink', dot: 'bg-amber', stroke: '#ffc53d' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-ink-3', solid: 'text-ink', dot: 'bg-ink-3', stroke: '#8f8f8f' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-raised', solid: 'text-ink-2', dot: 'bg-line-strong', stroke: '#484848' },
}

/** A status: a square mark in the meaning colour, then the label in the text colour. No pill. */
export function Pill({ tone = 'neutral', children, title, dot = true, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-baseline gap-2 text-[13px] leading-5 text-ink ${className}`}>
      {dot && <span className={`status-mark relative top-[0.5px] ${TONE[tone].dot}`} aria-hidden />}
      {children}
    </span>
  )
}

/** Shown on every simulated record: a violet mark and "SIM". Violet is reserved for simulation. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink-2 ${className}`}>
      <span className="status-mark bg-violet" aria-hidden />
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink-2 ${className}`}>
      <span className="status-mark bg-ink-2" aria-hidden />
      REAL
    </span>
  )
}

/** "View" link in a card's title row: opens the full page the card summarises. */
export function CornerLink({ href, label }: { href: string; label: string; small?: boolean }) {
  return (
    <a href={href} className="inline-flex items-center gap-1 text-[13px] text-ink-2 transition-colors hover:text-ink" aria-label={label} title={label}>
      View <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
    </a>
  )
}

/** "01" before a section title. */
export function SectionNo({ n }: { n: number | string }) {
  return (
    <span className="mr-2 font-mono text-[13px] font-normal text-ink-3" aria-hidden>
      {String(n).padStart(2, '0')}
    </span>
  )
}

/** A Geist card: a title row (title left, actions right), then the body. */
export function Panel({
  title,
  meta,
  children,
  className = '',
  bodyClassName = 'px-5 pt-1 pb-5',
  id,
  no,
  href,
  hrefLabel,
}: {
  title?: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
  no?: number
  href?: string
  hrefLabel?: string
}) {
  return (
    <section id={id} className={`panel min-w-0 ${className}`}>
      {(title || meta || href) && (
        <header className="pane-head flex-wrap">
          {typeof title === 'string' ? (
            <h2 className="label">
              {no !== undefined && <SectionNo n={no} />}
              {title}
            </h2>
          ) : (
            title
          )}
          {(meta || href) && (
            <div className="flex flex-wrap items-center gap-3">
              {meta}
              {href && <CornerLink href={href} label={hrefLabel ?? `Open ${typeof title === 'string' ? title.toLowerCase() : 'details'}`} />}
            </div>
          )}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="well flex flex-col items-start gap-1.5 px-5 py-4">
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {children && <div className="max-w-[62ch] text-[14px] text-ink-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function KV({ k, children, mono = false }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="micro">{k}</dt>
      <dd className={`mt-1 text-[14px] break-words text-ink ${mono ? 'font-mono text-[13px] whitespace-pre-wrap' : ''}`}>{children}</dd>
    </div>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="code rounded-[4px] border border-line bg-panel-2 px-1.5 py-0.5 whitespace-pre-wrap text-ink">{children}</code>
}
