// Long-lived headless Chromium session for capturing the OURANOS website.
// Pairing lives in this browser context's sessionStorage, so the same page is kept
// open and driven over a small local HTTP control API (127.0.0.1:47123):
//   /goto?url=...            navigate
//   /shot?path=...           PNG screenshot
//   /eval  (POST body = JS)  evaluate an expression, returns JSON
//   /click?sel=...           click a selector (mouse is parked afterwards)
//   /fill?sel=...&val=...    fill an input
//   /record?secs=..&out=..   CDP screencast for N seconds -> CFR 30 fps H.264 (crf 12)
//   /quit
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { chromium } = require('/Users/sriyanbodla/Organized/Projects/NASASPACEAPP26-dashboard/dashboard/node_modules/playwright')

const PORT = 47123
const SCRATCH = process.env.SCRATCH || '/private/tmp/claude-501/-Users-sriyanbodla/94243377-bb2b-4031-b881-629fe7f8de5e/scratchpad'

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal'] })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text().slice(0, 200)) })
  // Optional slow clock (localStorage.__capRate, e.g. 0.5): the page runs at that speed while the
  // screencast keeps real timestamps, and record() rescales them, so heavy WebGL scenes still
  // come out at a smooth 30 fps.
  await page.addInitScript(() => {
    let rate = 1
    try { rate = Number(localStorage.getItem('__capRate')) || 1 } catch {}
    if (rate === 1) return
    const realNow = performance.now.bind(performance)
    const t0 = realNow()
    performance.now = () => t0 + (realNow() - t0) * rate
    const realDateNow = Date.now
    const d0 = realDateNow()
    Date.now = () => d0 + (realDateNow() - d0) * rate
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => raf((ts) => cb(t0 + (ts - t0) * rate))
    const st = window.setTimeout.bind(window)
    window.setTimeout = (fn, ms, ...a) => st(fn, (ms || 0) / rate, ...a)
    const si = window.setInterval.bind(window)
    window.setInterval = (fn, ms, ...a) => si(fn, (ms || 0) / rate, ...a)
  })
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = '*, *::before, *::after { cursor: none !important; caret-color: transparent !important; }'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })

  async function parkMouse() { await page.mouse.move(2, 600) }

  async function record(secs, out, rate = 1) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Animation.enable')
    await cdp.send('Animation.setPlaybackRate', { playbackRate: rate })
    const frames = []
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push({ ts: f.metadata.timestamp, data: Buffer.from(f.data, 'base64') })
      try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch {}
    })
    const t0 = Date.now() / 1000
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
    await new Promise((r) => setTimeout(r, secs * 1000))
    await cdp.send('Page.stopScreencast')
    const t1 = Date.now() / 1000
    await cdp.detach()
    if (!frames.length) throw new Error('no frames')
    // Frames can arrive slightly out of order; keep timestamp order and one frame per timestamp.
    frames.sort((a, b) => a.ts - b.ts)
    for (let i = frames.length - 1; i > 0; i--) if (frames[i].ts - frames[i - 1].ts < 1e-6) frames.splice(i - 1, 1)
    const dir = path.join(SCRATCH, 'frames', path.basename(out, '.mp4'))
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    let list = 'ffconcat version 1.0\n'
    frames.forEach((f, i) => {
      const name = `f${String(i).padStart(5, '0')}.jpg`
      fs.writeFileSync(path.join(dir, name), f.data)
      const next = i + 1 < frames.length ? frames[i + 1].ts : Math.max(f.ts + 1 / 30, frames[0].ts + (t1 - t0))
      list += `file '${name}'\nduration ${((next - f.ts) * rate).toFixed(6)}\n`
    })
    // The concat demuxer needs the last file repeated for its duration to count.
    list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`
    fs.writeFileSync(path.join(dir, 'list.txt'), list)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
      '-vf', 'fps=30,scale=1920:1080:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-profile:v', 'high', '-r', '30', '-colorspace', 'bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out])
    const span = frames[frames.length - 1].ts - frames[0].ts
    return { frames: frames.length, realSpan: +span.toFixed(2), videoSpan: +(span * rate).toFixed(2), effectiveFps: +(frames.length / Math.max(span * rate, 0.001)).toFixed(1), out }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    const q = Object.fromEntries(url.searchParams)
    let body = ''
    for await (const chunk of req) body += chunk
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj) + '\n') }
    try {
      switch (url.pathname) {
        case '/goto': await page.goto(q.url, { waitUntil: 'load' }); await parkMouse(); return reply(200, { url: page.url() })
        case '/shot': await page.screenshot({ path: q.path }); return reply(200, { path: q.path })
        case '/eval': return reply(200, { result: await page.evaluate(body) })
        case '/click': await page.click(q.sel, { timeout: 10000 }); await parkMouse(); return reply(200, { ok: true })
        case '/fill': await page.fill(q.sel, q.val, { timeout: 10000 }); return reply(200, { ok: true })
        case '/record': return reply(200, await record(Number(q.secs || 10), q.out, Number(q.rate || 1)))
        case '/still': {
          // Full-page PNG at 2x device pixels, then back to the 1x 1920x1080 viewport.
          const cdp = await context.newCDPSession(page)
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false })
          await page.waitForTimeout(Number(q.wait || 1500))
          const { cssContentSize } = await cdp.send('Page.getLayoutMetrics')
          const height = Math.ceil(q.full === '0' ? 1080 : cssContentSize.height)
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: q.full !== '0',
            clip: { x: 0, y: q.full === '0' ? (await page.evaluate('scrollY')) : 0, width: 1920, height, scale: 1 } })
          fs.writeFileSync(q.path, Buffer.from(shot.data, 'base64'))
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
          await cdp.detach()
          return reply(200, { path: q.path, cssHeight: height })
        }
        case '/quit': reply(200, { bye: true }); await browser.close(); process.exit(0)
        default: return reply(404, { error: 'unknown' })
      }
    } catch (err) {
      return reply(500, { error: String(err && err.message || err).slice(0, 500) })
    }
  })
  server.listen(PORT, '127.0.0.1', () => console.log(`control on http://127.0.0.1:${PORT}`))
}

main().catch((err) => { console.error(err); process.exit(1) })
