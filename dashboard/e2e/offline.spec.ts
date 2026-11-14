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
  // Fonts are bundled: the computed font is the local B612, not a fallback.
  expect(await page.evaluate(() => document.fonts.check('700 16px "B612"'))).toBe(true)
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
