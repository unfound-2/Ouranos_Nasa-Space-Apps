import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import earth from '../assets/earth-horizon.webp'
import { askCrewAssistant } from '../lib/crew-assistant'
import type { AssistantReply } from '../../shared/crew-assistant'
import { NasaGuideLink } from '../pages/CrewGuide'
import type { useAttentionSummary } from './AttentionSummary'

const AssistantLogo = lazy(() => import('./AssistantLogo').then(({ AssistantLogo }) => ({ default: AssistantLogo })))

type Summary = ReturnType<typeof useAttentionSummary>

const topics = [
  { query: /heart|pulse|bpm/i, metric: /heart|pulse/i },
  { query: /breath|respirat/i, metric: /breath|respirat/i },
  { query: /oxygen|spo2/i, metric: /oxygen|spo2/i },
  { query: /pressure/i, metric: /pressure/i },
  { query: /temperature/i, metric: /temperature/i },
]

function answerQuestion(question: string, summary: Summary) {
  const topic = topics.find(({ query }) => query.test(question))
  if (topic) {
    const matching = summary.readings.filter(({ label }) => topic.metric.test(label))
    if (matching.length) {
      const values = matching.map(({ label, value, unit, status }) =>
        `${label} is ${value} ${unit} (${status === 'nominal' ? 'source marked nominal' : 'source flagged for review'}).`)
      return [...values, summary.nextStep].join(' ')
    }
    const demo = summary.simulatedReadings.filter(({ label }) => topic.metric.test(label))
    if (demo.length) {
      return demo.map(({ label, value, unit }) =>
        `In the simulator, ${label.toLowerCase()} is ${Number(Math.abs(value).toFixed(1))} ${unit} ${value < 0 ? 'below' : 'above'} the rest reference.`).join(' ')
    }
    if (summary.warning && topic.metric.test(summary.details)) return [summary.details, summary.nextStep].join(' ')
    return 'There is no recent valid reading for that measurement. Check the watch or instrument connection.'
  }
  if (summary.warning || /warning|happen|next|do|cause|fix/i.test(question)) {
    return [summary.interpretation + '.', summary.explanation, summary.nextStep].filter(Boolean).join(' ')
  }
  return 'Ask about heart rate, breathing, oxygen saturation, blood pressure, temperature, or what needs attention.'
}

export function MissionAssistant({ summary, name }: { summary: Summary; name?: string }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<{ question: string; reply?: AssistantReply }[]>([])
  const [pending, setPending] = useState(false)
  const transcript = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const log = transcript.current
    if (log) log.scrollTop = log.scrollHeight
  }, [turns])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = question.trim()
    if (!prompt || pending) return
    setPending(true)
    setTurns((previous) => [...previous, { question: prompt }])
    setQuestion('')
    const reply = await askCrewAssistant(prompt, 'chat', summary, answerQuestion(prompt, summary))
    setTurns((previous) => previous.map((turn, index) => index === previous.length - 1 ? { ...turn, reply } : turn))
    setPending(false)
  }

  return (
    <section className="panel mission-assistant mission-chat-panel" aria-label="Crew health chat">
      {turns.length === 0 ? (
        <div className="mission-chat-intro">
          <img className="mission-assistant-background" src={earth} alt="" />
          <h2 className="faded-label text-center text-2xl leading-tight font-semibold">Hey, {name || 'Astronaut'}.</h2>
          <p className="mt-2 text-center text-ink-2">I’m your crew health assistant. Ask me about your readings.</p>
          <div className="mission-assistant-stage" aria-hidden="true">
            <Suspense fallback={null}><AssistantLogo /></Suspense>
          </div>
        </div>
      ) : (
      <div className="mission-chat-log" role="log" aria-label="Conversation" ref={transcript}>
        <div className="mission-chat-messages">
        {turns.map((turn, index) => (
          <div key={index} className="mission-chat-turn">
            <p className="mission-chat-question">{turn.question}</p>
            <div className="mission-chat-reply">
              <p>{turn.reply?.answer ?? 'Reviewing readings…'}</p>
              {turn.reply && <NasaGuideLink source={turn.reply.guide.sources[0]} />}
            </div>
          </div>
        ))}
        </div>
      </div>
      )}
      <div className="mission-chat-composer">
        <form onSubmit={send} className="flex gap-2">
          <input className="field min-w-0 flex-1" aria-label="Ask about your readings" aria-describedby="assistant-sharing" placeholder="Ask about your readings" value={question} maxLength={250} onChange={(event) => setQuestion(event.target.value)} />
          <button className="btn btn-primary" disabled={pending || !question.trim()}>Ask</button>
        </form>
        <p id="assistant-sharing" className="mt-1 text-[11px] text-ink-2">Ask shares the question and readings with the online assistant when available.</p>
      </div>
    </section>
  )
}
