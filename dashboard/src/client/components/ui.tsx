import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

/**
 * One entry per meaning. `text` and `border` make a tag; `solid` is the filled alert label
 * (with its own text colour); `dot` marks a row; `stroke` is the raw colour for SVG, bars and glows.
 */
export const TONE: Record<Tone, { text: string; border: string; bg: string; solid: string; dot: string; stroke: string }> = {
  mint: { text: 'text-mint', border: 'border-mint/40', bg: 'bg-mint', solid: 'bg-mint text-[#03140c]', dot: 'bg-mint', stroke: 'var(--color-mint)' },
  cyan: { text: 'text-cyan', border: 'border-cyan/40', bg: 'bg-cyan', solid: 'bg-cyan text-[#03101c]', dot: 'bg-cyan', stroke: 'var(--color-cyan)' },
  violet: { text: 'text-violet', border: 'border-violet/45', bg: 'bg-violet', solid: 'bg-violet text-[#0d0624]', dot: 'bg-violet', stroke: 'var(--color-violet)' },
  coral: { text: 'text-coral', border: 'border-coral/45', bg: 'bg-coral', solid: 'bg-coral text-[#1c0307]', dot: 'bg-coral', stroke: 'var(--color-coral)' },
  amber: { text: 'text-amber', border: 'border-amber/45', bg: 'bg-amber', solid: 'bg-amber text-[#1c1203]', dot: 'bg-amber', stroke: 'var(--color-amber)' },
  neutral: { text: 'text-ink-2', border: 'border-line', bg: 'bg-raised', solid: 'bg-ink-2 text-void', dot: 'bg-ink-3', stroke: 'var(--color-ink-2)' },
  muted: { text: 'text-ink-3', border: 'border-line', bg: 'bg-transparent', solid: 'bg-raised text-ink-2', dot: 'bg-ink-3', stroke: 'var(--color-ink-3)' },
}

/** A status tag: a dark glass chip with coloured text and a matching dot. Never a tinted fill. */
export function Pill({ tone = 'neutral', children, title, dot = true, className = '' }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  const t = TONE[tone]
  return (
    <span
      title={title}
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border bg-white/[0.035] px-2.5 text-[10.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase ${t.border} ${t.text} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  )
}

/** Shown on every simulated record. Violet is reserved for simulation across the whole app. */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`inline-flex h-[18px] items-center rounded-full border border-violet/55 px-1.5 text-[9.5px] font-bold tracking-[0.1em] text-violet ${className}`}>
      SIM
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`inline-flex h-[18px] items-center rounded-full border border-line px-1.5 text-[9.5px] font-bold tracking-[0.1em] text-ink-2 ${className}`}>
      REAL
    </span>
  )
}

/** The round arrow button in a card's corner: opens the full view of what the card summarises. */
export function CornerLink({ href, label, small = false }: { href: string; label: string; small?: boolean }) {
  return (
    <a href={href} className={`icon-btn ${small ? 'icon-btn-sm' : ''}`} aria-label={label} title={label}>
      <ArrowUpRight size={small ? 14 : 16} strokeWidth={1.75} />
    </a>
  )
}

/** "01" before a section title, AstroKit style. */
export function SectionNo({ n }: { n: number | string }) {
  return (
    <span className="mr-2.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 tnum" aria-hidden>
      {String(n).padStart(2, '0')}
    </span>
  )
}

/** A glass card: a title row (title left, actions right), then the body. */
export function Panel({
  title,
  meta,
  children,
  className = '',
  bodyClassName = 'px-5 pt-2 pb-5',
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
  /** An optional section number shown before the title. */
  no?: number
  /** When set, a round arrow button in the corner links here. */
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
            <div className="flex flex-wrap items-center gap-2">
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
      <div className="text-[13.5px] font-semibold text-ink">{title}</div>
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
  return <code className="code rounded-[6px] border border-white/10 bg-white/[0.04] px-1.5 py-0.5 whitespace-pre-wrap text-ink">{children}</code>
}
