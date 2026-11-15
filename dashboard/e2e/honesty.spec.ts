import { expect, test } from '@playwright/test'
import { banner, openIn, resetDemo } from './helpers'

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

test('the simulated-demo banner stays on every page', async ({ page }) => {
  await openIn(page, 'demo')
  for (const [link, check] of [
    ['Mission Overview', 'Mission health'],
    ['Crew Health', 'Recovery history'],
    ['Event History', 'Review events'],
    ['System Status', 'Mission computer'],
  ] as const) {
    await page.getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(check)
    await expect(banner(page)).toContainText('Simulated demo')
    await expect(banner(page)).toContainText('No astronaut data')
  }
  await page.goto('/#/events/sim-evt-20261113-b')
  await expect(banner(page)).toContainText('Simulated demo')
})

test('mission records never show simulated data or a LIVE label without a watch', async ({ page }) => {
  await openIn(page, 'mission')
  await expect(banner(page)).toContainText('UNAVAILABLE')
  await expect(page.getByTestId('watch-state')).toHaveText('No watch link')
  await expect(page.getByText('LIVE DEVICE')).toHaveCount(0)
  await expect(page.getByText('SIM', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Crew Health', exact: true }).click()
  await expect(page.getByTestId('sessions-table')).toContainText('No sessions match')
})

test('scenario C: too few readings shows no phase difference', async ({ page }) => {
  await openIn(page, 'demo', '#/events/sim-evt-20261112-b')
  await expect(page.getByTestId('insufficient')).toContainText('Insufficient samples to calculate phase comparison')
  await expect(page.getByTestId('phase-stats')).toHaveCount(0)
  await expect(page.getByTestId('explanation')).not.toContainText('observed difference')
})

test('scenarios D and E: a stale, questionable cuff reading asks for source review and the evidence stays readable while the watch is unreachable', async ({ page }) => {
  await openIn(page, 'demo', '#/events/dq-sim-b-20261113b')
  await expect(page.getByTestId('event-header')).toContainText('Watch unreachable')
  await expect(page.getByTestId('event-header')).toContainText('Not delivered · watch unreachable')
  const reasons = page.getByTestId('reason-codes')
  await expect(reasons).toContainText('SOURCE_REVIEW_REQUIRED')
  await expect(reasons).toContainText('SENSOR_DATA_STALE')
  await expect(reasons).toContainText('Measured 6 h 40 min before the session started')
  await expect(page.getByTestId('knowns')).toContainText('Not measured by the watch')
})

test('scenario F: acknowledged on the watch is shown apart from medical review', async ({ page }) => {
  await openIn(page, 'demo', '#/events/sim-evt-20261113-b')
  await expect(page.getByTestId('event-header')).toContainText('Acknowledged')
  await expect(page.getByTestId('knowns')).toContainText('An acknowledgement is not a medical review')
  await page.getByRole('link', { name: 'Event History', exact: true }).click()
  const row = page.getByTestId('events-table').locator('tr', { hasText: 'sim-evt-20261113-b' })
  await expect(row).toContainText('Acknowledged')
  await expect(row).toContainText('Not reviewed')
})
