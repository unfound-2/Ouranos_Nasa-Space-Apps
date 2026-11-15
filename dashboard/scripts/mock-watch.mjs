#!/usr/bin/env node
/**
 * Mock Ouranos watch. Pairs with a mission computer the way the watch app does, then streams
 * SIMULATED readings and review alerts, so the pairing flow can be shown without a watch.
 *
 * Every frame and alert carries `simulated: true`. The dashboard labels them as simulated, and
 * alerts land in the Demo workspace. Nothing here can pass as real watch data.
 *
 *   node scripts/mock-watch.mjs [console-url] [--no-alerts]     (default http://127.0.0.1:4317)
 *
 * Keys in a terminal: a = send a review alert now, q = unpair and quit.
 * Signals: SIGUSR1 = send a review alert, SIGINT or SIGTERM = unpair and quit.
 */
import { randomUUID } from 'node:crypto'

const args = process.argv.slice(2)
const base = new URL(args.find((arg) => !arg.startsWith('--')) ?? 'http://127.0.0.1:4317')
const autoAlerts = !args.includes('--no-alerts')

const SOURCE = 'Mock watch simulation'
const FRAME_MS = 2000 // the watch app sends a frame every 2 s
const CYCLE = 30 // frames per cycle, about one minute
const ELEVATED = [10, 14] // frames in each cycle with raised heart rate and respiration
const ACTION = 'Review the flagged channels, verify the readings with the source instrument, and share the verified results with the crew medical officer.'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clock = () => new Date().toLocaleTimeString()

class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'error',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* not JSON */ }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? 'HTTP_ERROR',
      `${method} ${path} returned HTTP ${response.status}${data?.error?.message ? `: ${data.error.message}` : ''}`)
  }
  return data
}

/** One frame shaped like the watch app's Sim mode (ContentView.swift demoFrame), with a little drift. */
function frame(step, { forceElevated = false } = {}) {
  const i = step % CYCLE
  const elevated = forceElevated || (i >= ELEVATED[0] && i <= ELEVATED[1])
  const status = elevated ? 'review' : 'nominal'
  const now = Date.now() / 1000
  const drift = (rate, size) => size * Math.sin(step * rate)
  const reading = (metric, value, unit, flagged = false) =>
    ({ metric, value, unit, quality: 'valid', status: flagged ? status : 'nominal', measuredAt: now })
  return {
    version: 1,
    source: SOURCE,
    observedAt: now,
    simulated: true,
    readings: [
      reading('Heart rate', Math.round((elevated ? 128 : 74) + drift(0.85, 2)), 'bpm', true),
      reading('Respiration', Math.round((elevated ? 27 : 16) + drift(0.6, 1)), '/min', true),
      reading('Blood oxygen', Number((98 + drift(0.47, 0.3)).toFixed(1)), '%'),
      reading('Skin temperature', Number((34.1 + drift(0.32, 0.1)).toFixed(1)), '°C'),
      reading('Systolic blood pressure', Math.round(118 + drift(0.37, 2)), 'mmHg'),
      reading('Tidal volume', Math.round(480 + drift(0.62, 12)), 'mL'),
      reading('Environmental noise exposure', Number((58 + drift(0.73, 2)).toFixed(1)), 'dBA'),
      reading('Wrist motion', Number((0.12 + Math.abs(drift(1.1, 0.03))).toFixed(2)), 'g'),
      reading('Steps in latest sample', Math.max(0, Math.round((elevated ? 40 : 6) + drift(1.3, 3))), 'steps'),
    ],
  }
}

const flaggedMetrics = (f) => f.readings.filter((r) => r.quality === 'valid' && r.status !== 'nominal').map((r) => r.metric)

async function sendAlert(token, f, reason) {
  const evidence = flaggedMetrics(f)
  await call('/api/signals', {
    method: 'POST', token,
    body: {
      id: randomUUID(), createdAt: Date.now() / 1000, frame: f, evidence,
      wristMotionG: f.readings.find((r) => r.metric === 'Wrist motion')?.value ?? null,
      action: ACTION, hapticRequested: false,
    },
  })
  console.log(`\n[${clock()}] Sent a simulated review alert (${reason}): ${evidence.join(', ')}. See Event History in the Demo workspace.`)
}

/** Ask for a code like the watch's Get pairing code button, then wait until the website redeems it. */
async function pair() {
  for (;;) {
    const p = await call('/api/pairing', { method: 'POST' })
    const code = `${p.code.slice(0, 5)}-${p.code.slice(5)}`
    const expires = new Date(p.codeExpiresAt * 1000).toLocaleTimeString()
    console.log([
      '',
      '  Mock Ouranos watch (simulated)',
      '',
      `  Pairing code:  ${code}`,
      '',
      `  1. Open ${new URL('/#/pair', base.origin).href}`,
      '  2. Type any name and this code, then press Continue.',
      `  The code works once and expires at ${expires}.`,
      '',
    ].join('\n'))
    while (Date.now() / 1000 < p.codeExpiresAt) {
      const { paired } = await call('/api/device', { token: p.watchToken })
      if (paired) {
        console.log(`[${clock()}] Paired. Streaming simulated readings every 2 s.`)
        return p.watchToken
      }
      await sleep(FRAME_MS)
    }
    console.log(`[${clock()}] Code expired before it was entered. Getting a new one.`)
  }
}

let token = null
let wantAlert = false
let quitting = false

async function quit() {
  if (quitting) return
  quitting = true
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  if (token) {
    try {
      await call('/api/device', { method: 'DELETE', token })
      console.log(`\n[${clock()}] Unpaired the mock watch.`)
    } catch (err) {
      console.log(`\n[${clock()}] Could not unpair cleanly: ${err.message}`)
    }
  }
  process.exit(0)
}

process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.on('SIGUSR1', () => { wantAlert = true })
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (key) => {
    const k = key.toString()
    if (k === 'a') wantAlert = true
    if (k === 'q' || k === '\u0003') void quit()
  })
}

const health = await call('/api/v1/health').catch((err) => {
  console.error(`No mission computer at ${base.origin}: ${err.message}\nStart it with npm start in dashboard/.`)
  process.exit(1)
})
if (health?.service !== 'gravityguard-mission-computer') {
  console.error(`${base.origin} is not an Ouranos mission computer.`)
  process.exit(1)
}

let step = 0
let streak = 0
let alerted = false
for (;;) {
  try {
    if (!token) {
      token = await pair()
      step = 0
      streak = 0
      alerted = false
    }
    if (wantAlert) {
      wantAlert = false
      await sendAlert(token, frame(step, { forceElevated: true }), 'requested')
    }
    const f = frame(step)
    await call('/api/watch', { method: 'POST', token, body: f })
    const flagged = flaggedMetrics(f)
    if (flagged.length) {
      streak += 1
      // The watch alerts once two flagged channels persist across consecutive frames.
      if (autoAlerts && streak >= 2 && !alerted) {
        await sendAlert(token, f, 'heart rate and respiration stayed raised')
        alerted = true
      }
    } else {
      streak = 0
      alerted = false
    }
    if (step % 5 === 0) await call('/api/device', { token }) // check in, like the watch's link check
    const hr = f.readings[0].value
    const line = `[${clock()}] frame ${step + 1}: heart rate ${hr} bpm${flagged.length ? ' (raised)' : ''}`
    if (process.stdout.isTTY) process.stdout.write(`\r${line}   press a = alert, q = quit   `)
    else if (step % 5 === 0) console.log(line)
    step += 1
  } catch (err) {
    if (err instanceof ApiError && err.code === 'PAIRING_REQUIRED') {
      console.log(`\n[${clock()}] The dashboard disconnected this watch. Pairing again.`)
      token = null
      continue
    }
    console.log(`\n[${clock()}] ${err.message}. Retrying.`)
  }
  await sleep(FRAME_MS)
}
