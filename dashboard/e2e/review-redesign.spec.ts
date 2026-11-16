import { expect } from '@playwright/test'
import { signInWithSimulator, signInWithWatch, test } from './helpers'

// Real loading states are held at the network boundary, not simulated by artificial UI delays.
test('health review reserves its layout while records load', async ({ page }) => {
  await signInWithSimulator(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/v1/snapshot**', async route => { await held; await route.continue() })
  await page.goto('/#/attention')
  await page.reload()
  await expect(page.getByTestId('page-skeleton')).toBeVisible()
  await expect(page.locator('.skeleton-metric')).toHaveCount(6)
  expect(await page.locator('.skeleton').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  await page.screenshot({ path: '/tmp/ouranos-review-skeleton.png', fullPage: false })
  release()
  await expect(page.getByTestId('page-skeleton')).toHaveCount(0)
  await expect(page.locator('.review-reading')).toHaveCount(6)
  await page.unroute('**/api/v1/snapshot**')
  await page.route('**/api/v1/snapshot**', route => route.abort('failed'))
  await page.reload()
  await expect(page.getByText('No data shown: the local API is not reachable')).toBeVisible()
  await expect(page.getByTestId('page-skeleton')).toHaveCount(0)
})

test('review uses solid cards and the Overview conversation with follow-up context', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await signInWithSimulator(page)
  await page.goto('/#/attention')
  await expect(page.locator('.review-reading')).toHaveCount(6)
  await expect(page.getByRole('heading', { name: 'What changed', exact: true })).toBeVisible()
  const style = await page.locator('.review-card').first().evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundColor, image: s.backgroundImage, blur: s.backdropFilter } })
  expect(style).toEqual({ background: 'rgb(16, 17, 20)', image: 'none', blur: 'none' })
  await expect(page.locator('.mission-assistant-stage .skeleton')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/ouranos-health-review-desktop.png', fullPage: false })
  let calls = 0
  await page.route('**/api/v1/crew-assistant', async route => {
    const body = route.request().postDataJSON()
    expect(body.mode).toBe('chat')
    if (++calls === 2) {
      expect(body.history).toHaveLength(1)
      expect(body.history[0].question).toBe('What changed?')
    }
    await new Promise(resolve => setTimeout(resolve, 700))
    await route.continue()
  })
  const chat = page.getByRole('region', { name: 'Ask about these readings', exact: true })
  await chat.getByRole('button', { name: 'What changed?', exact: true }).click()
  await expect(chat.getByRole('status', { name: 'Reviewing readings' })).toBeVisible()
  await expect(chat.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled()
  await expect(chat.getByRole('link', { name: /View NASA guide/ })).toBeVisible()
  await chat.getByLabel('Ask about your readings', { exact: true }).fill('What should I check about that?')
  await chat.getByLabel('Ask about your readings', { exact: true }).press('Enter')
  await expect(chat.locator('.mission-chat-turn')).toHaveCount(2)
  await expect(chat.getByRole('link', { name: /View NASA guide/ })).toHaveCount(2)
  await page.getByText('View checklist', { exact: true }).click()
  await expect(page.locator('.review-guide ol li').first()).toBeVisible()
  await expect(page.locator('.review-guide').getByRole('link', { name: /View NASA guide/ })).toHaveAttribute('href', /^https:\/\/[^/]*nasa\.gov\//)
  expect(errors).toEqual([])
})

test('missing measurements show an honest empty state, not skeletons forever', async ({ page }) => {
  await signInWithWatch(page)
  await page.goto('/#/attention')
  await expect(page.getByRole('heading', { name: 'No comparable readings yet' })).toBeVisible()
  await expect(page.getByTestId('page-skeleton')).toHaveCount(0)
  await expect(page.locator('.review-reading')).toHaveCount(0)
  await page.goto('/#/attention/no-such-event')
  await expect(page.getByRole('heading', { name: 'This warning is no longer available' })).toBeVisible()
  await page.getByRole('link', { name: 'Review current readings' }).click()
  await expect(page).toHaveURL(/#\/attention$/)
})
