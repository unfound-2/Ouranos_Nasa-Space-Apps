import { expect } from '@playwright/test'
import { navTo, signInWithSimulator, signInWithWatch, test } from './helpers'

test('watch pairing and reopening the root both show Mission Health', async ({ page }) => {
  const captured: string[] = []
  page.on('pageerror', (error) => captured.push(String(error)))
  await signInWithWatch(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mission health')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mission health')
  await expect(page).toHaveURL(/#\/$/)
  expect(captured).toEqual([])
})

test('the explanation borrows chat space and Health Review offers a sourced checklist', async ({ page }) => {
  await signInWithSimulator(page)
  const card = page.locator('.attention-card')
  const chat = page.locator('.mission-chat-panel')
  const body = page.locator('.mission-vitals').first()
  await expect(card).toBeVisible()
  const before = { chat: (await chat.boundingBox())!.height, body: (await body.boundingBox())!.height }
  await card.getByText('Why this stands out').click()
  await expect(card.locator('details')).toHaveAttribute('open', '')
  expect((await chat.boundingBox())!.height).toBeLessThan(before.chat)
  expect((await body.boundingBox())!.height).toBeCloseTo(before.body, 0)
  await card.getByRole('link', { name: 'What to do next' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Health review')
  await page.getByRole('button', { name: 'What should I do next?' }).click()
  await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('What should I do next?')
  await expect(page.getByRole('log').getByRole('link', { name: /View NASA guide/ })).toHaveAttribute('href', /^https:\/\/[^/]*nasa\.gov\//)
  await navTo(page, 'Crew guide')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crew guide')
  await page.getByRole('link', { name: /Check an unexpected reading/ }).click()
  await expect(page.getByText('Record the original value', { exact: false })).toBeVisible()
  await expect(page.getByText('175 entries')).toHaveCount(0)
})
