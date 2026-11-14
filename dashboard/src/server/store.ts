/**
 * Persistence of the two datasets as mission.json and demo.json in the data directory.
 *
 * - Writes are atomic: write <file>.tmp-<pid>-<n>, fsync it, rename it over the file, fsync the
 *   directory. A crash leaves either the old file or the new one, never half of one.
 * - Every change goes through one queue, so writes never interleave.
 * - A change is made on a copy. The copy replaces what the API serves only after its file was
 *   written, so a failed write changes neither the file nor the served data, and nobody reads a
 *   change before it is on disk.
 * - The copy is parsed from the stored JSON text rather than made with structuredClone, which fails
 *   on deeply nested data. A change whose result cannot be serialized and read back is refused
 *   before it is served, so one bad change can never block the ones after it.
 * - At startup, a file that is not valid JSON or not the expected dataset stops the server with an
 *   error naming the file. That file is never overwritten.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { emptyDataset, type Dataset, type Datasets, type Workspace } from '../shared/dataset'
import { HttpError } from './errors'

export const WORKSPACES: readonly Workspace[] = ['mission', 'demo']
export const DATA_FILE: Record<Workspace, string> = { mission: 'mission.json', demo: 'demo.json' }

export type WriteFile = (file: string, text: string) => Promise<void>

export class DataFileError extends Error {
  constructor(
    public file: string,
    message: string,
  ) {
    super(message)
    this.name = 'DataFileError'
  }
}

let tmpCounter = 0
const tmpName = (file: string) => `${file}.tmp-${process.pid}-${++tmpCounter}`

export function serializeDataset(ds: Dataset): string {
  return `${JSON.stringify(ds, null, 2)}\n`
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const dh = await open(dir, 'r')
    try {
      await dh.sync()
    } finally {
      await dh.close()
    }
  } catch {
    // Not every platform can fsync a directory; the rename has still happened.
  }
}

export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = tmpName(file)
  try {
    const fh = await open(tmp, 'wx', 0o600)
    try {
      await fh.writeFile(text, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
  await syncDirectory(path.dirname(file))
}

export function writeFileAtomicSync(file: string, text: string): void {
  const tmp = tmpName(file)
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      writeFileSync(fd, text, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
  try {
    const dfd = openSync(path.dirname(file), 'r')
    try {
      fsyncSync(dfd)
    } finally {
      closeSync(dfd)
    }
  } catch {
    // See syncDirectory.
  }
}

const isRecordMap = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Why a parsed file is not a dataset of this workspace, or null if it looks right. */
export function datasetShapeProblem(x: unknown, workspace: Workspace): string | null {
  if (!isRecordMap(x)) return 'expected a JSON object'
  const o = x as Record<string, unknown>
  if (o.formatVersion !== 1) return `formatVersion is ${JSON.stringify(o.formatVersion) ?? 'missing'}, expected 1`
  if (o.workspace !== workspace) return `workspace is ${JSON.stringify(o.workspace) ?? 'missing'}, expected "${workspace}"`
  for (const key of ['sessions', 'events', 'readings', 'devices', 'fingerprints'])
    if (!isRecordMap(o[key])) return `"${key}" must be an object`
  if (!Array.isArray(o.log)) return '"log" must be an array'
  return null
}

const UNTOUCHED =
  'The file was left exactly as it is; the server will not overwrite it. Move it out of the data directory (or restore a good copy) and start again.'

/** The dataset stored in a file, null if the file does not exist. Throws DataFileError otherwise. */
export function readDatasetFile(file: string, workspace: Workspace): Dataset | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new DataFileError(file, `Cannot read ${file}: ${(e as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new DataFileError(file, `${file} is not valid JSON (${(e as Error).message}). ${UNTOUCHED}`)
  }
  const problem = datasetShapeProblem(parsed, workspace)
  if (problem) throw new DataFileError(file, `${file} is not a GRAVITYGUARD "${workspace}" dataset: ${problem}. ${UNTOUCHED}`)
  return parsed as Dataset
}

export interface OpenStoreOptions {
  dataDir: string
  /** Fills datasets.demo when demo.json does not exist yet. Must not change datasets.mission. */
  seedDemo: (datasets: Datasets) => void
  /** Replaceable for tests. */
  write?: WriteFile
}

export function openStore(opts: OpenStoreOptions): Store {
  const dataDir = path.resolve(opts.dataDir)
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const files: Record<Workspace, string> = {
    mission: path.join(dataDir, DATA_FILE.mission),
    demo: path.join(dataDir, DATA_FILE.demo),
  }
  // Read both before writing anything, so a bad file stops startup with nothing changed.
  const loaded: Record<Workspace, Dataset | null> = {
    mission: readDatasetFile(files.mission, 'mission'),
    demo: readDatasetFile(files.demo, 'demo'),
  }
  const datasets: Datasets = { mission: loaded.mission ?? emptyDataset('mission'), demo: loaded.demo ?? emptyDataset('demo') }
  if (!loaded.demo) {
    const missionBefore = serializeDataset(datasets.mission)
    opts.seedDemo(datasets)
    if (serializeDataset(datasets.mission) !== missionBefore) throw new Error('internal error: seeding the demo workspace changed the mission workspace')
  }
  const created: Workspace[] = []
  for (const ws of WORKSPACES) {
    if (loaded[ws]) continue
    writeFileAtomicSync(files[ws], serializeDataset(datasets[ws]))
    created.push(ws)
  }
  return new Store(dataDir, files, datasets, created, opts.write ?? writeFileAtomic)
}

export class Store {
  private live: Datasets
  private saved: Record<Workspace, string>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  /** The last failed write, cleared by the next successful one. */
  lastWriteError: string | null = null

  constructor(
    readonly dataDir: string,
    private files: Record<Workspace, string>,
    initial: Datasets,
    /** Workspaces whose file did not exist at startup and was created. */
    readonly created: Workspace[],
    private write: WriteFile,
  ) {
    this.live = initial
    this.saved = { mission: serializeDataset(initial.mission), demo: serializeDataset(initial.demo) }
  }

  /** The stored state. Treat it as read-only; change it only through mutate(). */
  get datasets(): Datasets {
    return this.live
  }

  fileFor(ws: Workspace): string {
    return this.files[ws]
  }

  /**
   * Queue a change. fn runs on a copy of both datasets; every dataset it changed is written to
   * disk, and only then does the copy become the stored state. If fn throws, nothing is written.
   * `only` lists the workspaces the change may touch; touching another one is refused.
   */
  mutate<T>(fn: (draft: Datasets) => T, opts: { only?: readonly Workspace[] } = {}): Promise<T> {
    if (this.closing)
      return Promise.reject(
        new HttpError(503, 'SHUTTING_DOWN', 'The mission computer is shutting down. Nothing was stored; send it again once the computer is back.'),
      )
    const job = this.tail.then(() => this.apply(fn, opts))
    this.tail = job.then(
      () => undefined,
      () => undefined,
    )
    return job
  }

  private async apply<T>(fn: (draft: Datasets) => T, opts: { only?: readonly Workspace[] }): Promise<T> {
    // JSON.parse copies any nesting the writer can produce, so the copy itself can never fail.
    const draft: Datasets = { mission: JSON.parse(this.saved.mission) as Dataset, demo: JSON.parse(this.saved.demo) as Dataset }
    const result = fn(draft)
    const changed: { ws: Workspace; text: string; next: Dataset }[] = []
    for (const ws of WORKSPACES) {
      let text: string
      let next: Dataset
      try {
        text = serializeDataset(draft[ws])
        if (text === this.saved[ws]) continue
        // What the next change and the next start will read back.
        next = JSON.parse(text) as Dataset
      } catch (e) {
        throw new HttpError(
          500,
          'UNSTORABLE_CHANGE',
          `This change could not be stored (${(e as Error).message}). Nothing was stored, and later changes are not affected.`,
        )
      }
      changed.push({ ws, text, next })
    }
    const outside = changed.filter((c) => opts.only && !opts.only.includes(c.ws))
    if (outside.length)
      throw new Error(`internal error: a change limited to ${opts.only?.join('/')} also changed ${outside.map((c) => c.ws).join('/')}; nothing was saved`)
    for (const { ws, text, next } of changed) {
      try {
        await this.write(this.files[ws], text)
      } catch (e) {
        const reason = (e as NodeJS.ErrnoException).code ?? (e as Error).message
        this.lastWriteError = `${this.files[ws]}: ${(e as Error).message}`
        throw new HttpError(
          503,
          'STORAGE_WRITE_FAILED',
          `The mission computer could not save ${DATA_FILE[ws]} (${reason}). This change was not stored; send it again later.`,
        )
      }
      this.live = { ...this.live, [ws]: next }
      this.saved[ws] = text
    }
    if (changed.length) this.lastWriteError = null
    return result
  }

  /** Resolves when every queued change has been written (or has failed). */
  flush(): Promise<void> {
    return this.tail
  }

  /** Refuse new changes and wait for the queued ones. */
  async close(): Promise<void> {
    this.closing = true
    await this.tail
  }
}
