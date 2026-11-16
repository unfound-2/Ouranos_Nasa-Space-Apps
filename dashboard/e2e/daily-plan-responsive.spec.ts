import { expect } from '@playwright/test'
import { test, signInWithSimulator } from './helpers'

test('daily plan works at phone width and with keyboard navigation', async ({ page }) => {
  await signInWithSimulator(page)
  await page.goto('/#/plan')
  await page.getByRole('button', { name: 'Somewhat tired', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept change', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Add activity', exact: true }).click()
  await expect(page.getByLabel('Activity', { exact: true })).toBeFocused()
  await page.keyboard.type('A long activity title that must wrap gracefully within the narrow screen')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Start · UTC')).toBeFocused()
  await page.getByRole('button', { name: 'Save activity' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: '/tmp/ouranos-daily-plan-mobile.png', fullPage: true })
})
