import { ChecklistSchema, type Checklist } from './crew-guide.js'
import bundled from './crew-guide.json' with { type: 'json' }

export const crewGuides = ChecklistSchema.array().parse(bundled)

const topics: [string, RegExp][] = [
  ['dizziness', /dizz|lightheaded|orthostat/i],
  ['vision', /vision|eyesight|blurred/i],
  ['injury', /injur|wound/i],
  ['radiation', /radiation|dosimeter/i],
  ['cabin-air', /cabin air|carbon dioxide|headache|co₂|co2/i],
  ['sleep', /sleep|fatigue|circadian/i],
  ['nutrition', /nutrition|food|fluid|hydration/i],
  ['oxygen-breathing', /oxygen|spo2|hypoxi/i],
  ['pressure', /blood pressure|systolic|diastolic/i],
  ['temperature', /temperature|overheat/i],
  ['pulse-recovery', /pulse|heart rate|breathing|respirat|recover|exercise/i],
  ['communications', /handoff|ground support|earth contact/i],
]

export function guideCandidates(topic: string, query = '', entries = crewGuides): Checklist[] {
  const ids = [...topics.filter(([, pattern]) => pattern.test(query)).map(([id]) => id), topic, 'reading-check']
  return [...new Set(ids)].map((id) => entries.find((item) => item.id === id))
    .filter((item): item is Checklist => Boolean(item)).slice(0, 4)
}
