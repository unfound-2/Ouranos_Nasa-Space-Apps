import { expect } from '@playwright/test'
import { signInWithSimulator, test } from './helpers'

test('review keeps six solid reading cards and a usable chat on phone', async ({ page }) => {
  await signInWithSimulator(page)
  await page.goto('/#/attention')
  await expect(page.locator('.review-reading')).toHaveCount(6)
  const input = page.getByLabel('Ask about your readings', { exact: true })
  await input.scrollIntoViewIfNeeded()
  await input.fill('What should I check?')
  await input.press('Enter')
  await expect(page.locator('.mission-chat-turn')).toHaveCount(1)
  await expect(page.locator('.mission-chat-turn').getByRole('link', { name: /View NASA guide/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => scrollTo(0,0))
  await page.screenshot({ path: '/tmp/ouranos-health-review-mobile.png', fullPage: true })
})
