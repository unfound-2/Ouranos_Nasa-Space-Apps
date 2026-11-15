import { describe, expect, it } from 'vitest'
import { emptyDataset } from '../../shared/dataset'
import { buildEvent, buildSession } from '../../shared/testing'
import type { IntegrationCheck } from './api'
import { checkTally, resolveChecks, maskSecret } from './integration'

const serverCheck = (id: string, status: IntegrationCheck['status'], extra: Partial<IntegrationCheck> = {}): IntegrationCheck => ({
  id,
  label: id,
  status,
  detail: `${id} detail`,
  evidence: null,
  at: null,
  ...extra,
})

function checksWithIngest(ingest: Partial<IntegrationCheck> & { status: IntegrationCheck['status'] }): IntegrationCheck[] {
  return [
    serverCheck('backend', 'PASS'),
    serverCheck('device-ingest', ingest.status, { recordId: null, recordKind: null, ...ingest }),
    serverCheck('dashboard-display', 'NOT_TESTED', { clientCheck: true }),
    serverCheck('watch-confirmation', 'NOT_TESTED', { recordId: null, recordKind: null }),
  ]
}

const display = (checks: IntegrationCheck[]) => checks.find((c) => c.id === 'dashboard-display')!

describe('the dashboard-display check (decided in the browser)', () => {
  it('passes only when the device record is in the mission records the dashboard has loaded', () => {
    const ds = emptyDataset('mission')
    ds.events['evt-real-1'] = buildEvent({ eventId: 'evt-real-1' })
    const out = resolveChecks(checksWithIngest({ status: 'PASS', recordId: 'evt-real-1', recordKind: 'EVENT', at: '2026-11-14T20:00:00Z' }), 'mission', ds)
    expect(display(out).status).toBe('PASS')
    expect(display(out).recordId).toBe('evt-real-1')
    expect(display(out).recordKind).toBe('EVENT')
    expect(display(out).detail).toMatch(/evt-real-1/)
  })

  it('finds sessions as well as events', () => {
    const ds = emptyDataset('mission')
    ds.sessions['ses-real-1'] = buildSession({ sessionId: 'ses-real-1' })
    const out = resolveChecks(checksWithIngest({ status: 'PASS', recordId: 'ses-real-1', recordKind: 'SESSION' }), 'mission', ds)
    expect(display(out).status).toBe('PASS')
  })

  it('fails when the server has the record but the loaded mission records do not', () => {
    const out = resolveChecks(checksWithIngest({ status: 'PASS', recordId: 'evt-missing', recordKind: 'EVENT' }), 'mission', emptyDataset('mission'))
    expect(display(out).status).toBe('FAIL')
  })

  it('is not tested while the dashboard shows the simulated demo, even if a demo record has the same id', () => {
    const demo = emptyDataset('demo')
    demo.events['evt-real-1'] = buildEvent({ eventId: 'evt-real-1', isSimulated: true })
    const out = resolveChecks(checksWithIngest({ status: 'PASS', recordId: 'evt-real-1', recordKind: 'EVENT' }), 'demo', demo)
    expect(display(out).status).toBe('NOT_TESTED')
    expect(display(out).detail).toMatch(/simulated demo/i)
  })

  it('is not tested until a real device record has arrived', () => {
    const out = resolveChecks(checksWithIngest({ status: 'NOT_TESTED' }), 'mission', emptyDataset('mission'))
    expect(display(out).status).toBe('NOT_TESTED')
  })

  it('never passes on a simulated record, even if the server named it', () => {
    const ds = emptyDataset('mission')
    ds.events['evt-sim'] = buildEvent({ eventId: 'evt-sim', isSimulated: true })
    const out = resolveChecks(checksWithIngest({ status: 'PASS', recordId: 'evt-sim', recordKind: 'EVENT' }), 'mission', ds)
    expect(display(out).status).toBe('FAIL')
  })

  it('leaves every other check exactly as the server sent it, in order', () => {
    const input = checksWithIngest({ status: 'NOT_TESTED' })
    const out = resolveChecks(input, 'mission', emptyDataset('mission'))
    expect(out.map((c) => c.id)).toEqual(input.map((c) => c.id))
    expect(out[0]).toBe(input[0])
    expect(out[1]).toBe(input[1])
    expect(out[3]).toBe(input[3])
  })
})

describe('check tally', () => {
  it('counts each status', () => {
    expect(checkTally([serverCheck('a', 'PASS'), serverCheck('b', 'PASS'), serverCheck('c', 'FAIL'), serverCheck('d', 'NOT_TESTED')])).toEqual({ PASS: 2, FAIL: 1, NOT_TESTED: 1 })
  })
})

describe('secret masking', () => {
  it('shows only the last four characters', () => {
    const masked = maskSecret('gg_live_0123456789abcdefWXYZ')
    expect(masked.endsWith('WXYZ')).toBe(true)
    expect(masked).not.toContain('gg_live')
    expect(masked).not.toContain('0123')
  })

  it('shows nothing of a short secret', () => {
    expect(maskSecret('abc12')).toBe('•'.repeat(8))
  })

  it('does not reveal the length of a long secret', () => {
    expect(maskSecret('x'.repeat(40) + 'WXYZ')).toBe(maskSecret('y'.repeat(80) + 'WXYZ'))
  })
})
