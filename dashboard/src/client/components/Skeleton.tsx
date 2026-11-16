import './skeleton.css'

/** Decorative placeholders never masquerade as measurements or interactive controls. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function ReplySkeleton() {
  return <div className="reply-skeleton" role="status" aria-label="Reviewing readings"><span className="sr-only">Reviewing readings…</span><Skeleton /><Skeleton /><Skeleton /></div>
}

export function ModelSkeleton({ label = 'Loading the 3D model' }: { label?: string }) {
  return <div className="model-skeleton" role="status" aria-label={label}><span className="sr-only">{label}</span><Skeleton className="model-placeholder" /></div>
}

const titles: Record<string, string> = { overview: 'Mission health', attention: 'Health review', plan: 'Daily plan', crew: 'Crew Health', events: 'Event History', event: 'Event evidence', session: 'Session report' }
export function PageSkeleton({ page }: { page: string }) {
  const review = page === 'attention'
  return <div className="page-skeleton mx-auto w-full max-w-5xl" role="status" aria-label={`Loading ${titles[page] ?? 'page'}`} data-testid="page-skeleton">
    <span className="sr-only">Loading {titles[page] ?? 'page'}…</span>
    <div aria-hidden="true">
      <header className="mission-intro"><h1 className="display faded-label">{titles[page] ?? 'Loading'}</h1><Skeleton className="skeleton-subtitle" /></header>
      {review ? <><Skeleton className="skeleton-dateline" /><div className="review-skeleton-layout"><div><div className="skeleton-card skeleton-change"><Skeleton /><Skeleton /><Skeleton /></div><div className="skeleton-metrics">{Array.from({length: 6}, (_, i) => <div className="skeleton-card skeleton-metric" key={i}><Skeleton /><Skeleton /><Skeleton /></div>)}</div></div><div className="skeleton-card skeleton-chat"><Skeleton /><Skeleton className="skeleton-chat-art" /><div><Skeleton /><Skeleton /></div></div></div></>
        : page === 'overview' ? <div className="overview-skeleton-layout"><div className="skeleton-card skeleton-chat"><Skeleton /><Skeleton className="skeleton-chat-art" /><Skeleton /></div><div className="skeleton-body"><ModelSkeleton /></div><div className="skeleton-overview-readings">{[0, 1, 2].map(i => <div className="skeleton-card skeleton-chart" key={i}><Skeleton /><Skeleton /><Skeleton /></div>)}</div></div>
        : <div className="generic-skeleton-layout"><div className="skeleton-card skeleton-list">{Array.from({length: 6}, (_, i) => <div className="skeleton-list-row" key={i}><Skeleton /><Skeleton /></div>)}</div><div className="skeleton-card skeleton-chat"><Skeleton /><Skeleton /><Skeleton /></div></div>}
    </div>
  </div>
}
