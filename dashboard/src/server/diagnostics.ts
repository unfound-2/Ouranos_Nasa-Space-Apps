/**
 * Watch-integration diagnostics for the System Status page.
 *
 * GET /api/v1/integration/checks reports, one check at a time, what this computer can tell about
 * the connection to the watch app. A check passes only on evidence from real (non-simulated)
 * mission records, the live pairing state or this computer's own network: simulated and demo data
 * never make a check pass. Nothing here proves watch hardware: a code-paired watch app may be
 * running in the Xcode simulator.
 *
 * POST /api/v1/integration/selftest sends real HTTP requests to this computer's own watch-link
 * endpoints with a simulated signal. It proves those endpoints work on this computer, not that a
 * watch can reach it, and its review event goes to the demo workspace, which the checks ignore.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Dataset } from '../shared/dataset'
import type { WatchLinkStatus } from './watch-link'

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_TESTED'
export type CheckRecordKind = 'EVENT' | 'SESSION' | 'MEASUREMENT'

export interface IntegrationCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  evidence: string | null
  at: string | null
  /** Only on device-ingest, record-persisted and watch-confirmation: the record the check is about. */
  recordId?: string | null
  recordKind?: CheckRecordKind | null
  /** Only on dashboard-display: the dashboard decides this check, not the server. */
  clientCheck?: true
}

export interface LanAddress {
  interface: string
  address: string
  url: string
}

export interface IntegrationChecks {
  generatedAt: string
  checks: IntegrationCheck[]
  lan: { enabled: boolean; bind: string; port: number | null; addresses: LanAddress[] }
  watch: {
    paired: boolean
    deviceId: string | null
    lastSeenAt: string | null
    frame: { observedAt: string; metrics: string[]; simulated: boolean } | null
  }
}

const NOT_WATCH_PROOF =
  'This proves the listener answers on that address from this computer, not that the watch can reach it (Wi-Fi, firewall, App Transport Security).'
const PROBE_TIMEOUT_MS = 1500
const SELFTEST_STEP_TIMEOUT_MS = 3000
const SERVICE = 'gravityguard-mission-computer'

const KIND_LABEL: Record<CheckRecordKind, string> = { EVENT: 'Event', SESSION: 'Session', MEASUREMENT: 'Reading' }
const KIND_MAP: Record<CheckRecordKind, 'events' | 'sessions' | 'readings'> = { EVENT: 'events', SESSION: 'sessions', MEASUREMENT: 'readings' }

interface DeviceRecordRef {
  id: string
  kind: CheckRecordKind
  receivedAt: string
  deviceId: string | null
  via: 'watch review signal' | 'v1 device API'
}

/** Newest first by an ISO time, then by id, so the choice is stable. */
const newestFirst =
  <T>(time: (x: T) => string, id: (x: T) => string) =>
  (a: T, b: T) =>
    Date.parse(time(b)) - Date.parse(time(a)) || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0)

/**
 * The newest real record that reached the mission records over an authenticated device channel
 * (live sync: a watch review signal or the v1 device API). Imports, manual entry, computer checks
 * and anything simulated never count.
 */
export function latestDeviceRecord(mission: Dataset): DeviceRecordRef | null {
  const found: DeviceRecordRef[] = []
  const take = (kind: CheckRecordKind, id: string, isSimulated: boolean, p: { ingestPath: string | null; receivedAt: string | null; deviceId: string | null }, via: DeviceRecordRef['via']) => {
    if (isSimulated || p.ingestPath !== 'LIVE_SYNC' || !p.receivedAt) return
    found.push({ id, kind, receivedAt: p.receivedAt, deviceId: p.deviceId, via })
  }
  for (const e of Object.values(mission.events))
    take('EVENT', e.eventId, e.isSimulated, e.provenance, e.reasonCodes.includes('WATCH_TELEMETRY_FLAG') ? 'watch review signal' : 'v1 device API')
  for (const s of Object.values(mission.sessions)) take('SESSION', s.sessionId, s.isSimulated, s.provenance, 'v1 device API')
  for (const r of Object.values(mission.readings)) take('MEASUREMENT', r.measurementId, r.isSimulated, r.provenance, 'v1 device API')
  return found.sort(newestFirst((r) => r.receivedAt, (r) => r.id))[0] ?? null
}

/** The newest real alert the watch app reported displaying or the wearer acknowledged on the watch. */
export function latestWatchConfirmation(mission: Dataset): { id: string; what: 'displayed' | 'acknowledged'; at: string; deviceId: string | null } | null {
  const found: { id: string; what: 'displayed' | 'acknowledged'; at: string; deviceId: string | null }[] = []
  for (const e of Object.values(mission.events)) {
    if (e.isSimulated) continue
    if (e.acknowledgement?.via === 'WATCH')
      found.push({ id: e.eventId, what: 'acknowledged', at: e.acknowledgement.acknowledgedAt, deviceId: e.acknowledgement.deviceId ?? e.provenance.deviceId })
    else if (e.delivery.confirmedBy === 'WATCH_APP' && e.delivery.presentedAt)
      found.push({ id: e.eventId, what: 'displayed', at: e.delivery.presentedAt, deviceId: e.delivery.confirmedByDeviceId ?? e.provenance.deviceId })
  }
  return found.sort(newestFirst((c) => c.at, (c) => c.id))[0] ?? null
}

interface ProbeResult {
  url: string
  ok: boolean
  status: number | null
  error: string | null
}

async function probe(fetchImpl: typeof fetch, url: string): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    let service: unknown = null
    try {
      service = ((await res.json()) as { service?: unknown }).service
    } catch {
      // Not JSON: not this service.
    }
    const ok = res.status === 200 && service === SERVICE
    return { url, ok, status: res.status, error: ok ? null : `answered ${res.status}${service === SERVICE ? '' : ', not as this mission computer'}` }
  } catch (e) {
    const err = e as Error
    return { url, ok: false, status: null, error: err.name === 'TimeoutError' ? `no answer within ${PROBE_TIMEOUT_MS / 1000} s` : err.message }
  }
}

export interface ChecksInput {
  nowIso: string
  version: string
  uptimeSeconds: number
  storageWritable: boolean
  lan: boolean
  port: number | null
  interfaces: { interface: string; address: string }[]
  /** Pairing state with self-test pairings already removed. */
  link: WatchLinkStatus
  mission: Dataset
  missionFile: string
  fetch: typeof fetch
}

export async function buildChecks(input: ChecksInput): Promise<IntegrationChecks> {
  const { nowIso, lan, port } = input
  const bind = lan ? '0.0.0.0' : '127.0.0.1'
  const addresses: LanAddress[] = input.interfaces.map((a) => ({ ...a, url: port === null ? '' : `http://${a.address}:${port}` }))
  const checks: IntegrationCheck[] = []

  checks.push({
    id: 'backend',
    label: 'Mission computer answering',
    status: 'PASS',
    detail: `The mission computer ${input.version} is answering; up ${input.uptimeSeconds} s; storage ${input.storageWritable ? 'writable' : 'NOT writable: records cannot be saved'}.`,
    evidence: `${SERVICE} ${input.version}`,
    at: nowIso,
  })

  checks.push(
    lan
      ? {
          id: 'lan-enabled',
          label: 'Listening on the local network',
          status: 'PASS',
          detail: `Listening on 0.0.0.0, port ${port ?? 'unknown'}: devices on the local network can connect.`,
          evidence: `bind ${bind}`,
          at: nowIso,
        }
      : {
          id: 'lan-enabled',
          label: 'Listening on the local network',
          status: 'FAIL',
          detail: 'Listening on 127.0.0.1 only, so no watch can connect. Stop the server and start it with GG_LAN=1 npm start.',
          evidence: `bind ${bind}`,
          at: nowIso,
        },
  )

  const listed = addresses.map((a) => `${a.interface} ${a.address}`).join(', ')
  checks.push(
    addresses.length
      ? {
          id: 'network-interface',
          label: 'Local-network IPv4 address',
          status: 'PASS',
          detail: `This computer has a local-network IPv4 address: ${listed}. Enter it on the watch as http://<address>:${port ?? 4317}.`,
          evidence: listed,
          at: nowIso,
        }
      : {
          id: 'network-interface',
          label: 'Local-network IPv4 address',
          status: 'FAIL',
          detail: 'No local-network IPv4 address. Join the Wi-Fi network the watch uses.',
          evidence: null,
          at: nowIso,
        },
  )

  const contact = (p: WatchLinkStatus['paired'][number]) => p.lastSeenAt ?? p.pairedAt ?? '1970-01-01T00:00:00.000Z'
  const paired = [...input.link.paired].sort(newestFirst(contact, (p) => p.deviceId))
  const latest = paired[0] ?? null
  const waiting = input.link.pendingCodes ? ` ${input.link.pendingCodes} pairing code(s) issued and waiting to be entered.` : ''
  checks.push(
    latest
      ? {
          id: 'pairing',
          label: 'Watch app paired with a code',
          status: 'PASS',
          detail: `${paired.length === 1 ? 'A watch app is' : `${paired.length} watch apps are`} paired with this computer; latest: device ${latest.deviceId}, ${
            latest.lastSeenAt ? `last contact ${latest.lastSeenAt}` : 'no contact recorded since pairing'
          }. A code pairing proves a watch app holds this pairing, not which hardware it runs on.${waiting}`,
          evidence: latest.deviceId,
          at: latest.pairedAt,
        }
      : {
          id: 'pairing',
          label: 'Watch app paired with a code',
          status: 'NOT_TESTED',
          detail: `No watch app is paired. On the watch: Set console address, Get pairing code, then enter the code under System Status → Watch integration (or open the pairing link on this computer).${waiting}`,
          evidence: null,
          at: null,
        },
  )

  if (!lan) {
    checks.push({
      id: 'lan-reachable',
      label: 'Answers at its local-network address',
      status: 'NOT_TESTED',
      detail: 'Not tested: the server is not listening on the local network (start it with GG_LAN=1 npm start).',
      evidence: null,
      at: null,
    })
  } else if (!addresses.length || port === null) {
    checks.push({
      id: 'lan-reachable',
      label: 'Answers at its local-network address',
      status: 'FAIL',
      detail: `There is no local-network address to probe. ${NOT_WATCH_PROOF}`,
      evidence: null,
      at: nowIso,
    })
  } else {
    const results = await Promise.all(addresses.map((a) => probe(input.fetch, `${a.url}/api/v1/health`)))
    const failed = results.filter((r) => !r.ok)
    const summary = results.map((r) => `${r.url} ${r.ok ? `answered ${r.status}` : `failed: ${r.error}`}`).join('; ')
    checks.push({
      id: 'lan-reachable',
      label: 'Answers at its local-network address',
      status: failed.length ? 'FAIL' : 'PASS',
      detail: `Probed from this computer: ${summary}. ${NOT_WATCH_PROOF}`,
      evidence: results.map((r) => r.url).join(', '),
      at: nowIso,
    })
  }

  const record = latestDeviceRecord(input.mission)
  checks.push(
    record
      ? {
          id: 'device-ingest',
          label: 'A real record arrived from a device',
          status: 'PASS',
          detail: `${KIND_LABEL[record.kind]} ${record.id} arrived over the ${record.via} from device ${record.deviceId ?? 'unknown'} at ${record.receivedAt}.`,
          evidence: `${record.kind.toLowerCase()} ${record.id}`,
          at: record.receivedAt,
          recordId: record.id,
          recordKind: record.kind,
        }
      : {
          id: 'device-ingest',
          label: 'A real record arrived from a device',
          status: 'NOT_TESTED',
          detail:
            'No real record has arrived from a device yet. A review signal from the watch (Connect onboard with a flagged instrument feed) or a session or event sent with the device token makes this pass. Simulated and demo records never count.',
          evidence: null,
          at: null,
          recordId: null,
          recordKind: null,
        },
  )

  if (!record) {
    checks.push({
      id: 'record-persisted',
      label: 'That record is saved on disk',
      status: 'NOT_TESTED',
      detail: 'Not tested until a real record arrives from a device.',
      evidence: null,
      at: null,
      recordId: null,
      recordKind: null,
    })
  } else {
    let found = false
    let problem: string | null = null
    try {
      const onDisk = JSON.parse(await readFile(input.missionFile, 'utf8')) as Record<string, unknown>
      const map = onDisk[KIND_MAP[record.kind]]
      found = typeof map === 'object' && map !== null && Object.hasOwn(map, record.id)
    } catch (e) {
      problem = `could not read it back (${(e as Error).message})`
    }
    checks.push(
      found
        ? {
            id: 'record-persisted',
            label: 'That record is saved on disk',
            status: 'PASS',
            detail: `${KIND_LABEL[record.kind]} ${record.id} is in ${input.missionFile}, read back from disk.`,
            evidence: input.missionFile,
            at: nowIso,
            recordId: record.id,
            recordKind: record.kind,
          }
        : {
            id: 'record-persisted',
            label: 'That record is saved on disk',
            status: 'FAIL',
            detail: `${KIND_LABEL[record.kind]} ${record.id} is held in memory but ${problem ?? `is not in ${input.missionFile} on disk`}.`,
            evidence: input.missionFile,
            at: nowIso,
            recordId: null,
            recordKind: null,
          },
    )
  }

  checks.push({
    id: 'dashboard-display',
    label: 'Shown on the dashboard',
    status: 'NOT_TESTED',
    detail: 'Decided by the dashboard, not the server: it passes when the mission records the dashboard shows include the device-ingest record.',
    evidence: null,
    at: null,
    clientCheck: true,
  })

  const confirmation = latestWatchConfirmation(input.mission)
  checks.push(
    confirmation
      ? {
          id: 'watch-confirmation',
          label: 'Watch confirmed an alert',
          status: 'PASS',
          detail:
            confirmation.what === 'acknowledged'
              ? `Event ${confirmation.id} was acknowledged on the watch at ${confirmation.at} (device ${confirmation.deviceId ?? 'unknown'}). An acknowledgement is not a medical review.`
              : `Event ${confirmation.id}: the watch app reported it displayed the alert at ${confirmation.at} (device ${confirmation.deviceId ?? 'unknown'}).`,
          evidence: `event ${confirmation.id}`,
          at: confirmation.at,
          recordId: confirmation.id,
          recordKind: 'EVENT',
        }
      : {
          id: 'watch-confirmation',
          label: 'Watch confirmed an alert',
          status: 'NOT_TESTED',
          detail: 'No watch app has reported displaying or acknowledging a real alert yet.',
          evidence: null,
          at: null,
          recordId: null,
          recordKind: null,
        },
  )

  return {
    generatedAt: nowIso,
    checks,
    lan: { enabled: lan, bind, port, addresses },
    watch: latest
      ? { paired: true, deviceId: latest.deviceId, lastSeenAt: latest.lastSeenAt, frame: latest.frame }
      : { paired: false, deviceId: null, lastSeenAt: null, frame: null },
  }
}

// ---------------------------------------------------------------------------
// Self-test

export interface SelftestStep {
  step: string
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  url: string
  status: number | null
  ok: boolean
  detail: string
}

export interface SelftestReport {
  simulated: true
  summary: string
  ranAt: string
  target: { lan: boolean; watchBase: string; consoleBase: string }
  steps: SelftestStep[]
  demoEventId: string | null
  passed: boolean
}

export interface SelftestInput {
  fetch: typeof fetch
  nowIso: string
  nowSeconds: number
  lan: boolean
  /** Where the watch would send its requests: the LAN address when the LAN is on. */
  watchBase: string
  /** Where the dashboard redeems codes: always this computer's loopback (redeeming is local-only). */
  consoleBase: string
  /** Called as soon as the self-test learns its pairing's device id, so checks can ignore it. */
  markDevice(deviceId: string): void
  inWorkspace(eventId: string): { demo: boolean; mission: boolean }
}

export const SELFTEST_SUMMARY =
  'Simulated self-test: this computer sent real HTTP requests to its own pairing and signal endpoints. It proves those endpoints work on this computer. It is not proof that a watch can connect or reach this computer, and it changes no integration check: its review event is simulated and stored in the demo workspace, and it never calls GET /api/device, so no heartbeat is recorded.'

export async function runSelftest(input: SelftestInput): Promise<SelftestReport> {
  const steps: SelftestStep[] = []
  const call = async (
    step: string,
    base: string,
    method: SelftestStep['method'],
    path: string,
    expect: number,
    opts: { body?: unknown; bearer?: string } = {},
  ): Promise<Record<string, unknown> | null> => {
    const url = `${base}${path}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`
    try {
      const res = await input.fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(SELFTEST_STEP_TIMEOUT_MS),
      })
      let json: Record<string, unknown> | null = null
      try {
        json = (await res.json()) as Record<string, unknown>
      } catch {
        json = null
      }
      const ok = res.status === expect
      const err = json && typeof json.error === 'object' && json.error ? (json.error as { code?: unknown; message?: unknown }) : null
      steps.push({
        step,
        method,
        path,
        url,
        status: res.status,
        ok,
        detail: ok ? `answered ${res.status} as expected` : `expected ${expect}, got ${res.status}${err ? ` ${String(err.code)}: ${String(err.message)}` : ''}`,
      })
      return ok ? json : null
    } catch (e) {
      const error = e as Error
      steps.push({
        step,
        method,
        path,
        url,
        status: null,
        ok: false,
        detail: error.name === 'TimeoutError' ? `no answer within ${SELFTEST_STEP_TIMEOUT_MS / 1000} s` : error.message,
      })
      return null
    }
  }

  let demoEventId: string | null = null
  const created = await call('Watch asks for a pairing code', input.watchBase, 'POST', '/api/pairing', 201)
  const code = typeof created?.code === 'string' ? created.code : null
  const watchToken = typeof created?.watchToken === 'string' ? created.watchToken : null
  let unpaired = false
  if (code && watchToken) {
    const redeemed = await call('Dashboard redeems the code', input.consoleBase, 'POST', '/api/pairing/redeem', 200, { body: { code } })
    if (typeof redeemed?.deviceId === 'string') input.markDevice(redeemed.deviceId)
    if (redeemed) {
      const id = randomUUID()
      const signal = {
        id,
        createdAt: input.nowSeconds,
        frame: {
          version: 1,
          source: 'Mission computer self-test (simulated)',
          observedAt: input.nowSeconds,
          simulated: true,
          readings: [{ metric: 'Self-test reading', value: 1, unit: 'count', quality: 'valid', status: 'review' }],
        },
        evidence: ['Self-test reading'],
        action: 'Simulated self-test signal sent by the mission computer to itself. Not from a watch.',
      }
      const accepted = await call('Watch sends a simulated review signal', input.watchBase, 'POST', '/api/signals', 202, { body: signal, bearer: watchToken })
      if (accepted) demoEventId = id
    }
    unpaired = (await call('Watch unpairs', input.watchBase, 'DELETE', '/api/device', 200, { bearer: watchToken })) !== null
    if (!unpaired) await call('Clean up the pairing over loopback', input.consoleBase, 'DELETE', '/api/device', 200, { bearer: watchToken })
  }

  const where = demoEventId ? input.inWorkspace(demoEventId) : { demo: false, mission: false }
  const passed = steps.length >= 4 && steps.slice(0, 4).every((s) => s.ok) && where.demo && !where.mission
  return {
    simulated: true,
    summary: SELFTEST_SUMMARY,
    ranAt: input.nowIso,
    target: { lan: input.lan, watchBase: input.watchBase, consoleBase: input.consoleBase },
    steps,
    demoEventId: where.demo ? demoEventId : null,
    passed,
  }
}
