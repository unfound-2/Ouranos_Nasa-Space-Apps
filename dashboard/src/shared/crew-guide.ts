import { z } from 'zod'

const nasaUrl = z.url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && (url.hostname === 'nasa.gov' || url.hostname.endsWith('.nasa.gov'))
})

export const GuideEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  kind: z.enum(['condition', 'evidence', 'workflow']),
  sources: z.array(z.object({ title: z.string(), url: nasaUrl })).min(1),
  summary: z.string().optional(),
  steps: z.array(z.string()).optional(),
  allMission: z.boolean().optional(),
  image: z.object({ src: nasaUrl, alt: z.string(), caption: z.string().optional() }).optional(),
})

export type GuideEntry = z.infer<typeof GuideEntrySchema>
