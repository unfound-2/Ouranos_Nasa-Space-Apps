import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AckRequestSchema, DeliveryReportSchema, isStrictUtcIso, parseBundle, parseHeartbeat, parseReviewEvent, parseSession, run } from '../src/shared/contract'
import { classify, emptyDataset, expandPayload, ingestRecords, type Datasets } from '../src/shared/dataset'
import { buildContractFiles, CONTRACTS_DIR, UTC_TIMESTAMP_PATTERN } from './export-contracts'

const generated = buildContractFiles()
const committed = (rel: string) => readFileSync(path.join(CONTRACTS_DIR, rel), 'utf8')
const example = (name: string) => JSON.parse(committed(`examples/${name}`))

/** Parse failures print their messages, so a broken example says what is wrong. */
const parsed = (r: { ok: true } | { ok: false; errors: string[] }) => (r.ok ? 'ok' : r.errors)

describe('contracts/v1 for the watch app', () => {
  it('the committed files are exactly what npm run contracts generates (no drift)', () => {
    for (const [rel, text] of Object.entries(generated)) expect(committed(rel), `${rel} is out of date: run npm run contracts`).toBe(text)
  })

  it('holds no files the generator does not make', () => {
    const onDisk = [
      ...readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith('.json')),
      ...readdirSync(path.join(CONTRACTS_DIR, 'examples')).map((f) => `examples/${f}`),
    ].sort()
    expect(onDisk).toEqual(Object.keys(generated).sort())
  })

  it('every schema names itself and its JSON Schema dialect', () => {
    for (const rel of Object.keys(generated).filter((f) => f.endsWith('.schema.json'))) {
      const s = JSON.parse(committed(rel))
      expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      expect(s.$id).toBe(`urn:gravityguard:contracts:v1:${rel.replace('.schema.json', '')}`)
      expect(typeof s.title).toBe('string')
      expect(s.description).toMatch(/docs\/WATCH_INTEGRATION\.md/)
      expect(s.type).toBe('object')
      expect(s.additionalProperties).toBe(false)
    }
  })

  it('the event schemas forbid what only the mission computer may set', () => {
    const event = JSON.parse(committed('event.schema.json'))
    const inBundle = JSON.parse(committed('bundle.schema.json')).properties.events.items
    for (const e of [event, inBundle]) {
      expect(e.additionalProperties).toBe(false)
      expect(e.properties).not.toHaveProperty('review')
      expect(e.properties).not.toHaveProperty('statusHistory')
      expect(e.properties.status.enum).toEqual(['CREATED', 'QUEUED', 'DELIVERED', 'ACKNOWLEDGED', 'DELIVERY_UNCONFIRMED', 'WATCH_UNREACHABLE'])
    }
  })

  it('every example parses with the shared parser', () => {
    expect(parsed(parseSession(example('session.json')))).toBe('ok')
    expect(parsed(parseReviewEvent(example('event.json')))).toBe('ok')
    expect(parsed(parseHeartbeat(example('heartbeat.json')))).toBe('ok')
    expect(parsed(run(AckRequestSchema, example('ack.json')))).toBe('ok')
    expect(parsed(run(DeliveryReportSchema, example('delivery.json')))).toBe('ok')
    const bundle = example('bundle.json')
    expect(parsed(parseBundle(bundle))).toBe('ok')
    const { records, errors } = expandPayload(bundle)
    expect(errors).toEqual([])
    expect(records.map((r) => classify(r).kind)).toEqual(['SESSION', 'EVENT'])
  })

  it('every example record is simulated, so an example can never be imported as real data', () => {
    const session = example('session.json')
    expect(session).toMatchObject({ isSimulated: true, mode: 'SIMULATED_DEMO', provenance: { origin: 'DEMO_FIXTURE' } })
    for (const m of session.measurements) expect(m).toMatchObject({ isSimulated: true, source: { kind: 'SIMULATOR' } })
    const event = example('event.json')
    expect(event).toMatchObject({ isSimulated: true, provenance: { origin: 'DEMO_FIXTURE' }, origin: { kind: 'DEMO_FIXTURE' }, delivery: { channel: 'SIMULATED_WATCH', confirmedBy: 'SIMULATION' } })

    const ds: Datasets = { mission: emptyDataset('mission'), demo: emptyDataset('demo') }
    const { records } = expandPayload(example('bundle.json'))
    const { results } = ingestRecords(ds, records, { now: '2026-11-14T20:00:00Z', path: 'FILE_IMPORT', fileName: 'bundle.json' })
    expect(results.map((r) => [r.outcome, r.workspace])).toEqual([
      ['CREATED', 'demo'],
      ['CREATED', 'demo'],
    ])
    expect(Object.keys(ds.mission.sessions)).toHaveLength(0)
    expect(Object.keys(ds.mission.events)).toHaveLength(0)
    // And a real watch upload of the example is refused rather than relabelled.
    const relabelled = { ...example('session.json'), isSimulated: false, mode: 'DEVICE_RECORDING' }
    expect(parseSession(relabelled).ok).toBe(false)
  })

  it('the schema timestamp pattern agrees with the parser on format, and every example timestamp matches it', () => {
    const re = new RegExp(UTC_TIMESTAMP_PATTERN)
    for (const s of ['2026-11-14T19:30:05Z', '2026-11-14T19:30:05.123Z', '2026-11-14T19:30:05.123456Z']) {
      expect(re.test(s), s).toBe(true)
      expect(isStrictUtcIso(s), s).toBe(true)
    }
    for (const s of ['2026-11-14T19:30:05+02:00', '2026-11-14T19:30:05', '2026-11-14 19:30:05Z', '2026-11-14T19:30:05.1234567Z', '784848605.0']) {
      expect(re.test(s), s).toBe(false)
      expect(isStrictUtcIso(s), s).toBe(false)
    }
    const stamps = Object.entries(generated)
      .filter(([rel]) => rel.startsWith('examples/'))
      .flatMap(([, text]) => [...text.matchAll(/"(\d{4}-\d{2}-\d{2}T[^"]*)"/g)].map((m) => m[1]))
    expect(stamps.length).toBeGreaterThan(20)
    for (const s of stamps) expect(re.test(s) && isStrictUtcIso(s), s).toBe(true)
    expect((generated['session.schema.json'].match(/"pattern": "\^\\\\d\{4\}/g) ?? []).length).toBe(11)
  })
})
