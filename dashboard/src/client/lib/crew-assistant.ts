import type { AssistantReply, AssistantRequest } from '../../shared/crew-assistant'
import { guideCandidates } from '../../shared/guide-library'
import type { useAttentionSummary } from '../components/AttentionSummary'
import { request } from './api'

type Summary = ReturnType<typeof useAttentionSummary>

export async function askCrewAssistant(question: string, mode: AssistantRequest['mode'], summary: Summary, fallback: string) {
  const recommended = guideCandidates(summary.guideTopic, mode === 'chat' ? question : '')[0]
  try {
    const reply = await request<AssistantReply>('POST', '/crew-assistant', {
      question, mode, topic: summary.guideTopic, readings: summary.deltas, feed: summary.feed,
    } satisfies AssistantRequest, '/api/v1', 8500)
    return reply.mode === 'online' ? reply : { ...reply, answer: fallback }
  } catch {
    return { answer: fallback, guide: recommended, mode: 'local' } satisfies AssistantReply
  }
}
