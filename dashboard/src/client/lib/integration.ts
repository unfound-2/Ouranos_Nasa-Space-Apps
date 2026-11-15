import type { Dataset, Workspace } from '../../shared/dataset'
import type { CheckRecordKind, CheckStatus, IntegrationCheck } from './api'

const KIND_LABEL: Record<CheckRecordKind, string> = { EVENT: 'event', SESSION: 'session', MEASUREMENT: 'reading' }

/** The record the dashboard has loaded for an id and kind, if any. */
function loadedRecord(ds: Dataset, id: string, kind: CheckRecordKind): { isSimulated: boolean } | null {
  const table = kind === 'EVENT' ? ds.events : kind === 'SESSION' ? ds.sessions : ds.readings
  return Object.hasOwn(table, id) ? table[id] : null
}

/**
 * Check 8, "data displayed in the dashboard", is decided here and not on the server: it passes
 * only when the real record named by the device-ingest check is in the mission records this
 * dashboard has loaded. Every other check is returned exactly as the server sent it.
 */
export function resolveChecks(checks: IntegrationCheck[], workspace: Workspace, ds: Dataset | null): IntegrationCheck[] {
  const ingest = checks.find((c) => c.id === 'device-ingest')
  return checks.map((c) => {
    if (c.id !== 'dashboard-display') return c
    const base = { ...c, recordId: null, recordKind: null, evidence: null, at: null }
    if (!ingest || ingest.status !== 'PASS' || !ingest.recordId || !ingest.recordKind)
      return { ...base, status: 'NOT_TESTED' as const, detail: 'Waits for check 6: a real record has to arrive from a device first.' }
    const what = `${KIND_LABEL[ingest.recordKind]} ${ingest.recordId}`
    if (workspace !== 'mission')
      return { ...base, status: 'NOT_TESTED' as const, detail: `This page is showing the simulated demo. Switch to mission records to check that ${what} is displayed.` }
    if (!ds) return { ...base, status: 'NOT_TESTED' as const, detail: 'The mission records have not loaded yet.' }
    const found = loadedRecord(ds, ingest.recordId, ingest.recordKind)
    if (!found || found.isSimulated)
      return {
        ...base,
        status: 'FAIL' as const,
        detail: `The mission computer stored ${what}, but the mission records loaded in this dashboard do not include it. Reload the page; if it is still missing, the dashboard is not reading the same data directory.`,
      }
    return {
      ...base,
      status: 'PASS' as const,
      detail: `The dashboard has ${what} from the device in the mission records it is showing.`,
      evidence: ingest.evidence,
      at: ingest.at,
      recordId: ingest.recordId,
      recordKind: ingest.recordKind,
    }
  })
}

export function checkTally(checks: IntegrationCheck[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { PASS: 0, FAIL: 0, NOT_TESTED: 0 }
  for (const c of checks) out[c.status] += 1
  return out
}

/** A secret as it may appear on screen: a fixed run of dots and, for a long secret, its last four characters. */
export function maskSecret(secret: string): string {
  return secret.length < 12 ? '•'.repeat(8) : `${'•'.repeat(12)}${secret.slice(-4)}`
}
