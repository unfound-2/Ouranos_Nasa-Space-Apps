import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Checklist } from '../../shared/crew-guide'
import { crewGuides } from '../../shared/guide-library'
import { request } from '../lib/api'
import { href } from '../lib/router'
import './tabs.css'

export function NasaGuideLink({ source }: { source: Checklist['sources'][number] }) {
  return (
    <a className="nasa-source" href={source.url} target="_blank" rel="noreferrer">
      <span><strong>View NASA guide</strong><small>{source.title}</small></span>
      <ArrowUpRight size={16} aria-hidden />
    </a>
  )
}

export function CrewGuide({ topic }: { topic?: string }) {
  const [entries, setEntries] = useState(crewGuides)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let active = true
    void request<Checklist[]>('GET', '/crew-guide').then((guides) => {
      if (active) setEntries(guides)
    }).catch(() => { /* checklists are available on the device */ })
    return () => { active = false }
  }, [])
  const selected = entries.find(({ id }) => id === topic)
  const needle = query.trim().toLowerCase()
  const visible = entries.filter((entry) => `${entry.title} ${entry.category} ${entry.summary}`.toLowerCase().includes(needle))

  return (
    <div className="tab-page mx-auto w-full max-w-5xl">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Crew guide</h1>
        <p>What to check, record and share.</p>
      </header>
      {selected ? (
        <article className="tab-card space-y-5">
          <a href={href.guide} className="text-sm underline">All crew guides</a>
          <h2 className="text-2xl font-semibold">{selected.title}</h2>
          <p className="text-ink-2">{selected.summary}</p>
          <ol className="list-decimal space-y-3 pl-6">
            {selected.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {selected.image && <figure><img src={selected.image.src} alt={selected.image.alt} loading="lazy" /><figcaption>{selected.image.caption}</figcaption></figure>}
          {selected.sources.map((source) => <NasaGuideLink key={source.url} source={source} />)}
        </article>
      ) : (
        <>
          <input className="field mb-4 w-full max-w-sm px-4 py-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the crew guide" aria-label="Search the crew guide" />
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.map((entry) => (
              <a className="tab-card block hover:bg-raised" key={entry.id} href={href.guideTopic(entry.id)}>
                <small className="text-ink-2">{entry.category}</small>
                <h2 className="mt-1 text-lg font-semibold">{entry.title}</h2>
                <p className="mt-1 text-sm text-ink-2">{entry.summary}</p>
              </a>
            ))}
            {visible.length === 0 && <p className="text-ink-2">No guides match that search.</p>}
          </div>
        </>
      )}
    </div>
  )
}
