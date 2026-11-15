import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('a watch link pairs, streams simulated readings, and creates one review event', async ({ page }) => {
  const created = await page.request.post('/api/pairing')
  expect(created.status()).toBe(201)
  const { code, watchToken, consoleURL } = await created.json()
  expect(consoleURL).toBe(new URL(created.url()).origin + "/")
  const headers = { Authorization: `Bearer ${watchToken}` }
  const frame = {
    version: 1, source: 'Pairing test simulator', observedAt: Date.now() / 1000,
    simulated: true, readings: [{ metric: 'Heart rate', value: 128, unit: 'bpm', quality: 'valid', status: 'priority' }],
  }
  expect((await page.request.post('/api/watch', { headers, data: frame })).status()).toBe(401)
  await page.goto(consoleURL + '#pair=' + code)
  await expect(page.getByLabel('What’s your watch code?')).toHaveValue(code)
  await page.getByLabel('What’s your name?').fill('Pairing test crew')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Skip questions' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await page.goto('/#/system')
  expect((await page.request.post('/api/pairing/redeem', { data: { code } })).status()).toBe(404)
  expect((await (await page.request.get('/api/device', { headers })).json()).paired).toBe(true)
  expect((await page.request.post('/api/watch', { headers, data: frame })).status()).toBe(202)
  await expect(page.getByText('Pairing test simulator · SIMULATED DEMO')).toHaveCount(0)
  await page.goto('/#/pair')
  await page.getByRole('button', { name: 'Run simulator' }).click()
  await expect(page).toHaveURL(/#\/$/)
  await page.goto('/#/system')
  await expect(page.getByText('Pairing test simulator · SIMULATED DEMO')).toBeVisible()

  const id = randomUUID()
  const signal = {
    id, createdAt: Date.now() / 1000, frame,
    hapticRequested: false, evidence: ['Heart rate'], action: 'Verify the pulse with the source instrument.',
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expect((await page.request.post('/api/signals', { headers, data: signal })).status()).toBe(202)
  }
  const demo = await (await page.request.get('/api/v1/snapshot?workspace=demo')).json()
  const mission = await (await page.request.get('/api/v1/snapshot?workspace=mission')).json()
  expect(Object.keys(demo.dataset.events).filter((key) => key === id)).toHaveLength(1)
  expect(demo.dataset.events[id].delivery.hapticRequested).toBe(false)
  expect(mission.dataset.events[id]).toBeUndefined()
  await expect(page.locator('summary').filter({ hasText: /simulated warnings?/ })).toBeVisible()
  await page.locator('summary').filter({ hasText: /simulated warnings?/ }).click()
  await page.locator(`a[href="#/attention/${id}"]`).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Health review')
  await expect(page.getByRole('heading', { name: 'Readings flagged by the watch' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Heart rate', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Open original event record' }).click()
  await expect(page.getByText(signal.action, { exact: true })).toBeVisible()
  await expect(page.getByTestId('reason-codes').getByText('Pairing test simulator · Heart rate 128 bpm · priority', { exact: true })).toBeVisible()
})
