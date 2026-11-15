import { lazy, Suspense, useState, type FormEvent } from 'react'
import earth from '../assets/earth-horizon.webp'
import { href } from '../lib/router'

const AssistantLogo = lazy(() => import('./AssistantLogo').then(({ AssistantLogo }) => ({ default: AssistantLogo })))

export function MissionAssistant({ name, heartRate, recent }: { name?: string; heartRate?: number; recent: boolean }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')

  function explain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = question.trim().toLowerCase()
    if (!query) return
    if (/heart|pulse|bpm/.test(query)) {
      setAnswer(heartRate === undefined
        ? 'There is no valid heart-rate reading yet.'
        : `The ${recent ? 'latest' : 'last recorded'} heart rate is ${heartRate} bpm. Open Watch readings to see how it changed over time.`)
    } else if (/warn|alert|event/.test(query)) {
      setAnswer('Open the warning bell and select an event to see the recorded findings and their source.')
    } else {
      setAnswer('Open the Crew guide for steps on recording symptoms, contacting the crew medical officer, and preparing a handoff.')
    }
  }

  return (
    <section className="panel mission-assistant p-4">
      <img className="mission-assistant-background" src={earth} alt="" />
      <div className="mission-assistant-stage" aria-hidden="true">
        <Suspense fallback={null}><AssistantLogo /></Suspense>
      </div>
      <div className="mission-assistant-chat">
      <h2 className="faded-label text-lg font-semibold">Hey, {name || 'Astronaut'}.</h2>
      <p className="text-ink-2">How can we help you today?</p>
      <form onSubmit={explain} className="mt-3 flex gap-2">
        <input className="field min-w-0 flex-1" aria-label="Ask about your readings" placeholder="Ask about your readings" value={question} maxLength={250} onChange={(event) => setQuestion(event.target.value)} />
        <button className="btn btn-primary" disabled={!question.trim()}>Ask</button>
      </form>
      {answer && <p role="status" className="mt-3 text-ink-2">{answer}</p>}
      <a className="mt-3 inline-block text-ink-2 underline" href={href.guide}>Crew guide</a>
      </div>
    </section>
  )
}
