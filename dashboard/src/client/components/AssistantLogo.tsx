import { useEffect, useRef, useState } from 'react'
const logoModule = '/astronaut/mission-logo-3d.js'

type MissionLogo = { draw: (x: number, y: number) => void; dispose: () => void }

export function AssistantLogo() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    let logo: MissionLogo | undefined
    let disposed = false
    let angle = .48
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let last = 0
    let visible = false
    function tick(time: number) {
      if (last) angle += Math.min(time - last, 40) * .00045
      last = time
      logo?.draw(-.21, angle)
      frame = requestAnimationFrame(tick)
    }
    function sync() {
      cancelAnimationFrame(frame)
      last = 0
      if (logo && visible && !reduced.matches && !document.hidden) frame = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    observer.observe(element)
    reduced.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    void import(/* @vite-ignore */ logoModule).then(({ createMissionLogo }) => {
      if (disposed) return
      logo = createMissionLogo(element, 168, 168)
      logo?.draw(-.21, angle)
      sync()
    }).catch(() => {
      if (!disposed) setUnavailable(true)
    })
    return () => {
      disposed = true
      observer.disconnect()
      reduced.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      cancelAnimationFrame(frame)
      logo?.dispose()
    }
  }, [])

  return unavailable
    ? <img className="mission-logo-fallback" src="/astronaut/mission-logo.png" alt="" width="116" height="120" />
    : <canvas ref={canvas} width={168} height={168} className="mission-logo-canvas" />
}
