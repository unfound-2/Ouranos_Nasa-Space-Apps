import { ArrowRight } from 'lucide-react'
import { crewGuides, guideCandidates } from '../../shared/guide-library'
import { buildEventContext } from '../../shared/explain'
import { signed, utcStamp } from '../../shared/format'
import { useAttentionSummary } from '../components/AttentionSummary'
import { MissionAssistant } from '../components/MissionAssistant'
import { useSimulatorSamples } from '../components/WatchCharts'
import { useCrewProfile } from '../lib/crew-profile'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { focusFor, isOpen } from '../lib/view'
import { scenarioById } from '../lib/scenarios'
import { watchSignIn } from '../lib/watch-pairing'
import { NasaGuideLink } from './CrewGuide'
import './health-review.css'

export function AttentionDetails({ eventId }: { eventId?: string }) {
  const { snapshot, workspace, subjectId, scenarioId } = useData()
  const profile = useCrewProfile()
  return snapshot && <Review key={[eventId ?? 'latest', workspace, profile?.id, subjectId, scenarioId].join(':')} snapshot={snapshot} eventId={eventId} />
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
  const guide = guideCandidates(summary.guideTopic)[0] ?? crewGuides[0]
  const evidence = summary.deltas.filter((reading, index, list) =>
    reading.delta !== undefined || reading.status === 'priority' || reading.status === 'review' || (index < 4 && !list.some((r) => r.delta !== undefined)))
  const orderedEvidence = [...evidence].sort((a, b) => Number(b.status === 'priority' || b.status === 'review') - Number(a.status === 'priority' || a.status === 'review'))
    .filter((reading, index, list) => list.findIndex(item => item.label.toLowerCase() === reading.label.toLowerCase()) === index).slice(0, 6)
  const feed = summary.feed === 'demo' ? 'Simulated readings' : summary.feed === 'test' ? 'Watch test readings' : summary.feed === 'unavailable' ? 'Waiting for readings' : eventId ? 'Recorded assessment' : 'Latest available readings'

  return <div className="health-review mx-auto w-full max-w-5xl">
    <header className="mission-intro"><h1 className="display faded-label">Health review</h1><p>Your readings, their context, and what to check next.</p></header>
    {eventId && !event ? <section className="review-card review-unavailable"><h2>This warning is no longer available</h2><a className="btn btn-ghost" href={href.attention}>Review current readings <ArrowRight size={15} aria-hidden /></a></section> : <>
      <div className="review-dateline"><span>{feed}</span>{selected && <time dateTime={selected.createdAt}>{utcStamp(selected.createdAt)}</time>}</div>
      <div className="review-layout">
        <div className="review-evidence">
          <section className="review-card review-change" aria-labelledby="what-changed"><h2 id="what-changed">What changed</h2><p className="review-interpretation">{summary.interpretation}</p>{summary.explanation && <p className="review-explanation">{summary.explanation}</p>}
            {event && summary.triggerReadings.length > 0 && <details className="review-flags"><summary>Readings behind the flag <span>{summary.triggerReadings.length}</span></summary><ul>{summary.triggerReadings.map(reading => <li key={reading}>{reading}</li>)}</ul></details>}
          </section>
          {orderedEvidence.length > 0 ? <section className="review-readings" aria-label="Changes in your readings">
            {orderedEvidence.map(reading => <article className="review-card review-reading" key={reading.label + reading.comparison}><h3>{reading.label}</h3><p className="review-reading-value"><span>{reading.delta !== undefined ? signed(Number(reading.delta.toFixed(1))) : reading.value}</span><small>{reading.unit}</small></p><p className="review-comparison">{reading.comparison ?? 'No comparable reading'}</p>{(reading.status === 'priority' || reading.status === 'review') && <p className="review-reading-flag">Source flagged for review</p>}</article>)}
          </section> : <section className="review-card review-empty"><h3>No comparable readings yet</h3><p>Connect your watch or open an assessment to review its recorded measurements.</p><a href={href.system}>Check connection <ArrowRight size={14} aria-hidden /></a></section>}
        </div>
        <MissionAssistant key={event?.eventId ?? 'current'} summary={{ ...summary, deltas: orderedEvidence }} name={profile?.name} heading="Ask about these readings" suggestions={['What changed?', 'What should I check?', 'What should I do next?']} />
      </div>
      <section className="review-card review-guide" aria-labelledby="review-guide-title"><div className="review-guide-heading"><div><p className="review-guide-label">Recommended guide</p><h2 id="review-guide-title">{guide.title}</h2></div><a className="btn btn-ghost btn-sm" href={href.guideTopic(guide.id)}>Open guide <ArrowRight size={14} aria-hidden /></a></div><p className="review-explanation">{guide.summary}</p><details><summary>View checklist</summary><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><NasaGuideLink source={guide.sources[0]} /></details></section>
      {event && <a className="review-event-link" href={href.event(event.eventId)}>Open original event record <ArrowRight size={13} aria-hidden /></a>}
    </>}
  </div>
}
