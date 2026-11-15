import { expect, test } from '@playwright/test'
import { signInWithSimulator } from './helpers'

test('all original guides remain searchable and footer licenses work', async ({ page }) => {
  await signInWithSimulator(page)
  await page.goto('/#/guide')
  const topics = page.getByRole('navigation', { name: 'Crew guide topics' })
  await expect(topics.getByRole('link')).toHaveCount(185)
  await page.getByRole('searchbox', { name: 'Search the crew guide' }).fill('Abdominal injury')
  await expect(topics).toContainText('Penetrating')
  await expect(topics).not.toContainText('â')
  const footer = page.getByRole('contentinfo')
  await expect(footer.locator('.ouranos-footer-wordmark')).toHaveText('Ouranos')
  await footer.getByRole('link', { name: 'Licenses & credits' }).click()
  await expect(page.getByRole('heading', { name: 'Licenses and credits' })).toBeVisible()
  const notices = await page.request.get('/legal/THIRD-PARTY-NOTICES.txt')
  expect(notices.ok()).toBeTruthy()
  expect(await notices.text()).toContain('react')
  const license = await page.request.get('/legal/LICENSE.txt')
  expect(await license.text()).toContain('Apache License')
  await page.goto('/astronaut/')
  await expect(page.getByRole('contentinfo').locator('.ouranos-footer-wordmark')).toHaveText('Ouranos')
  await expect(page.getByRole('contentinfo')).not.toContainText('Contract v1')
})
