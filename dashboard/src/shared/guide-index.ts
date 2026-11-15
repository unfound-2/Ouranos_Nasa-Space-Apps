import { GuideEntrySchema, type Checklist, type GuideEntry } from './crew-guide.js'
import original from './guide-index.json' with { type: 'json' }
import { crewGuides } from './guide-library.js'

/** Keep all 175 original source records, updating the four original workflows. */
const originalEntries = GuideEntrySchema.array().parse(original)
export function fullGuideCatalog(checklists: Checklist[] = crewGuides): GuideEntry[] {
  const entries = new Map(originalEntries.map((entry) => [entry.id, entry]))
  for (const entry of checklists) entries.set(entry.id, entry)
  return [...entries.values()]
}
export const guideCatalog = fullGuideCatalog()
