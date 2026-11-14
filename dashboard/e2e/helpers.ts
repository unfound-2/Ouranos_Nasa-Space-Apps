import { expect, type Page } from '@playwright/test'

/** Open the dashboard in a given workspace without clicking through the banner. */
export async function openIn(page: Page, workspace: 'mission' | 'demo', hash = '#/') {
  // Only on the first load in this tab, so a reload keeps whatever the user switched to.
  await page.addInitScript((w) => {
    try {
      if (!window.sessionStorage.getItem('gg.e2e.init')) {
        window.localStorage.setItem('gg.workspace', w)
        window.sessionStorage.setItem('gg.e2e.init', '1')
      }
    } catch {
      /* ignore */
    }
  }, workspace)
  await page.goto(`/${hash}`)
}

/** Put the simulated demo back to its fixture state so tests do not depend on each other. */
export async function resetDemo(page: Page) {
  const res = await page.request.post('/api/v1/demo/reset', { data: {} })
  expect(res.ok()).toBeTruthy()
}

export const banner = (page: Page) => page.getByTestId('source-banner')
