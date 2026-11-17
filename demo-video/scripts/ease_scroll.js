// Injected with /eval: window.__ease(targetY, ms, delayMs) scrolls the page with ease-in-out.
window.__ease = (target, ms, delay = 0) => setTimeout(() => {
  const el = document.scrollingElement || document.documentElement
  const from = el.scrollTop
  const t0 = performance.now()
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms)
    el.scrollTop = from + (target - from) * ease(t)
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}, delay)
'ok'
