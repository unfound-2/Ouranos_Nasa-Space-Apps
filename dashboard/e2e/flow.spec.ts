import { expect, test } from '@playwright/test'
import { banner, openIn, resetDemo } from './helpers'

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

test('dashboard → review event → evidence → review workflow → history (simulated demo)', async ({ page }) => {
  // Start in mission records: nothing there, and the demo is one explicit click away.
  await openIn(page, 'mission')
  await expect(banner(page)).toContainText('UNAVAILABLE')
  await expect(page.getByText('No mission records yet')).toBeVisible()
  await page.getByRole('button', { name: 'Open simulated demo' }).first().click()
  await expect(banner(page)).toContainText('Simulated demo')

  // Dashboard: the most pressing open event is the unacknowledged dizziness report.
  const hero = page.getByTestId('hero-alert')
  await expect(hero).toContainText('dizziness reported')
  await expect(hero).toContainText('SIM')
  await expect(hero).toContainText('Presented · not acknowledged')
  await page.getByTestId('open-evidence').click()

  // Evidence: why it was flagged, the phase comparison, the body map.
  await expect(page).toHaveURL(/#\/events\/sim-evt-20261112-a$/)
  await expect(page.getByTestId('event-header')).toContainText('sim-evt-20261112-a')
  await expect(page.getByTestId('explanation')).toContainText('dizziness was self-reported at 14:11:55 UTC')
  const stats = page.getByTestId('phase-stats')
  await expect(stats).toContainText('71 bpm')
  await expect(stats).toContainText('94 bpm')
  await expect(stats).toContainText('+23 bpm')
  await expect(page.getByTestId('summary-check')).toContainText('matches')
  const head = page.getByTestId('region-HEAD').first()
  await expect(head).toHaveAttribute('data-state', 'symptom')
  await head.click()
  await expect(page.getByTestId('region-detail').first()).toContainText('DIZZINESS — SELF-REPORTED')
  await expect(page.getByTestId('knowns')).toContainText('Blood pressure: the watch cannot measure it')
  await expect(page.getByTestId('history')).toContainText('Baseline')

  // Review workflow: acknowledgement and review stay separate; review is not clearance.
  await page.getByTestId('open-review').click()
  const wf = page.getByTestId('review-workflow')
  await expect(wf).toContainText('GG-REVIEW-CHECKLIST · v1.0')
  await expect(page.getByTestId('mark-reviewed')).toBeDisabled()
  for (const id of ['symptoms-reviewed', 'source-verified', 'missing-data-identified', 'escalation-considered', 'review-documented'])
    await wf.locator(`label:has([data-testid="check-${id}"])`).click()
  await page.getByTestId('reviewer').fill('Crew medical officer (demo)')
  await page.getByTestId('mark-reviewed').click()
  await expect(wf).toContainText('it is not a medical clearance')
  await expect(page.getByTestId('event-header')).toContainText('Reviewed')
  await expect(page.getByTestId('event-header')).toContainText('Presented · not acknowledged')
  await page.getByTestId('close-event').click()
  await expect(page.getByTestId('event-header')).toContainText('Closed')

  // History: the session and the closed event, and the state survives a reload.
  await page.getByRole('link', { name: 'Crew Health', exact: true }).click()
  await expect(page.getByTestId('session-row-sim-a-20261112')).toContainText('+23 bpm')
  await page.getByRole('link', { name: 'Event History', exact: true }).click()
  const row = page.getByTestId('events-table').locator('tr', { hasText: 'sim-evt-20261112-a' })
  await expect(row).toContainText('Closed')
  await page.reload()
  await expect(page.getByTestId('events-table').locator('tr', { hasText: 'sim-evt-20261112-a' })).toContainText('Closed')
  await expect(banner(page)).toContainText('Simulated demo')
})

test('a triggered simulated watch event is labelled as simulated end to end', async ({ page }) => {
  await openIn(page, 'demo')
  await page.getByTestId('trigger-sim').click()
  const watch = page.getByTestId('sim-watch')
  await expect(watch).toContainText('Simulated watch')
  await expect(watch).toContainText('HEALTH REVIEW')
  await watch.getByRole('button', { name: 'Open evidence' }).click()
  await expect(page).toHaveURL(/#\/events\/sim-trigger-/)
  await expect(page.getByTestId('event-header')).toContainText('SIMULATED')
  await expect(page.getByTestId('explanation')).toContainText('dizziness was self-reported')
})
