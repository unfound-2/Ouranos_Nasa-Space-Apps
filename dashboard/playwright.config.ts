import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/*
 * End-to-end tests run against the production shape: `npm run build`, then the mission-computer
 * API serving dist/ on its own port with a fresh, empty data directory. Nothing touches dashboard/data.
 */
export const E2E_PORT = Number(process.env.GG_E2E_PORT ?? 4593)
export const E2E_TOKEN = 'e2e-device-token-not-a-secret'
const dataDir = process.env.GG_E2E_DATA ?? mkdtempSync(path.join(tmpdir(), 'gg-e2e-'))

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', testIgnore: /responsive/, use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', testMatch: /responsive/, use: { ...devices['Pixel 7'], channel: 'chromium' } },
  ],
  webServer: {
    command: `npm run build && NODE_ENV=production GG_PORT=${E2E_PORT} GG_DATA_DIR="${dataDir}" GG_DEVICE_TOKEN=${E2E_TOKEN} npx tsx src/server/main.ts`,
    url: `http://127.0.0.1:${E2E_PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
