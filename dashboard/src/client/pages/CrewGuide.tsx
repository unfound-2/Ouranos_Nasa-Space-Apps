import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { GuideEntry, Checklist } from '../../shared/crew-guide'
import { guideCandidates } from '../../shared/guide-library'
import { guideCatalog } from '../../shared/guide-index'
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
  const [entries, setEntries] = useState(guideCatalog)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  useEffect(() => {
    let active = true
    void request<GuideEntry[]>('GET', '/crew-guide').then((guides) => {
      if (active) {
        const combined = new Map(guideCatalog.map((entry) => [entry.id, entry]))
        for (const guide of guides) combined.set(guide.id, guide)
        setEntries([...combined.values()])
      }
    }).catch(() => { /* checklists are available on the device */ })
    return () => { active = false }
  }, [])
  const needle = query.trim().toLowerCase()
  const categories = [...new Set(entries.map((entry) => entry.category))]
  const visible = entries.filter((entry) => (!category || entry.category === category) &&
    `${entry.title} ${entry.category} ${entry.summary} ${(entry.steps ?? []).join(' ')}`.toLowerCase().includes(needle))
  const selected = visible.find(({ id }) => id === topic) ?? visible[0]

  const related = selected && selected.kind !== 'workflow' ? guideCandidates('reading-check', selected.title)[0] : null

  return (
    <div className="tab-page crew-guide mx-auto w-full max-w-5xl">
      <header className="mission-intro">
        <h1 className="display faded-label">Crew guide</h1>
        <p>What to check, record and share.</p>
      </header>
      <div className="guide-search">
        <label htmlFor="guide-search" className="sr-only">Search the crew guide</label>
        <input id="guide-search" className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search symptoms, readings or actions" />
        <select className="field guide-category-select" aria-label="Guide category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="guide-browser">
        <nav className="guide-index" aria-label="Crew guide topics">
          {visible.map((entry) => (
            <a key={entry.id} href={href.guideTopic(entry.id)} aria-current={selected?.id === entry.id ? 'page' : undefined}>
              <span>{entry.title}</span>
              <small>{entry.category}</small>
            </a>
          ))}
          {visible.length === 0 && <p className="p-4 text-sm text-ink-2">No guides match. Try another search or category.</p>}
        </nav>
        {selected ? (
          <article className="tab-card guide-content" aria-labelledby="selected-guide-title">
            <small className="text-ink-2">{selected.category}</small>
            <h2 id="selected-guide-title" className="text-2xl font-semibold">{selected.title}</h2>
            <p className="text-ink-2">{selected.summary || (selected.kind === 'condition'
              ? `NASA includes ${selected.title.toLowerCase()} in its spaceflight medical planning reference. Open the NASA source for the original context and requirements.`
              : `NASA research and reference material on ${selected.title.replace(/^Risk of /, '').toLowerCase()}. Open the source to read the evidence and its limitations.`)}</p>
            {Boolean(selected.steps?.length) && <ol className="list-decimal space-y-4 pl-6">
              {selected.steps?.map((step) => <li key={step}>{step}</li>)}
            </ol>}
            {selected.image && <figure><img src={selected.image.src} alt={selected.image.alt} loading="lazy" /><figcaption>{selected.image.caption}</figcaption></figure>}
            {related && <a className="nasa-source" href={href.guideTopic(related.id)} onClick={() => { setQuery(''); setCategory('') }}>
              <span><strong>Related crew checklist</strong><small>{related.title}</small></span><ArrowUpRight size={16} aria-hidden />
            </a>}
            {selected.sources.map((source) => <NasaGuideLink key={source.url} source={source} />)}
          </article>
        ) : <section className="tab-card guide-content"><h2 className="text-xl font-semibold">No matching guide</h2><p>Try searching for a symptom or measurement.</p></section>}
      </div>
    </div>
  )
}
