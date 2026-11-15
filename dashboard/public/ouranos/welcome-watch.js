// Start with the assembly animation. Opening the model holds its exploded view for
// five visible seconds before replaying the sequence, without separate controls.
import { createOuranosWatch } from './ouranos-watch-3d.js'

const showcase = document.querySelector('.ouranos-showcase')
const canvas = showcase?.querySelector('.ouranos-canvas')

if (canvas) {
  let watch = null
  let mounting = false
  let inView = false
  let disposed = false
  let timer = null
  let playing = false
  let hasPlayed = false
  let remaining = 5000
  let deadline = 0

  function stopTimer() {
    if (timer !== null) {
      remaining = Math.max(0, deadline - performance.now())
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule() {
    stopTimer()
    if (!watch || !inView || document.hidden || disposed || playing || !watch.exploded) return
    deadline = performance.now() + remaining
    timer = setTimeout(() => { timer = null; void play() }, remaining)
  }

  async function play() {
    if (!watch || playing || disposed) return
    stopTimer()
    playing = true
    hasPlayed = true
    showcase.dataset.animation = 'assembling'
    try {
      await watch.connect()
    } finally {
      playing = false
      if (!disposed) {
        showcase.dataset.animation = watch.exploded ? 'apart' : 'assembled'
        if (watch.exploded) schedule()
      }
    }
  }

  const observer = new IntersectionObserver(async ([entry]) => {
    inView = entry.isIntersecting && entry.intersectionRatio >= .35
    if (!inView) { stopTimer(); return }
    if (!watch && !mounting) {
      mounting = true
      try {
        const created = await createOuranosWatch(canvas, {
          labels: showcase.querySelector('.ouranos-labels'),
          exploded: true,
          onExplodedChange(exploded) {
            stopTimer()
            remaining = 5000
            if (!playing) showcase.dataset.animation = exploded ? 'apart' : 'assembled'
            if (exploded) schedule()
          },
        })
        if (disposed) { created.dispose(); return }
        watch = created
        // This is an illustration of the assembly, not a claim of a paired watch.
        watch.setScreen({ title: 'OURANOS', detail: 'Apple Watch SE', status: 'Design preview' })
        showcase.dataset.ready = 'true'
      } catch {
        showcase.classList.add('ouranos-unavailable')
        showcase.querySelector('.ouranos-model-fallback').hidden = false
        observer.disconnect()
        return
      }
    }
    if (!inView || document.hidden) return
    if (watch && !hasPlayed) void play()
    else schedule()
  }, { threshold: [0, .35] })
  observer.observe(canvas)

  canvas.addEventListener('keydown', (event) => {
    if (!watch || !['Enter', ' '].includes(event.key)) return
    event.preventDefault()
    if (!playing) watch.setExploded(!watch.exploded)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTimer()
    else schedule()
  })
  window.addEventListener('pagehide', (event) => {
    stopTimer()
    if (event.persisted) return
    disposed = true
    observer.disconnect()
    watch?.dispose()
  })
  window.addEventListener('pageshow', () => { if (!disposed) schedule() })
}
