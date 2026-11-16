import { z } from 'zod'
import type { Checklist } from './crew-guide.js'

export const assistantRequest = z.object({
  question: z.string().trim().min(1).max(250),
  topic: z.string().regex(/^[a-z-]+$/).max(50),
  mode: z.enum(['chat', 'body', 'meaning', 'next']),
  readings: z.array(z.object({
    label: z.string().max(80),
    unit: z.string().max(24),
    value: z.number().optional(),
    delta: z.number().optional(),
    status: z.string().max(24).optional(),
    comparison: z.string().max(80).optional(),
  })).max(12),
  history: z.array(z.object({ question: z.string().min(1).max(250), answer: z.string().min(1).max(1600) })).max(6).optional(),
  feed: z.enum(['recorded', 'test', 'demo', 'unavailable']),
})
export type AssistantRequest = z.infer<typeof assistantRequest>
export type AssistantReply = { answer: string; guide: Checklist; mode: 'online' | 'local' }
