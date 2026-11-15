#!/usr/bin/env node
/**
 * Mock monitoring systems. Each one pairs with a mission computer the way the watch app does, then
 * streams SIMULATED readings and review alerts, so the pairing flow can be shown without hardware.
 *
 * Every frame and alert carries `simulated: true`, and every source label ends in "simulation". The
 * dashboard labels them as simulated, and alerts land in the Demo workspace. Nothing here can pass
 * as real data.
 *
 *   node scripts/mock-watch.mjs [console-url] [--system <kinds>] [--no-alerts]
 *
 *   console-url   default http://127.0.0.1:4317
 *   --system      one kind or a comma list, default ouranos-watch. Each kind pairs as its own device
 *                 and prints its own pairing code. Kinds: ouranos-watch, chest-strap, bp-cuff,
 *                 suit-biomonitor. Example: --system ouranos-watch,chest-strap,bp-cuff
 *   --no-alerts   never send review alerts on their own
 *
 * Keys in a terminal: a = every system sends a review alert now, q = unpair and quit.
 * Signals: SIGUSR1 = send review alerts, SIGINT or SIGTERM = unpair and quit.
 */
import { randomUUID } from 'node:crypto'

const ACTION = 'Review the flagged channels, verify the readings with the source instrument, and share the verified results with the crew medical officer.'

/**
 * One entry per kind of monitoring system. `readings(elevated, drift)` returns
 * [metric, value, unit, flagged] rows. Flagged rows carry the review status while elevated.
 */
const SYSTEMS = {
  'ouranos-watch': {
    name: 'Mock Ouranos watch',
    source: 'Mock watch simulation',
    frameMs: 2000, // the watch app sends a frame every 2 s
    cycle: 30, // frames per cycle, about one minute
    elevated: [10, 14],
    freshnessSeconds: null,
    alertReason: 'heart rate and respiration stayed raised',
    readings: (up, drift, step) => [
      ['Heart rate', Math.round((up ? 128 : 74) + drift(0.85, 2)), 'bpm', true],
      ['Respiration', Math.round((up ? 27 : 16) + drift(0.6, 1)), '/min', true],
      ['Blood oxygen', round1(98 + drift(0.47, 0.3)), '%'],
      ['Skin temperature', round1(34.1 + drift(0.32, 0.1)), '°C'],
      ['Systolic blood pressure', Math.round(118 + drift(0.37, 2)), 'mmHg'],
      ['Tidal volume', Math.round(480 + drift(0.62, 12)), 'mL'],
      ['Environmental noise exposure', round1(58 + drift(0.73, 2)), 'dBA'],
      ['Wrist motion', Number((0.12 + Math.abs(drift(1.1, 0.03))).toFixed(2)), 'g'],
      ['Steps in latest sample', Math.max(0, Math.round((up ? 40 : 6) + drift(1.3, 3))), 'steps'],
    ],
    summary: (f) => `heart rate ${value(f, 'Heart rate')} bpm`,
  },
  'chest-strap': {
    name: 'Mock chest strap',
    source: 'Chest strap simulation',
    frameMs: 2000,
    cycle: 30,
    elevated: [12, 16],
    freshnessSeconds: null,
    alertReason: 'ECG heart rate and respiration stayed raised',
    readings: (up, drift) => [
      ['ECG heart rate', Math.round((up ? 124 : 72) + drift(0.9, 2)), 'bpm', true],
      ['Respiration', Math.round((up ? 26 : 15) + drift(0.55, 1)), '/min', true],
      ['Heart rate variability (RMSSD)', Math.round((up ? 22 : 48) + drift(0.41, 4)), 'ms'],
    ],
    summary: (f) => `ECG heart rate ${value(f, 'ECG heart rate')} bpm`,
  },
  'bp-cuff': {
    name: 'Mock blood pressure cuff',
    source: 'Blood pressure cuff simulation',
    frameMs: 10_000, // one cuff reading every 10 s
    cycle: 12, // two minutes
    elevated: [5, 7],
    freshnessSeconds: 20, // two reading intervals, so one late reading does not look stale
    alertReason: 'blood pressure stayed raised on consecutive readings',
    readings: (up, drift) => [
      ['Systolic blood pressure', Math.round((up ? 148 : 118) + drift(0.7, 3)), 'mmHg', true],
      ['Diastolic blood pressure', Math.round((up ? 96 : 76) + drift(0.5, 2)), 'mmHg', true],
      ['Pulse', Math.round((up ? 98 : 70) + drift(0.8, 2)), 'bpm'],
    ],
    summary: (f) => `${value(f, 'Systolic blood pressure')}/${value(f, 'Diastolic blood pressure')} mmHg`,
  },
  'suit-biomonitor': {
    name: 'Mock suit biomonitor',
    source: 'Suit biomonitor simulation',
    frameMs: 2000,
    cycle: 30,
    elevated: [18, 22],
    freshnessSeconds: null,
    alertReason: 'heart rate, respiration and suit CO2 stayed raised',
    readings: (up, drift) => [
      ['Heart rate', Math.round((up ? 132 : 82) + drift(0.8, 2)), 'bpm', true],
      ['Respiration', Math.round((up ? 28 : 17) + drift(0.6, 1)), '/min', true],
      ['Suit pressure', Number((29.6 + drift(0.21, 0.08)).toFixed(2)), 'kPa'],
      ['CO2 partial pressure', round1((up ? 6.8 : 3.1) + drift(0.35, 0.2)), 'mmHg', true],
      ['Skin temperature', round1((up ? 35.2 : 34.4) + drift(0.3, 0.1)), '°C'],
    ],
    summary: (f) => `heart rate ${value(f, 'Heart rate')} bpm, CO2 ${value(f, 'CO2 partial pressure')} mmHg`,
  },
}

function round1(x) {
  return Number(x.toFixed(1))
}
function value(f, metric) {
  return f.readings.find((r) => r.metric === metric)?.value ?? 'no value'
}

// ---------------------------------------------------------------------------
// Arguments

const args = process.argv.slice(2)
let urlArg = null
let systemArg = 'ouranos-watch'
let autoAlerts = true
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--no-alerts') autoAlerts = false
  else if (arg === '--system') systemArg = args[++i] ?? ''
  else if (arg.startsWith('--system=')) systemArg = arg.slice('--system='.length)
  else if (arg.startsWith('--')) fail(`Unknown option ${arg}.`)
  else urlArg ??= arg
}
const base = new URL(urlArg ?? 'http://127.0.0.1:4317')
const kinds = systemArg.split(',').map((k) => k.trim()).filter(Boolean)
if (!kinds.length) fail('Name at least one system after --system.')
for (const k of kinds) {
  if (!Object.hasOwn(SYSTEMS, k)) fail(`Unknown system "${k}". Choose from: ${Object.keys(SYSTEMS).join(', ')}.`)
}

function fail(message) {
  console.error(message)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// HTTP

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

// ---------------------------------------------------------------------------
// Output. Several systems share one terminal, so a TTY gets one combined status line.

const tty = Boolean(process.stdout.isTTY)
const status = new Map()
let statusShown = false

function log(text) {
  if (tty && statusShown) process.stdout.write('\n')
  statusShown = false
  console.log(text)
}

function showStatus() {
  if (!tty || !status.size) return
  const line = [...status.values()].join(' | ')
  process.stdout.write(`\r${line}   a = alert, q = quit   `)
  statusShown = true
}

// ---------------------------------------------------------------------------
// One mock device

class MockSystem {
  constructor(kind, index) {
    this.kind = kind
    this.key = `${kind}#${index}` // the same kind may run twice, for two crew members
    this.spec = SYSTEMS[kind]
    this.token = null
    this.step = 0
    this.streak = 0
    this.alerted = false
    this.wantAlert = false
  }

  get label() {
    return `${this.spec.name} (${this.kind})`
  }

  /** One frame. The watch matches the watch app's Sim mode (ContentView.swift demoFrame). */
  frame({ forceElevated = false } = {}) {
    const { cycle, elevated, source, freshnessSeconds } = this.spec
    const i = this.step % cycle
    const up = forceElevated || (i >= elevated[0] && i <= elevated[1])
    const flagStatus = up ? 'review' : 'nominal'
    const now = Date.now() / 1000
    const drift = (rate, size) => size * Math.sin(this.step * rate)
    return {
      version: 1,
      source,
      observedAt: now,
      ...(freshnessSeconds ? { freshnessSeconds } : {}),
      simulated: true,
      readings: this.spec.readings(up, drift, this.step).map(([metric, v, unit, flagged = false]) =>
        ({ metric, value: v, unit, quality: 'valid', status: flagged ? flagStatus : 'nominal', measuredAt: now })),
    }
  }

  async sendAlert(f, reason) {
    const evidence = f.readings.filter((r) => r.quality === 'valid' && r.status !== 'nominal').map((r) => r.metric)
    await call('/api/signals', {
      method: 'POST', token: this.token,
      body: {
        id: randomUUID(), createdAt: Date.now() / 1000, frame: f, evidence,
        wristMotionG: f.readings.find((r) => r.metric === 'Wrist motion')?.value ?? null,
        action: ACTION, hapticRequested: false,
      },
    })
    log(`[${clock()}] ${this.spec.name}: sent a simulated review alert (${reason}): ${evidence.join(', ')}. See Event History in the Demo workspace.`)
  }

  /** Ask for a code like the watch's Get pairing code button, then wait until the website redeems it. */
  async pair() {
    for (;;) {
      const p = await call('/api/pairing', { method: 'POST' })
      const code = `${p.code.slice(0, 5)}-${p.code.slice(5)}`
      const expires = new Date(p.codeExpiresAt * 1000).toLocaleTimeString()
      // The watch signs a crew member in; every other system is added to that crew member.
      const first = this.kind === 'ouranos-watch'
      const page = first ? '/#/pair' : '/#/pair?mode=system'
      log([
        '',
        `  ${this.spec.name} (simulated), system ${this.kind}`,
        '',
        `  ${this.kind} pairing code:  ${code}`,
        '',
        `  1. Open ${new URL(page, base.origin).href}`,
        first
          ? '  2. Type any name and this code, then press Continue.'
          : '  2. Type this code and press Pair system. Pair a watch first if no crew member is signed in.',
        `  The code works once and expires at ${expires}.`,
        '',
      ].join('\n'))
      while (Date.now() / 1000 < p.codeExpiresAt) {
        const { paired } = await call('/api/device', { token: p.watchToken })
        if (paired) {
          log(`[${clock()}] ${this.spec.name}: paired. Streaming simulated readings every ${this.spec.frameMs / 1000} s.`)
          return p.watchToken
        }
        await sleep(2000)
      }
      log(`[${clock()}] ${this.spec.name}: code expired before it was entered. Getting a new one.`)
    }
  }

  async run() {
    for (;;) {
      if (quitting) return
      try {
        if (!this.token) {
          this.token = await this.pair()
          this.step = 0
          this.streak = 0
          this.alerted = false
        }
        if (this.wantAlert) {
          this.wantAlert = false
          await this.sendAlert(this.frame({ forceElevated: true }), 'requested')
        }
        const f = this.frame()
        await call('/api/watch', { method: 'POST', token: this.token, body: f })
        const flagged = f.readings.some((r) => r.status !== 'nominal')
        if (flagged) {
          this.streak += 1
          // Like the watch: alert once flagged channels persist across consecutive frames.
          if (autoAlerts && this.streak >= 2 && !this.alerted) {
            await this.sendAlert(f, this.spec.alertReason)
            this.alerted = true
          }
        } else {
          this.streak = 0
          this.alerted = false
        }
        if (this.step % 5 === 0) await call('/api/device', { token: this.token }) // check in, like the watch's link check
        const line = `${this.spec.name}: frame ${this.step + 1}, ${this.spec.summary(f)}${flagged ? ' (raised)' : ''}`
        status.set(this.key, line)
        if (tty) showStatus()
        else if (this.step % 5 === 0) console.log(`[${clock()}] ${line}`)
        this.step += 1
      } catch (err) {
        if (quitting) return
        if (err instanceof ApiError && err.code === 'PAIRING_REQUIRED') {
          log(`[${clock()}] The dashboard disconnected the ${this.spec.name.replace(/^Mock /, 'mock ')}. Pairing again.`)
          this.token = null
          status.delete(this.key)
          continue
        }
        log(`[${clock()}] ${this.spec.name}: ${err.message}. Retrying.`)
      }
      await sleep(this.spec.frameMs)
    }
  }

  async unpair() {
    if (!this.token) return
    try {
      await call('/api/device', { method: 'DELETE', token: this.token })
      log(`[${clock()}] Unpaired the ${this.spec.name.replace(/^Mock /, 'mock ')}.`)
    } catch (err) {
      log(`[${clock()}] Could not unpair the ${this.spec.name.replace(/^Mock /, 'mock ')} cleanly: ${err.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main

const systems = kinds.map((k, i) => new MockSystem(k, i))
let quitting = false

async function quit() {
  if (quitting) return
  quitting = true
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  await Promise.all(systems.map((s) => s.unpair()))
  process.exit(0)
}

const requestAlerts = () => { for (const s of systems) s.wantAlert = true }
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.on('SIGUSR1', requestAlerts)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (key) => {
    const k = key.toString()
    if (k === 'a') requestAlerts()
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

if (systems.length > 1) {
  console.log(`Starting ${systems.length} simulated monitoring systems: ${systems.map((s) => s.label).join(', ')}.`)
  console.log('Pair the watch first (or sign in), then enter each other code at Crew Health, Pair another system.')
}
await Promise.all(systems.map((s) => s.run()))
