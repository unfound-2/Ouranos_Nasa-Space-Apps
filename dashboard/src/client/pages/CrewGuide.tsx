import { useEffect, useState } from 'react'
import { z } from 'zod'
import { GuideEntrySchema, type GuideEntry } from '../../shared/crew-guide'
import bundled from '../../shared/crew-guide.json'
import { href } from '../lib/router'

const bundledEntries = GuideEntrySchema.array().parse(bundled)
const catalogUrl = 'https://ohbufsembuzekdnwlpsd.supabase.co/rest/v1/gg_crew_guide?select=entry&order=id'
const readKey = 'sb_publishable_2dFD1lilS9AMFmn4rrWNiQ_EpY4cBpd'
const catalogSchema = z.array(z.object({ entry: GuideEntrySchema })).min(1)
const kindLabels = { workflow: 'Crew workflows', condition: 'Medical conditions', evidence: 'NASA evidence' } as const

export function CrewGuide({ topic }: { topic?: string }) {
  const [entries, setEntries] = useState<GuideEntry[]>(bundledEntries)
  const [origin, setOrigin] = useState('Bundled NASA catalog')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<GuideEntry['kind'] | 'all'>('all')
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
  const visible = entries.filter((entry) => (kind === 'all' || entry.kind === kind) &&
    `${entry.title} ${entry.category}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.kind === 'workflow') - Number(a.kind === 'workflow') || a.title.localeCompare(b.title))

  return (
    <main className="mx-auto grid max-w-5xl gap-5">
      <header>
        <h1 className="display faded-label text-[36px]">Crew guide</h1>
        <p className="mt-1 text-sm text-ink-2">{entries.length} entries <span className="ml-3">{origin}</span></p>
      </header>
      <div className="grid items-start gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Guide topics" className="panel mission-event-card grid gap-2 p-4">
          <input aria-label="Find a topic" className="field w-full px-3 py-2" placeholder="Find a topic" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select className="field px-3 py-2" aria-label="Entry type" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="all">All entries</option>
            {Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="grid max-h-[30vh] gap-1 overflow-auto md:max-h-[58vh]">
            {visible.map(({ id, title }) => (
              <a key={id} href={href.guideTopic(id)} aria-current={selected.id === id ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm ${selected.id === id ? 'bg-[#1a3557] text-white' : 'text-ink-2 hover:bg-raised'}`}>{title}</a>
            ))}
            {!visible.length && <p className="px-3 text-sm text-ink-2">No matching topics.</p>}
          </div>
        </nav>
        <article className="panel mission-event-card grid gap-5 p-6">
          <header><p className="mb-2 text-sm text-ink-2">{selected.category}</p><h2 className="display text-2xl">{selected.title}</h2></header>
          {selected.image && <figure>
            <img src={selected.image.src} alt={selected.image.alt} className="w-full rounded-lg" loading="lazy" />
            {selected.image.caption && <figcaption className="mt-2 text-sm text-ink-2">{selected.image.caption}</figcaption>}
          </figure>}
          {selected.summary && <p className="text-ink-2">{selected.summary}</p>}
          {selected.steps?.length ? <section>
            <h3 className="font-semibold">Steps</h3>
            <ol className="mt-2 list-decimal space-y-2 pl-5">{selected.steps.map((step) => <li key={step}>{step}</li>)}</ol>
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
          {selected.kind === 'workflow' && <p className="text-xs text-ink-2">GravityGuard checklist based on NASA references. Follow your mission’s approved procedures for medical decisions.</p>}
        </article>
      </div>
    </main>
  )
}
