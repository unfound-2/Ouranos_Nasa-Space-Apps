import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

/**
 * One entry per meaning. Text stays in the two text greys; a status is shown as a solid lozenge
 * (`badge`), modelled on Atlassian's bold lozenge: a square-cornered block in the meaning colour
 * with bold text, every pair at least 4.9:1. `stroke` is the raw colour for charts and the 3D model,
 * `bg` fills bars, `dot` is kept for chart legends.
 */
export const TONE: Record<Tone, { text: string; border: string; bg: string; solid: string; dot: string; stroke: string; badge: string }> = {
  mint: { text: 'text-ink', border: 'border-line', bg: 'bg-mint', solid: 'bg-[#1a7f4b] text-white', dot: 'bg-mint', stroke: '#30a46c', badge: 'bg-[#1a7f4b] text-white' },
  cyan: { text: 'text-ink', border: 'border-line', bg: 'bg-cyan', solid: 'bg-[#0068d6] text-white', dot: 'bg-cyan', stroke: '#0090ff', badge: 'bg-[#0068d6] text-white' },
  violet: { text: 'text-ink', border: 'border-line', bg: 'bg-violet', solid: 'bg-[#6e56cf] text-white', dot: 'bg-violet', stroke: '#6e56cf', badge: 'bg-[#6e56cf] text-white' },
  coral: { text: 'text-ink', border: 'border-line', bg: 'bg-coral', solid: 'bg-[#d13438] text-white', dot: 'bg-coral', stroke: '#e5484d', badge: 'bg-[#d13438] text-white' },
  amber: { text: 'text-ink', border: 'border-line', bg: 'bg-amber', solid: 'bg-[#ffc53d] text-[#1f1300]', dot: 'bg-amber', stroke: '#ffc53d', badge: 'bg-[#ffc53d] text-[#1f1300]' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-ink-3', solid: 'bg-[#454545] text-white', dot: 'bg-ink-3', stroke: '#8f8f8f', badge: 'bg-[#454545] text-white' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-raised', solid: 'bg-[#262626] text-[#a1a1a1]', dot: 'bg-line-strong', stroke: '#484848', badge: 'bg-[#262626] text-[#a1a1a1]' },
}

export const BADGE = 'inline-flex h-[22px] shrink-0 items-center rounded-[4px] px-2 text-[11px] leading-none font-bold tracking-[0.04em] whitespace-nowrap uppercase'

/** A status lozenge: a solid, square-cornered block in the meaning colour with bold text. */
export function Pill({ tone = 'neutral', children, title, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  return (
    <span title={title} className={`${BADGE} ${TONE[tone].badge} ${className}`}>
      {children}
    </span>
  )
}

/** Shown on every simulated record. Violet is reserved for simulation. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`${BADGE} ${TONE.violet.badge} h-[20px] px-1.5 text-[10px] ${className}`}>
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`${BADGE} ${TONE.neutral.badge} h-[20px] px-1.5 text-[10px] ${className}`}>
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
