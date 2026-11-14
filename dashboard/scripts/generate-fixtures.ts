/**
 * Writes the SIMULATED demo bundle to fixtures/simulated/demo-bundle.json.
 * The values come from src/shared/demo.ts; nothing is random and nothing was measured on a person.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildDemoBundle } from '../src/shared/demo'

const out = fileURLToPath(new URL('../fixtures/simulated/demo-bundle.json', import.meta.url))
writeFileSync(out, `${JSON.stringify(buildDemoBundle(), null, 2)}\n`)
console.log(`wrote ${out}`)
