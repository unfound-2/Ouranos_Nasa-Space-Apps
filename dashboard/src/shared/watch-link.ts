import { z } from 'zod'

const timestamp = z.number().min(946684800).max(4133980799)
const Reading = z.object({
  metric: z.string().min(1).max(80),
  value: z.number(),
  unit: z.string().max(24),
  quality: z.enum(['valid', 'suspect', 'missing']),
  status: z.enum(['nominal', 'review', 'priority']),
  measuredAt: timestamp.nullish(),
})

export const WatchFrameSchema = z.object({
  version: z.literal(1),
  source: z.string().min(1).max(80),
  observedAt: timestamp,
  freshnessSeconds: z.number().min(15).max(180).nullish(),
  simulated: z.boolean(),
  readings: z.array(Reading).min(1).max(64),
}).refine((frame) => new Set(frame.readings.map((r) => r.metric)).size === frame.readings.length)

export const WatchSignalSchema = z.object({
  id: z.uuid(),
  createdAt: timestamp,
  frame: WatchFrameSchema,
  evidence: z.array(z.string()).min(1).max(64),
  action: z.string().min(1).max(750),
  wristMotionG: z.number().nonnegative().nullish(),
}).refine((signal) => signal.evidence.every((metric) =>
  signal.frame.readings.some((r) => r.metric === metric && r.quality === 'valid' && r.status !== 'nominal')))

export type WatchFrame = z.infer<typeof WatchFrameSchema>
export type WatchSignal = z.infer<typeof WatchSignalSchema>
export interface WatchLinkSnapshot {
  deviceId: string
  watch: WatchFrame | null
  telemetry: WatchFrame[]
}
