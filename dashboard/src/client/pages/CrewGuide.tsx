import { BookOpen, ClipboardList, Stethoscope } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { GuideEntrySchema, type GuideEntry } from '../../shared/crew-guide'
import bundled from '../../shared/crew-guide.json'
import { href } from '../lib/router'
import './tabs.css'

const bundledEntries = GuideEntrySchema.array().parse(bundled)
const catalogUrl = 'https://ohbufsembuzekdnwlpsd.supabase.co/rest/v1/gg_crew_guide?select=entry&order=id'
const readKey = 'sb_publishable_2dFD1lilS9AMFmn4rrWNiQ_EpY4cBpd'
const catalogSchema = z.array(z.object({ entry: GuideEntrySchema })).min(1)
const kindLabels = { workflow: 'Crew workflows', condition: 'Medical conditions', evidence: 'NASA evidence' } as const
const kindNotes = { workflow: 'Step by step checklists', condition: 'Conditions NASA plans for', evidence: 'Research and reference sources' } as const
const kindIcons = { workflow: ClipboardList, condition: Stethoscope, evidence: BookOpen } as const

export function CrewGuide({ topic }: { topic?: string }) {
  const [entries, setEntries] = useState<GuideEntry[]>(bundledEntries)
  const [origin, setOrigin] = useState('Bundled NASA catalog')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<GuideEntry['kind'] | 'all'>('all')
  const [category, setCategory] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      const response = await fetch(catalogUrl, { headers: { apikey: readKey }, signal: abort.signal })
      if (!response.ok) return
      const catalog = catalogSchema.parse(await response.json())
      if (abort.signal.aborted) return
      setEntries(catalog.map(({ entry }) => entry))
      setOrigin('Supabase catalog')
    })().catch(() => { /* The bundled copy remains available offline. */ })
    return () => abort.abort()
  }, [])

  const selected = entries.find(({ id }) => id === topic) ?? entries.find(({ id }) => id === 'reading-check')!
  const needle = query.trim().toLowerCase()
  const visible = entries.filter((entry) => (kind === 'all' || entry.kind === kind) && (!category || entry.category === category) &&
    `${entry.title} ${entry.category}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.kind === 'workflow') - Number(a.kind === 'workflow') || a.title.localeCompare(b.title))
  const kinds = (Object.keys(kindLabels) as GuideEntry['kind'][]).map((k) => ({ k, n: entries.filter((e) => e.kind === k).length }))
  const categories = [...entries.filter((e) => kind === 'all' || e.kind === kind).reduce((m, e) => m.set(e.category, (m.get(e.category) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const largest = Math.max(1, ...categories.map(([, n]) => n))
  const pickKind = (next: GuideEntry['kind'] | 'all') => {
    setKind(next)
    setCategory('')
  }

  return (
    <main className="tab-page mx-auto w-full max-w-5xl">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Crew guide</h1>
        <p><span>{entries.length} entries</span><span>{origin}</span></p>
      </header>

      <section className="guide-kinds" aria-label="Browse by kind">
        {kinds.map(({ k, n }) => {
          const Icon = kindIcons[k]
          return (
            <button key={k} type="button" className="tab-card tab-stat" aria-pressed={kind === k} onClick={() => pickKind(kind === k ? 'all' : k)}>
              <span className="flex items-center justify-between gap-3">
                <span className="tab-stat-label">{kindLabels[k]}</span>
                <Icon size={18} className="text-[#8cceff]" aria-hidden />
              </span>
              <span className="tab-stat-value">{n}</span>
              <span className="tab-stat-note">{kindNotes[k]}</span>
            </button>
          )
        })}
      </section>

      <section className="panel px-5 py-5" aria-labelledby="guide-categories-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="guide-categories-title" className="label">Categories</h2>
          <span className="text-[12px] text-ink-3">{category ? 'Select the category again to show all' : 'Select a category to narrow the topics'}</span>
        </div>
        <div className="guide-categories">
          {categories.map(([name, n]) => (
            <button key={name} type="button" className="guide-category" aria-pressed={category === name} onClick={() => setCategory(category === name ? '' : name)}>
              <span className="guide-category-name">{name}</span>
              <span className="guide-category-bar" aria-hidden><span className="guide-bg-fill" style={{ width: `${(n / largest) * 100}%` }} /></span>
              <span className="guide-category-count">{n === 1 ? '1 entry' : `${n} entries`}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Guide topics" className="panel grid gap-2 p-4">
          <input aria-label="Find a topic" className="field w-full px-3 py-2" placeholder="Find a topic" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="field px-3 py-2" aria-label="Entry type" value={kind} onChange={(event) => pickKind(event.target.value as typeof kind)}>
            <option value="all">All entries</option>
            {Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {category && <p className="px-1 text-[12px] text-ink-2">In {category}</p>}
          <div className="grid max-h-[30vh] gap-1 overflow-auto md:max-h-[58vh]">
            {visible.map(({ id, title }) => (
              <a key={id} href={href.guideTopic(id)} aria-current={selected.id === id ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${selected.id === id ? 'bg-[#1a3557] text-white' : 'text-ink-2 hover:bg-raised'}`}>{title}</a>
            ))}
            {!visible.length && <p className="px-3 text-sm text-ink-2">No matching topics.</p>}
          </div>
        </nav>
        <article className="panel grid gap-5 p-6">
          <header><p className="mb-2 text-sm text-ink-2">{selected.category}</p><h2 className="display faded-label text-[28px]">{selected.title}</h2></header>
          {selected.image && <figure>
            <img src={selected.image.src} alt={selected.image.alt} className="w-full rounded-xl" loading="lazy" />
            {selected.image.caption && <figcaption className="mt-2 text-sm text-ink-2">{selected.image.caption}</figcaption>}
          </figure>}
          {selected.summary && <p className="text-ink-2">{selected.summary}</p>}
          {selected.steps?.length ? <section>
            <h3 className="font-semibold">Steps</h3>
            <ol className="mt-3 grid gap-2">{selected.steps.map((step, i) => (
              <li key={step} className="well grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3 px-3 py-2.5">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#1a3557] text-[12px] font-semibold tnum text-white">{i + 1}</span>
                <span className="pt-1">{step}</span>
              </li>
            ))}</ol>
          </section> : <p className="text-sm text-ink-2">
            {selected.allMission && 'NASA flags this condition for consideration on all missions. '}
            This entry indexes NASA evidence. Use the mission-approved medical procedure for care.
          </p>}
          {selected.kind === 'condition' && <a className="underline" href={href.guideTopic('communications')}>Prepare a ground support handoff</a>}
          <section>
            <h3 className="font-semibold">NASA sources</h3>
            <ul className="mt-2 grid gap-2">{selected.sources.map(({ title, url }) =>
              <li key={url}><a className="text-sm underline" href={url} target="_blank" rel="noreferrer">{title}</a></li>
            )}</ul>
          </section>
          {selected.kind === 'workflow' && <p className="text-xs text-ink-2">Ouranos checklist based on NASA references. Follow your mission’s approved procedures for medical decisions.</p>}
        </article>
      </div>
    </main>
  )
}
