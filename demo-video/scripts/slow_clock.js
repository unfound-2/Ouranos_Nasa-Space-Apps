// Injected with /eval after load: slows performance.now and requestAnimationFrame timestamps
// to `rate` from now on (continuous at the switch). Date.now and timers stay real, so data
// polling and "N s ago" labels keep real time. Reload the page to undo.
window.__slow = (rate) => {
  if (window.__slowOn) return 'already'
  window.__slowOn = true
  const realNow = performance.now.bind(performance)
  const T = realNow()
  performance.now = () => T + (realNow() - T) * rate
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => raf((ts) => cb(T + (ts - T) * rate))
  return 'slowed'
}
'ok'
