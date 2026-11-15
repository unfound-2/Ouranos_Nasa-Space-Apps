import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { openIn, resetDemo } from './helpers'

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]'])

test('every page works with all non-local traffic blocked', async ({ page }) => {
  await resetDemo(page)
  const blocked: string[] = []
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:' || LOCAL.has(url.hostname)) return route.continue()
    blocked.push(url.href)
    return route.abort('internetdisconnected')
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await openIn(page, 'demo')
  await expect(page.getByTestId('hero-alert')).toBeVisible()
  for (const hash of ['#/events/sim-evt-20261112-a', '#/crew', '#/events', '#/system', '#/sessions/sim-a-20261112']) {
    await page.goto(`/${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  await page.goto('/#/system')
  await expect(page.getByTestId('external-count')).toHaveText('0')
  expect(blocked).toEqual([])
  expect(errors).toEqual([])
  // Fonts are bundled: each face actually loads with every non-local request blocked.
  // (document.fonts.check() is true for a family that does not exist, so load() is used instead.)
  for (const font of ['600 16px "Geist Variable"', '400 16px "Geist Mono Variable"']) {
    const faces = await page.evaluate(async (f) => (await document.fonts.load(f)).map((x) => x.status), font)
    expect(faces.length, font).toBeGreaterThan(0)
    expect(faces.every((x) => x === 'loaded'), font).toBe(true)
  }
})

test('the built bundle references no remote fonts, styles or scripts', () => {
  const dist = path.join(process.cwd(), 'dist')
  const html = readFileSync(path.join(dist, 'index.html'), 'utf8')
  expect(html).not.toMatch(/<(script|link)[^>]+(src|href)="https?:\/\//)
  const assets = readdirSync(path.join(dist, 'assets'))
  for (const f of assets.filter((x) => x.endsWith('.css'))) {
    const css = readFileSync(path.join(dist, 'assets', f), 'utf8')
    expect(css).not.toMatch(/url\(\s*["']?https?:\/\//)
    expect(css).not.toMatch(/@import\s+(url\()?["']?https?:/)
  }
  expect(assets.some((f) => f.endsWith('.woff2'))).toBe(true)
})
