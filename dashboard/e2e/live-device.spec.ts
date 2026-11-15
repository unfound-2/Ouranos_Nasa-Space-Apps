import { expect } from '@playwright/test'
import { E2E_TOKEN } from '../playwright.config'
import { banner, navTo, openIn, test } from './helpers'

/*
 * Path A without a watch: these requests carry the device token exactly as the watch app would.
 * The records are synthetic test data in a throwaway data directory, named e2e-* so they cannot
 * be mistaken for a person's recording.
 */
const auth = { Authorization: `Bearer ${E2E_TOKEN}` }
const at = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString()

function hr(id: string, phase: 'REST' | 'RECOVERY', measuredAt: string, value: number) {
  return {
    measurementId: id,
    subjectId: 'e2e-test-subject',
    sessionId: 'e2e-session-1',
    indicator: 'HEART_RATE',
    value,
    unit: 'bpm',
    measuredAt,
    phase,
    source: { kind: 'APPLE_WATCH', device: 'e2e test watch', sensor: 'synthetic test values' },
    isSimulated: false,
    quality: 'VALID',
  }
}

test('a device-token heartbeat and live-synced records show as LIVE DEVICE, and the watch acknowledgement arrives separately from review', async ({ page }) => {
  const hb = await page.request.post('/api/v1/device/heartbeat', {
    headers: auth,
    data: { deviceId: 'e2e-test-watch', subjectId: 'e2e-test-subject', sentAt: at(0), appVersion: 'e2e', deviceModel: 'e2e test watch', pendingRecords: 0 },
  })
  expect(hb.status()).toBe(200)

  const start = -150
  const session = {
    schemaVersion: 'gravityguard.recovery-session.v1',
    sessionId: 'e2e-session-1',
    subjectId: 'e2e-test-subject',
    protocol: { id: 'GRAVITY_RECOVERY_CHECK', version: '1.0', plannedRestSeconds: 45, plannedRecoverySeconds: 45 },
    mode: 'DEVICE_RECORDING',
    isSimulated: false,
    startedAt: at(start),
    endedAt: at(start + 120),
    endReason: 'COMPLETED',
    phases: [
      { phase: 'REST', startedAt: at(start + 5), endedAt: at(start + 50) },
      { phase: 'RECOVERY', startedAt: at(start + 65), endedAt: at(start + 110), confirmedAt: at(start + 65), confirmedBy: 'WEARER' },
    ],
    measurements: [
      hr('e2e-m1', 'REST', at(start + 10), 70),
      hr('e2e-m2', 'REST', at(start + 20), 72),
      hr('e2e-m3', 'REST', at(start + 30), 74),
      hr('e2e-m4', 'RECOVERY', at(start + 70), 82),
      hr('e2e-m5', 'RECOVERY', at(start + 80), 84),
      hr('e2e-m6', 'RECOVERY', at(start + 90), 86),
    ],
    symptomCheck: { status: 'REPORTED', answeredAt: at(start + 115) },
    symptoms: [{ symptomId: 'e2e-s1', code: 'DIZZY', reportedAt: at(start + 115), phase: 'RECOVERY', reportedBy: 'SELF_REPORTED' }],
    provenance: { origin: 'WATCH_APP', appVersion: 'e2e', deviceId: 'e2e-test-watch' },
  }
  const s = await page.request.post('/api/v1/sessions', { headers: auth, data: session })
  expect(s.status()).toBe(201)
  const event = {
    schemaVersion: 'gravityguard.review-event.v1',
    eventId: 'e2e-event-1',
    subjectId: 'e2e-test-subject',
    sessionId: 'e2e-session-1',
    createdAt: at(start + 116),
    origin: { kind: 'WATCH_RULES', ruleSet: 'e2e', deviceId: 'e2e-test-watch' },
    category: 'REVIEW_SUGGESTED',
    severity: 'REVIEW',
    reasonCodes: ['SYMPTOM_REPORTED'],
    evidence: [{ reasonCode: 'SYMPTOM_REPORTED', kind: 'SYMPTOM', refId: 'e2e-s1' }],
    watchMessage: { title: 'HEALTH REVIEW', body: 'OPEN MISSION COMPUTER' },
    status: 'DELIVERED',
    delivery: { channel: 'WATCH_LOCAL', state: 'PRESENTED', presentedAt: at(start + 117), hapticRequested: true, confirmedBy: 'WATCH_APP' },
    isSimulated: false,
    provenance: { origin: 'WATCH_APP', appVersion: 'e2e', deviceId: 'e2e-test-watch' },
  }
  expect((await page.request.post('/api/v1/alerts', { headers: auth, data: event })).status()).toBe(201)
  // A resend after a dropped connection is a duplicate, not a second event.
  expect((await page.request.post('/api/v1/alerts', { headers: auth, data: event })).status()).toBe(200)

  await openIn(page, 'mission', '#/events/e2e-event-1')
  await expect(banner(page)).toContainText('LIVE DEVICE')
  await expect(page.getByTestId('watch-state')).toHaveText('Link verified')
  // The separator dot was dropped from this label; the words are unchanged.
  await expect(page.getByTestId('event-header')).toContainText(/REAL\s+LIVE DEVICE/)
  await expect(page.getByTestId('phase-stats')).toContainText('+12 bpm')
  await expect(page.getByText('Simulate watch acknowledgement')).toHaveCount(0)

  // The dashboard cannot acknowledge on the watch's behalf; the watch can.
  expect((await page.request.post('/api/v1/alerts/e2e-event-1/ack', { data: { deviceId: 'e2e-test-watch', acknowledgedAt: at(0) } })).status()).toBe(403)
  expect((await page.request.post('/api/v1/alerts/e2e-event-1/ack', { headers: auth, data: { deviceId: 'e2e-test-watch', acknowledgedAt: at(0) } })).status()).toBe(200)
  await expect(page.getByTestId('event-header')).toContainText('Acknowledged', { timeout: 8000 })
  await navTo(page, 'Event History')
  const row = page.getByTestId('events-table').locator('tr', { hasText: 'e2e-event-1' })
  await expect(row).toContainText('Not reviewed')
})
