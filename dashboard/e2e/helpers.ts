import { expect, test as base, type Page } from '@playwright/test'

/*
 * Signing in. The dashboard sends a browser with no sign-in to #/pair (the Shell in App.tsx), so
 * every test signs in through that real page, the same way crew-systems.spec.ts does, and never
 * by writing sessionStorage itself:
 *
 * - Mission records need a watch sign-in. The test asks for a pairing code with POST /api/pairing,
 *   exactly as a watch does, and enters it on the Pair watch page. That watch never checks in and
 *   never sends a reading, so it adds no record and no link state to mission records.
 * - The simulated demo uses "Run simulator" on the same page, which pairs nothing.
 *
 * Every pairing a test creates is removed when the test ends (see `test` below).
 */

const pairings = new WeakMap<Page, string[]>()

/** Use this `test` in specs that sign in: it unpairs every watch the test paired. */
export const test = base.extend<{ unpairAfterTest: void }>({
  unpairAfterTest: [
    async ({ page }, use) => {
      await use()
      for (const watchToken of pairings.get(page) ?? []) {
        await page.request.delete('/api/device', { headers: { Authorization: `Bearer ${watchToken}` } })
      }
    },
    { auto: true },
  ],
})

/**
 * Sign in to mission records with a newly paired watch, through the Pair watch page.
 * Call it on a fresh page: the pairing link is read when the app first loads.
 */
export async function signInWithWatch(page: Page, name = 'E2E test crew') {
  const created = await page.request.post('/api/pairing')
  expect(created.status()).toBe(201)
  const { code, watchToken } = (await created.json()) as { code: string; watchToken: string }
  pairings.set(page, [...(pairings.get(page) ?? []), watchToken])
  await page.goto('/#pair=' + code)
  await expect(page.getByLabel('What’s your watch code?')).toHaveValue(code)
  await page.getByLabel('What’s your name?').fill(name)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Skip questions' }).click()
  await expect(page).toHaveURL(/#\/$/)
  return { watchToken }
}

/** Sign in to the simulated demo with "Run simulator", through the Pair watch page. */
export async function signInWithSimulator(page: Page) {
  await page.goto('/#/pair')
  await page.getByRole('button', { name: 'Run simulator' }).click()
  await page.getByRole('button', { name: 'Skip questions' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

/** Sign in for a workspace (watch for mission records, simulator for the demo), then open `hash`. */
export async function openIn(page: Page, workspace: 'mission' | 'demo', hash = '#/') {
  if (workspace === 'mission') await signInWithWatch(page)
  else await signInWithSimulator(page)
  if (hash !== '#/') await page.goto(`/${hash}`)
}

/** Open a collapsed section of the page (a <details> by its summary text) unless it is open. */
export async function expand(page: Page, summary: string) {
  const exact = new RegExp(`^\\s*${summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
  const toggle = page.locator('summary').filter({ hasText: exact })
  const details = toggle.locator('xpath=ancestor::details[1]')
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await toggle.click()
  await expect(details).toHaveAttribute('open', '')
  return details
}

/** The collapsed "Crew, simulator and connection details" section under every page. */
export const connectionDetails = (page: Page) => expand(page, 'Crew, simulator and connection details')

/** Go to a page with the main navigation menu (public/mission-nav.js), opening it first. */
export async function navTo(page: Page, name: 'Overview' | 'Crew Health' | 'Health review' | 'Crew guide' | 'System Status') {
  const menu = page.locator('details.mission-nav')
  if (!(await menu.evaluate((d) => (d as HTMLDetailsElement).open))) await menu.locator('summary').click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click()
}

/**
 * Switch from mission records to the simulated demo the way a person does: "Open simulated demo"
 * in the connection details, then "Run simulator" on the Pair watch page.
 */
export async function openSimulatedDemo(page: Page) {
  await connectionDetails(page)
  await page.getByTestId('source-banner').getByRole('button', { name: 'Open simulated demo' }).click()
  await expect(page).toHaveURL(/#\/pair$/)
  await page.getByRole('button', { name: 'Run simulator' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

/** Put the simulated demo back to its fixture state so tests do not depend on each other. */
export async function resetDemo(page: Page) {
  const res = await page.request.post('/api/v1/demo/reset', { data: {} })
  expect(res.ok()).toBeTruthy()
}

/** The data-source line inside the connection details. Its text is in the page even while collapsed. */
export const banner = (page: Page) => page.getByTestId('source-banner')

/** The always-visible "Simulated demo · No astronaut data" line every demo page shows (App.tsx). */
export const demoLabel = (page: Page) => page.locator('p').filter({ hasText: /^\s*Simulated demo\s*No astronaut data\s*$/ })
