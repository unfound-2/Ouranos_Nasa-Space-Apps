import { expect, test } from '@playwright/test'
import { signInWithSimulator } from './helpers'

test('Home presents the watch and features without the astronaut or background art', async ({ page }) => {
  await page.goto('/astronaut/')
  await expect(page.getByRole('heading', { name: 'What is Ouranos?' })).toBeVisible()
  await expect(page.locator('model-viewer, .ribbon-background, .black-hole')).toHaveCount(0)
  await expect(page.locator('.ouranos-actions, .ouranos-wordmark')).toHaveCount(0)
  await expect(page.getByText('Drag to turn it.', { exact: false })).toHaveCount(0)
  const feature = page.getByRole('heading', { name: 'What do the features do?' })
  await feature.scrollIntoViewIfNeeded()
  await expect(feature).toBeVisible()
  await page.locator('.ouranos-canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.ouranos-showcase')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.ouranos-showcase')).toHaveAttribute('data-animation', 'assembled')
  const canvas = page.locator('.ouranos-canvas')
  const watchBox = (await canvas.boundingBox())!
  const featuresBox = (await page.locator('.ouranos-features').boundingBox())!
  if (page.viewportSize()!.width > 760) expect(watchBox.x + watchBox.width).toBeLessThan(featuresBox.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await canvas.focus()
  await canvas.press('Enter')
  await expect(page.locator('.ouranos-showcase')).toHaveAttribute('data-animation', 'apart')
  // The exploded view remains available, then reconnects without an animation button.
  await expect(page.locator('.ouranos-showcase')).toHaveAttribute('data-animation', 'assembled', { timeout: 12_000 })
  await page.screenshot({ path: '/tmp/ouranos-home-watch.png', fullPage: true })
})

test('Overview keeps the astronaut and charts but no longer mounts the 3D watch', async ({ page }) => {
  await signInWithSimulator(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mission health')
  await expect(page.locator('.ouranos-watch-card, .ouranos-watch3d')).toHaveCount(0)
  await expect(page.locator('.mission-vitals-body')).toBeVisible()
  await expect(page.locator('.watch-charts-compact')).toBeVisible()
})
