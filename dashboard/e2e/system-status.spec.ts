import { expect, test, type APIResponse } from '@playwright/test'
import { E2E_TOKEN } from '../playwright.config'
import { banner, openIn, resetDemo } from './helpers'

/*
 * System Status v2: the nine integration checks, the simulated self-test, masked secrets and the
 * scenario picker. Device requests carry the test token exactly as a watch app would; the records
 * are synthetic e2e-* data in the throwaway data directory.
 */
const auth = { Authorization: `Bearer ${E2E_TOKEN}` }
const at = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString()
const CHECK_IDS = ['backend', 'lan-enabled', 'network-interface', 'pairing', 'lan-reachable', 'device-ingest', 'record-persisted', 'dashboard-display', 'watch-confirmation']

type Check = { id: string; status: string; recordId?: string | null }
const checksOf = async (res: APIResponse) => ((await res.json()) as { checks: Check[] }).checks
const pick = (checks: Check[], id: string) => checks.find((c) => c.id === id) as Check

function realSession(sessionId: string) {
  const hr = (n: number, phase: 'REST' | 'RECOVERY', offset: number, value: number) => ({
    measurementId: `${sessionId}-m${n}`,
    subjectId: 'e2e-test-subject',
    sessionId,
    indicator: 'HEART_RATE',
    value,
    unit: 'bpm',
    measuredAt: at(offset),
    phase,
    source: { kind: 'APPLE_WATCH', device: 'e2e test watch', sensor: 'synthetic test values' },
    isSimulated: false,
    quality: 'VALID',
  })
  const start = -150
  return {
    schemaVersion: 'gravityguard.recovery-session.v1',
    sessionId,
    subjectId: 'e2e-test-subject',
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: 'DEVICE_RECORDING',
    isSimulated: false,
    startedAt: at(start),
    endedAt: at(start + 120),
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: at(start + 5), endedAt: at(start + 50) },
      { phase: 'RECOVERY', startedAt: at(start + 65), endedAt: at(start + 110), confirmedAt: at(start + 65), confirmedBy: 'WEARER' },
    ],
    measurements: [hr(1, 'REST', start + 10, 70), hr(2, 'REST', start + 20, 71), hr(3, 'REST', start + 30, 72), hr(4, 'RECOVERY', start + 70, 80), hr(5, 'RECOVERY', start + 80, 81), hr(6, 'RECOVERY', start + 90, 82)],
    symptomCheck: { status: 'NONE_REPORTED', answeredAt: at(start + 115) },
    symptoms: [],
    provenance: { origin: 'WATCH_APP', appVersion: 'e2e', deviceId: 'e2e-system-watch' },
  }
}

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

test('nine integration checks, and neither simulated data nor the self-test makes one pass', async ({ page }) => {
  const before = await checksOf(await page.request.get('/api/v1/integration/checks'))
  expect(before.map((c) => c.id)).toEqual(CHECK_IDS)
  expect((await page.request.post('/api/v1/demo/trigger', { data: {} })).ok()).toBeTruthy()

  await openIn(page, 'mission', '#/system')
  const board = page.getByTestId('integration-checks')
  await expect(board.locator('li[data-status]')).toHaveCount(9)
  await expect(page.getByTestId('check-backend')).toHaveAttribute('data-status', 'PASS')
  // The test server is not started with GG_LAN=1: the board says so instead of passing.
  await expect(page.getByTestId('check-lan-enabled')).toHaveAttribute('data-status', 'FAIL')
  await expect(page.getByTestId('check-lan-enabled')).toContainText('GG_LAN=1')

  await page.getByTestId('run-selftest').click()
  const report = page.getByTestId('selftest-report')
  await expect(report).toContainText('Simulated')
  await expect(report).toContainText('Endpoints answered')

  const after = await checksOf(await page.request.get('/api/v1/integration/checks'))
  for (const id of ['pairing', 'device-ingest', 'record-persisted', 'watch-confirmation']) {
    expect(pick(after, id).status, id).toBe(pick(before, id).status)
    expect(pick(after, id).recordId ?? null, id).toBe(pick(before, id).recordId ?? null)
  }
  await expect(page.getByTestId('check-pairing')).toHaveAttribute('data-status', pick(after, 'pairing').status)
})

test('a real record from a device passes ingest, storage and display; the demo view cannot vouch for it', async ({ page }) => {
  const id = `e2e-system-${Date.now()}`
  expect((await page.request.post('/api/v1/sessions', { headers: auth, data: realSession(id) })).status()).toBe(201)

  await openIn(page, 'mission', '#/system')
  const ingest = page.getByTestId('check-device-ingest')
  await expect(ingest).toHaveAttribute('data-status', 'PASS')
  await expect(ingest).toContainText(id)
  await expect(page.getByTestId('check-record-persisted')).toHaveAttribute('data-status', 'PASS')
  const display = page.getByTestId('check-dashboard-display')
  await expect(display).toHaveAttribute('data-status', 'PASS')
  await expect(display.getByRole('link', { name: 'Open record' })).toHaveAttribute('href', `#/sessions/${id}`)

  await page.getByRole('button', { name: 'Open simulated demo' }).first().click()
  await expect(banner(page)).toContainText('Simulated demo')
  await expect(display).toHaveAttribute('data-status', 'NOT_TESTED')
  await expect(display).toContainText('simulated demo')
})

test('a saved watch recording imports as SAVED DEVICE DATA into mission records, once', async ({ page }) => {
  const id = `e2e-import-${Date.now()}`
  const file = { name: `${id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(realSession(id))) }
  await openIn(page, 'mission', '#/system')
  const input = page.getByTestId('import-input')
  await input.setInputFiles(file)
  const result = page.getByTestId('import-result')
  await expect(result).toContainText(id)
  await expect(result).toContainText('Mission records')
  await expect(result).toContainText('CREATED')

  // The same recording again stores nothing new.
  await input.setInputFiles({ ...file, name: `${id}-again.json` })
  await expect(result).toContainText(`${id}-again.json`)
  await expect(result).toContainText('DUPLICATE')

  // An import is not a device connection: the device-ingest check never names it.
  const checks = await checksOf(await page.request.get('/api/v1/integration/checks'))
  expect(pick(checks, 'device-ingest').recordId ?? null).not.toBe(id)

  await page.goto(`/#/sessions/${id}`)
  await expect(page.getByTestId('session-report')).toContainText('saved device file')
  await expect(page.getByTestId('session-report')).not.toContainText('LIVE DEVICE')
})

test('the device token stays masked until an explicit, timed reveal', async ({ page }) => {
  await openIn(page, 'mission', '#/system')
  const token = page.getByTestId('token')
  await expect(token).toBeVisible()
  await expect(token).not.toContainText(E2E_TOKEN)
  expect(await page.content()).not.toContain(E2E_TOKEN)

  const controls = token.locator('..')
  await controls.getByRole('button', { name: 'Reveal' }).click()
  await expect(token).toHaveText(E2E_TOKEN)
  await expect(controls.getByRole('button', { name: /Hide · \d+ s/ })).toBeVisible()
  await controls.getByRole('button', { name: /Hide/ }).click()
  await expect(token).not.toContainText(E2E_TOKEN)
})

test('the scenario picker focuses the Overview on one simulated case', async ({ page }) => {
  await openIn(page, 'demo')
  const picker = page.getByTestId('scenario-picker')
  await picker.selectOption('C')
  await expect(page.getByTestId('hero-alert').getByText('Simulated', { exact: true })).toBeVisible()
  await page.getByTestId('open-evidence').click()
  await expect(page).toHaveURL(/#\/events\/sim-evt-20261112-b$/)
  await expect(banner(page)).toContainText('Simulated demo')

  await page.getByRole('link', { name: 'Mission Overview', exact: true }).click()
  await picker.selectOption('A')
  await expect(page.getByTestId('hero-alert')).toContainText('No review event')
  await expect(page.getByTestId('open-evidence')).toHaveCount(0)

  // Leaving the demo leaves the scenarios behind: mission records have no picker.
  await page.getByRole('button', { name: 'Exit demo' }).click()
  await expect(banner(page)).not.toContainText('Simulated demo')
  await expect(page.getByTestId('scenario-picker')).toHaveCount(0)
})
