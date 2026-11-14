import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyDataset, type Datasets } from '../shared/dataset'
import { DataFileError, openStore, readDatasetFile, serializeDataset, writeFileAtomic, type WriteFile } from './store'

const dirs: string[] = []
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'gg-store-test-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const noSeed = (_ds: Datasets) => undefined
const device = (id: string) => ({
  deviceId: id,
  subjectId: 'crew-a',
  isSimulated: false,
  firstSeenAt: '2026-11-14T19:40:00Z',
  lastSeenAt: '2026-11-14T19:40:00Z',
  lastSyncAt: null,
  appVersion: null,
  deviceModel: null,
  pendingRecords: null,
})
const missionFile = (dir: string) => JSON.parse(readFileSync(path.join(dir, 'mission.json'), 'utf8'))
const leftovers = (dir: string) => readdirSync(dir).filter((f) => f.includes('.tmp-'))

describe('data files', () => {
  it('creates both files on first start and seeds only the demo workspace', () => {
    const dir = tempDir()
    const store = openStore({
      dataDir: dir,
      seedDemo: (ds) => {
        ds.demo.devices['sim-1'] = { ...device('sim-1'), isSimulated: true }
      },
    })
    expect(store.created).toEqual(['mission', 'demo'])
    expect(missionFile(dir)).toEqual(emptyDataset('mission'))
    expect(Object.keys(JSON.parse(readFileSync(path.join(dir, 'demo.json'), 'utf8')).devices)).toEqual(['sim-1'])
    expect(leftovers(dir)).toEqual([])
  })

  it('reports a missing file as null and a damaged one with an error naming it', () => {
    const dir = tempDir()
    const file = path.join(dir, 'mission.json')
    expect(readDatasetFile(file, 'mission')).toBeNull()
    writeFileSync(file, '{"formatVersion": 1, "workspace": "mission", "sessions": {')
    expect(() => readDatasetFile(file, 'mission')).toThrow(DataFileError)
    expect(() => readDatasetFile(file, 'mission')).toThrow(`${file} is not valid JSON`)
    writeFileSync(file, JSON.stringify({ ...emptyDataset('mission'), formatVersion: 2 }))
    expect(() => readDatasetFile(file, 'mission')).toThrow(/formatVersion is 2, expected 1/)
    writeFileSync(file, JSON.stringify(emptyDataset('demo')))
    expect(() => readDatasetFile(file, 'mission')).toThrow(/workspace is "demo", expected "mission"/)
    writeFileSync(file, JSON.stringify({ ...emptyDataset('mission'), sessions: [] }))
    expect(() => readDatasetFile(file, 'mission')).toThrow(/"sessions" must be an object/)
  })

  it('stops at a damaged demo.json before creating a missing mission.json', () => {
    const dir = tempDir()
    writeFileSync(path.join(dir, 'demo.json'), 'not json')
    expect(() => openStore({ dataDir: dir, seedDemo: noSeed })).toThrow(/demo\.json is not valid JSON/)
    expect(existsSync(path.join(dir, 'mission.json'))).toBe(false)
    expect(readFileSync(path.join(dir, 'demo.json'), 'utf8')).toBe('not json')
  })

  it('writes atomically and leaves no temporary files', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'x.json')
    await writeFileAtomic(file, '{"a":1}\n')
    await writeFileAtomic(file, '{"a":2}\n')
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}\n')
    expect(leftovers(dir)).toEqual([])
  })
})

describe('changes', () => {
  it('applies queued changes one at a time, so none is lost', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        store.mutate((d) => {
          d.mission.devices[`w-${i}`] = device(`w-${i}`)
        }),
      ),
    )
    expect(Object.keys(store.datasets.mission.devices)).toHaveLength(40)
    expect(Object.keys(missionFile(dir).devices)).toHaveLength(40)
    expect(leftovers(dir)).toEqual([])
  })

  it('serves a change only after it is on disk, and not at all if the write fails', async () => {
    const dir = tempDir()
    let fail = true
    const write: WriteFile = async (file, text) => {
      if (fail) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
      await writeFileAtomic(file, text)
    }
    const store = openStore({ dataDir: dir, seedDemo: noSeed, write })
    const before = readFileSync(path.join(dir, 'mission.json'), 'utf8')
    await expect(store.mutate((d) => void (d.mission.devices.w = device('w')))).rejects.toMatchObject({ status: 503, code: 'STORAGE_WRITE_FAILED' })
    expect(store.datasets.mission.devices).toEqual({})
    expect(readFileSync(path.join(dir, 'mission.json'), 'utf8')).toBe(before)
    expect(store.lastWriteError).toMatch(/no space left/)
    fail = false
    await store.mutate((d) => void (d.mission.devices.w = device('w')))
    expect(Object.keys(missionFile(dir).devices)).toEqual(['w'])
    expect(store.lastWriteError).toBeNull()
  })

  it('discards a change whose function throws', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    await expect(
      store.mutate((d) => {
        d.mission.devices.w = device('w')
        throw new Error('refused')
      }),
    ).rejects.toThrow('refused')
    expect(store.datasets.mission.devices).toEqual({})
    expect(missionFile(dir).devices).toEqual({})
  })

  it('refuses a change limited to one workspace that touches the other', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    const demoBefore = readFileSync(path.join(dir, 'demo.json'), 'utf8')
    await expect(store.mutate((d) => void (d.mission.devices.w = device('w')), { only: ['demo'] })).rejects.toThrow(/limited to demo/)
    expect(missionFile(dir).devices).toEqual({})
    expect(readFileSync(path.join(dir, 'demo.json'), 'utf8')).toBe(demoBefore)
  })

  it('does not rewrite a file when nothing changed', async () => {
    const dir = tempDir()
    const writes: string[] = []
    const store = openStore({
      dataDir: dir,
      seedDemo: noSeed,
      write: async (file, text) => {
        writes.push(path.basename(file))
        await writeFileAtomic(file, text)
      },
    })
    await store.mutate(() => 'read only')
    expect(writes).toEqual([])
    await store.mutate((d) => void (d.demo.devices.s = { ...device('s'), isSimulated: true }))
    expect(writes).toEqual(['demo.json'])
  })

  it('close() waits for queued writes and then refuses new ones', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    const pending = store.mutate((d) => void (d.mission.devices.late = device('late')))
    await store.close()
    await pending
    expect(Object.keys(missionFile(dir).devices)).toEqual(['late'])
    await expect(store.mutate(() => undefined)).rejects.toMatchObject({ status: 503, code: 'SHUTTING_DOWN' })
  })

  it('keeps the file format stable (formatVersion 1, workspace name, trailing newline)', () => {
    const text = serializeDataset(emptyDataset('demo'))
    expect(text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(text)).toMatchObject({ workspace: 'demo', formatVersion: 1 })
  })
})

describe('changes that cannot be stored', () => {
  it('refuses a change it cannot serialize, before it is served, and keeps working afterwards', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    const before = readFileSync(path.join(dir, 'mission.json'), 'utf8')
    await expect(
      store.mutate((d) => {
        const loop: Record<string, unknown> = {}
        loop.self = loop
        ;(d.mission.devices as Record<string, unknown>).bad = loop
      }),
    ).rejects.toMatchObject({ status: 500, code: 'UNSTORABLE_CHANGE' })
    expect(store.datasets.mission.devices).toEqual({})
    expect(readFileSync(path.join(dir, 'mission.json'), 'utf8')).toBe(before)
    await store.mutate((d) => void (d.mission.devices.w = device('w')))
    expect(Object.keys(missionFile(dir).devices)).toEqual(['w'])
  })

  it('a record nested too deeply for structuredClone does not break later changes or a restart', async () => {
    const dir = tempDir()
    const store = openStore({ dataDir: dir, seedDemo: noSeed })
    const deep: Record<string, unknown> = {}
    let o = deep
    for (let i = 0; i < 5000; i++) {
      const next: Record<string, unknown> = {}
      o.a = next
      o = next
    }
    await store.mutate((d) => void (d.mission.log as unknown[]).push(deep))
    await store.mutate((d) => void (d.mission.devices.w = device('w')))
    expect(Object.keys(store.datasets.mission.devices)).toEqual(['w'])
    const reopened = openStore({ dataDir: dir, seedDemo: noSeed })
    await reopened.mutate((d) => void (d.mission.devices.x = device('x')))
    expect(Object.keys(missionFile(dir).devices).sort()).toEqual(['w', 'x'])
  }, 30_000)
})
