import { expect, test, type APIRequestContext } from '@playwright/test'

const frame = (source: string, readings: [string, number, string][]) => ({
  version: 1, source, observedAt: Date.now() / 1000, simulated: true,
  readings: readings.map(([metric, value, unit]) => ({ metric, value, unit, quality: 'valid', status: 'nominal', measuredAt: Date.now() / 1000 })),
})

async function newPairing(request: APIRequestContext) {
  const res = await request.post('/api/pairing')
  expect(res.status()).toBe(201)
  return (await res.json()) as { code: string; watchToken: string }
}

test('one crew member pairs a second monitoring system and sees both on Crew Health', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const watch = await newPairing(page.request)
  const strap = await newPairing(page.request)
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  try {
    // Sign in with the watch, the usual way.
    await page.goto('/#pair=' + watch.code)
    await page.getByLabel('What’s your name?').fill('Systems test crew')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Skip questions' }).click()
    await expect(page).toHaveURL(/#\/$/)

    // Add the chest strap to the same crew member.
    await page.goto('/#/crew')
    await page.getByRole('link', { name: 'Pair another system' }).click()
    await expect(page.getByRole('heading', { name: 'Pair another monitoring system' })).toBeVisible()
    await expect(page.getByLabel('What’s your name?')).toHaveCount(0)
    await page.getByLabel('What’s the system’s pairing code?').fill(strap.code)
    await page.getByRole('button', { name: 'Pair system' }).click()
    await expect(page).toHaveURL(/#\/crew$/)

    expect((await page.request.post('/api/watch', { headers: auth(watch.watchToken), data: frame('Mock watch simulation', [['Heart rate', 74, 'bpm']]) })).status()).toBe(202)
    expect((await page.request.post('/api/watch', { headers: auth(strap.watchToken), data: frame('Chest strap simulation', [['ECG heart rate', 72, 'bpm'], ['Respiration', 15, '/min']]) })).status()).toBe(202)

    const cards = page.getByTestId('system-card')
    await expect(cards).toHaveCount(2)
    const watchCard = page.locator('[data-testid="system-card"][data-kind="ouranos-watch"]')
    const strapCard = page.locator('[data-testid="system-card"][data-kind="chest-strap"]')
    await expect(watchCard.locator('[data-slot="ouranos-watch-3d"]')).toHaveCount(1)
    await expect(strapCard).toContainText('Chest strap')
    await expect(strapCard.getByTestId('system-link')).toHaveText('Link verified')
    // Mission records never show simulated readings, even labelled.
    await expect(strapCard).toContainText('sending simulated readings')
    await expect(strapCard.getByTestId('system-reading')).toHaveCount(0)
    await strapCard.getByRole('button', { name: 'Show in the simulated demo' }).click()

    const ecg = strapCard.getByTestId('system-reading').filter({ hasText: 'ECG heart rate' })
    await expect(ecg).toContainText('72 bpm')
    await expect(ecg).toContainText('UTC')
    await expect(ecg).toContainText('Valid')
    await expect(ecg).toContainText('SIMULATED')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recovery history')

    // The chest strap's 3D model paints into its card when WebGL works, else the flat drawing shows.
    const webgl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')))
    if (webgl) {
      const canvas = strapCard.locator('canvas.device-model-canvas')
      await expect(canvas).toHaveCount(1)
      await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        let painted = 0
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted += 1
        return painted
      })).toBeGreaterThan(500)
      // Reduced motion keeps it still; allowing motion starts the slow turn.
      const sample = () => canvas.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        let h = 0
        for (let i = 0; i < d.length; i += 53) h = (h * 31 + d[i]) | 0
        return h
      })
      const still = await sample()
      await page.waitForTimeout(400)
      expect(await sample()).toBe(still)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect.poll(sample).not.toBe(still)
    } else {
      await expect(strapCard.locator('.device-glyph')).toHaveCount(1)
    }

    // At phone width the cards stack without sideways page scroll.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(cards).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    expect(errors).toEqual([])
  } finally {
    for (const p of [watch, strap]) await page.request.delete('/api/device', { headers: auth(p.watchToken) })
  }
})
