import { expect } from '@playwright/test'
import { signInWithWatch, test } from './helpers'

test('heart and respiration demo readings keep advancing despite a static watch test frame', async ({ page }) => {
  const { watchToken } = await signInWithWatch(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mission health')
  await page.request.post('/api/watch', { headers: { Authorization: `Bearer ${watchToken}` }, data: {
    version: 1, source: 'Watch sensors', observedAt: Date.now() / 1000, simulated: true,
    readings: [
      { metric: 'Heart rate', value: 180, unit: 'bpm', quality: 'valid', status: 'review' },
      { metric: 'Respiratory rate', value: 40, unit: 'breaths/min', quality: 'valid', status: 'review' },
    ],
  } })
  await page.goto('/#/pair')
  await page.getByRole('button', { name: 'Run simulator' }).click()
  const charts = page.getByRole('region', { name: 'Watch measurements' })
  const heart = charts.locator('section').filter({ has: page.getByRole('heading', { name: 'Heart rate', exact: true }) }).first().locator(':scope > p').first()
  const respiration = charts.locator('section').filter({ has: page.getByRole('heading', { name: 'Respiratory rate', exact: true }) }).first().locator(':scope > p').first()
  await expect(heart).toBeVisible()
  const before = { heart: await heart.innerText(), respiration: await respiration.innerText() }
  await expect(heart).not.toContainText('180 bpm')
  await expect(respiration).not.toContainText('40 breaths/min')
  await expect.poll(() => heart.innerText(), { timeout: 12_000 }).not.toBe(before.heart)
  await expect.poll(() => respiration.innerText(), { timeout: 12_000 }).not.toBe(before.respiration)
  await page.goto('/#/guide')
  const search = page.getByRole('searchbox', { name: 'Search the crew guide' })
  await search.fill('oxygen')
  await expect(page.getByRole('navigation', { name: 'Crew guide topics' }).getByRole('link', { name: /Check a change in oxygen/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check a change in oxygen or breathing' })).toBeVisible()
  await search.fill('dizziness')
  await expect(page.getByRole('heading', { name: 'Document dizziness after a gravity transition' })).toBeVisible()
  expect(await page.locator('.guide-content').evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
})
