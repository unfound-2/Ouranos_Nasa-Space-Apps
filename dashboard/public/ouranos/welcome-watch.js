// Welcome page: mount the OURANOS watch when its section comes into view and play the connect
// sequence once. The buttons take it apart and replay the sequence. This is a product preview;
// the dashboard drives the same viewer from the real watch link.
import { createOuranosWatch } from './ouranos-watch-3d.js'

const showcase = document.querySelector('.ouranos-showcase')
const canvas = showcase?.querySelector('.ouranos-canvas')
const toggle = showcase?.querySelector('[data-action="explode"]')
const replay = showcase?.querySelector('[data-action="connect"]')

if (canvas && toggle && replay) {
  let watch = null
  const showToggle = (exploded) => { toggle.textContent = exploded ? 'Put it together' : 'Take it apart' }

  async function play() {
    replay.disabled = toggle.disabled = true
    if (!watch.exploded) {
      watch.setExploded(true)
      await new Promise((resolve) => setTimeout(resolve, 900))
    }
    await watch.connect()
    replay.disabled = toggle.disabled = false
  }

  const mount = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting || watch) return
    mount.disconnect()
    try {
      watch = await createOuranosWatch(canvas, {
        labels: showcase.querySelector('.ouranos-labels'),
        exploded: true,
        onExplodedChange: showToggle,
      })
    } catch {
      showcase.classList.add('ouranos-unavailable')
      return
    }
    showToggle(true)
    toggle.addEventListener('click', () => watch.setExploded(!watch.exploded))
    replay.addEventListener('click', () => { void play() })
    const start = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio < 0.55) return
      start.disconnect()
      setTimeout(() => { void play() }, 700)
    }, { threshold: [0.55] })
    start.observe(canvas)
  }, { rootMargin: '300px 0px' })
  mount.observe(canvas)
}
