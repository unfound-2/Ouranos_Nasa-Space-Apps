import { expect, test } from '@playwright/test'
import { openIn, resetDemo } from './helpers'

test.beforeEach(async ({ page }) => {
  await resetDemo(page)
})

for (const hash of ['#/', '#/events/sim-evt-20261112-a', '#/crew', '#/events', '#/sessions/sim-a-20261112', '#/system']) {
  test(`phone width: ${hash} has no sideways page scroll`, async ({ page }) => {
    await openIn(page, 'demo', hash)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('source-banner')).toContainText('Simulated demo')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}
