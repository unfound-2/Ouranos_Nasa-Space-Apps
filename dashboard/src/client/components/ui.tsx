import { Activity, ArrowUpRight, Check, Flag, FlaskConical, Minus, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '../lib/view'

/**
 * One entry per meaning. Text stays in the two text greys; statuses are an icon and a word (Pill).
 * `stroke` is the raw colour for charts and the 3D model, `bg` fills bars, `dot` is for chart
 * legends. `badge` and `solid` are kept for compatibility and unused by the interface.
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

/** The icon each meaning gets when a caller does not pass one. */
const TONE_ICON: Record<Tone, LucideIcon> = {
  mint: Check,
  cyan: Check,
  violet: FlaskConical,
  coral: Flag,
  amber: TriangleAlert,
  neutral: Minus,
  muted: Minus,
}

/**
 * A status: a small grey line icon, then the word, in one text colour. No fill, no border and no
 * colour, like GitHub's checks list. The word carries the meaning; the icon makes it scannable.
 */
export function Pill({
  tone = 'neutral',
  children,
  title,
  icon,
  className = '',
  testId,
}: {
  tone?: Tone
  children: ReactNode
  title?: string
  icon?: LucideIcon
  dot?: boolean
  className?: string
  testId?: string
}) {
  const Icon = icon ?? TONE_ICON[tone]
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 text-[13px] leading-5 ${tone === 'muted' ? 'text-ink-2' : 'text-ink'} ${className}`} data-testid={testId}>
      <Icon size={14} strokeWidth={2} className="shrink-0 text-ink-2" aria-hidden />
      {children}
    </span>
  )
}

/** Shown on every simulated record: a flask and "Simulated". */
export function SimTag({ className = '' }: { className?: string }) {
  return (
    <span title="Simulated record. Not astronaut data." className={`inline-flex items-center gap-1.5 text-[13px] leading-5 whitespace-nowrap text-ink-2 ${className}`}>
      <FlaskConical size={14} strokeWidth={2} className="shrink-0" aria-hidden />
      Simulated
    </span>
  )
}

export function RealTag({ className = '' }: { className?: string }) {
  return (
    <span title="Real recorded data" className={`inline-flex items-center gap-1.5 text-[13px] leading-5 whitespace-nowrap text-ink-2 ${className}`}>
      <Activity size={14} strokeWidth={2} className="shrink-0" aria-hidden />
      Real
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

export function Disclosure({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <details className={`panel dashboard-disclosure ${className}`}>
      <summary>{title}</summary>
      <div className="dashboard-disclosure-content">{children}</div>
    </details>
  )
}
