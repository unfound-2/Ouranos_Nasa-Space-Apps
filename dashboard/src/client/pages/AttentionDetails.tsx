import { useRef, useState } from 'react'
import type { AssistantReply } from '../../shared/crew-assistant'
import { crewGuides, guideCandidates } from '../../shared/guide-library'
import { buildEventContext } from '../../shared/explain'
import { signed, utcStamp } from '../../shared/format'
import { useAttentionSummary } from '../components/AttentionSummary'
import { useSimulatorSamples } from '../components/WatchCharts'
import { askCrewAssistant } from '../lib/crew-assistant'
import { useCrewProfile } from '../lib/crew-profile'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { focusFor, isOpen } from '../lib/view'
import { scenarioById } from '../lib/scenarios'
import { watchSignIn } from '../lib/watch-pairing'
import { NasaGuideLink } from './CrewGuide'

const questions = {
  body: 'What’s going on with my body?',
  meaning: 'What could these changes mean?',
  next: 'What should I do next?',
}

export function AttentionDetails({ eventId }: { eventId?: string }) {
  const { snapshot } = useData()
  return snapshot && <Review key={eventId ?? 'latest'} snapshot={snapshot} eventId={eventId} />
}

function Review({ snapshot, eventId }: {
  snapshot: NonNullable<ReturnType<typeof useData>['snapshot']>
  eventId?: string
}) {
  const { subjectId, workspace, scenarioId } = useData()
  const profile = useCrewProfile()
  const deviceId = workspace === 'mission' ? profile?.deviceId ?? watchSignIn()?.deviceId ?? undefined : undefined
  const scopedSubject = deviceId ? snapshot.dataset.devices[deviceId]?.subjectId : subjectId
  const focus = deviceId && !scopedSubject ? null : focusFor(snapshot.dataset, scopedSubject ?? null)
  const selected = eventId && Object.hasOwn(snapshot.dataset.events, eventId) ? snapshot.dataset.events[eventId] : null
  const scenario = workspace === 'demo' ? scenarioById(scenarioId) : null
  const scenarioSession = scenario && Object.hasOwn(snapshot.dataset.sessions, scenario.sessionId) ? snapshot.dataset.sessions[scenario.sessionId] : null
  const scenarioEvent = scenario?.eventId && Object.hasOwn(snapshot.dataset.events, scenario.eventId) ? snapshot.dataset.events[scenario.eventId] : null
  const current = scenarioSession ? scenarioEvent : focus?.event
  const event = eventId ? selected : current && isOpen(current) ? current : null
  const ctx = event ? buildEventContext(event, snapshot.dataset, snapshot.serverTime) : null
  const simulated = useSimulatorSamples()
  const summary = useAttentionSummary({
    event, session: eventId ? ctx?.session ?? null : scenarioSession ?? focus?.session ?? null, dataset: snapshot.dataset, serverTime: snapshot.serverTime,
    deviceId, simulated, historical: Boolean(eventId),
  })
  const [result, setResult] = useState<{ key: string; reply: AssistantReply } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const requestId = useRef(0)
  const guide = result?.reply.guide ?? guideCandidates(summary.guideTopic)[0] ?? crewGuides[0]
  const evidence = summary.deltas.filter((reading, index, list) =>
    reading.delta !== undefined || reading.status === 'priority' || reading.status === 'review' || (index < 4 && !list.some((r) => r.delta !== undefined)))
  const orderedEvidence = [...evidence].sort((a, b) => Number(b.status === 'priority' || b.status === 'review') - Number(a.status === 'priority' || a.status === 'review')).slice(0, 6)

  async function ask(key: keyof typeof questions) {
    const id = ++requestId.current
    setPending(key)
    const local = guideCandidates(summary.guideTopic)[0]
    const fallback = key === 'next' ? local.steps.join(' ')
      : key === 'meaning' ? summary.explanation || local.summary
      : [summary.interpretation, summary.details].filter(Boolean).join('. ')
    const reply = await askCrewAssistant(questions[key], key, { ...summary, deltas: orderedEvidence }, fallback)
    if (requestId.current !== id) return
    setResult({ key, reply })
    setPending(null)
  }

  return (
    <div className="tab-page mx-auto max-w-5xl space-y-4">
      <div className="mission-horizon" aria-hidden="true" />
      <header className="mission-intro">
        <h1 className="display faded-label">Health review</h1>
        {selected && <p>{utcStamp(selected.createdAt)}</p>}
      </header>
      {eventId && !event ? <section className="tab-card">
        <h2 className="font-semibold">This warning is no longer available</h2>
        <a className="mt-2 inline-block underline" href={href.attention}>Review current readings</a>
      </section> : <>
        <section className="tab-card space-y-2">
          <p className="text-sm text-ink-2">What changed</p>
          <h2 className="text-2xl font-semibold">{summary.interpretation}</h2>
          {summary.explanation && <p className="text-ink-2">{summary.explanation}</p>}
          {summary.feed === 'demo' && <p className="text-sm text-ink-3">Simulated readings</p>}
          {summary.feed === 'test' && <p className="text-sm text-ink-3">Watch test readings</p>}
        </section>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orderedEvidence.map((reading) => (
            <section className="tab-card" key={reading.label + reading.comparison}>
              <h3 className="text-sm text-ink-2">{reading.label}</h3>
              <p className="my-1 text-3xl font-semibold tnum">
                {reading.delta !== undefined ? signed(Number(reading.delta.toFixed(1))) : reading.value}
                <span className="ml-1.5 text-sm text-ink-2">{reading.unit}</span>
              </p>
              <p className="text-sm text-ink-2">{reading.comparison ?? 'No comparable reading'}</p>
            </section>
          ))}
        </div>
        {event && summary.triggerReadings.length > 0 && (
          <section className="tab-card">
            <h3 className="font-semibold">Readings that triggered the flag</h3>
            <ul className="mt-2 space-y-1 text-sm text-ink-2">
              {summary.triggerReadings.map((reading) => <li key={reading}>{reading}</li>)}
            </ul>
          </section>
        )}
        <section className="tab-card space-y-4" aria-label="Ask about these readings">
          <h2 className="font-semibold">Ask about these readings</h2>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(questions) as (keyof typeof questions)[]).map((key) => (
              <button key={key} className="review-question" aria-pressed={(pending ?? result?.key) === key} onClick={() => void ask(key)}>{questions[key]}</button>
            ))}
          </div>
          <p className="text-xs text-ink-2">Asking sends the question and displayed measurements to the online assistant when available.</p>
          <div role="status">
            {pending ? <p className="text-sm text-ink-2">Reviewing readings…</p> : result && <p>{result.reply.answer}</p>}
          </div>
        </section>
        <section className="tab-card space-y-3">
          <h2 className="text-sm text-ink-2">Recommended guide</h2>
          <a className="text-xl font-semibold underline" href={href.guideTopic(guide.id)}>{guide.title}</a>
          <p className="text-ink-2">{guide.summary}</p>
          <ol className="list-decimal space-y-2 pl-6">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <NasaGuideLink source={guide.sources[0]} />
        </section>
        {event && <a className="inline-block text-sm underline" href={href.event(event.eventId)}>Open original event record</a>}
      </>}
    </div>
  )
}
