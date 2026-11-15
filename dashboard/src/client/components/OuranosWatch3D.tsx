import { useEffect, useRef, useState } from 'react'
import type { LinkState } from '../../shared/dataset'
import './ouranos.css'

/** The viewer lives in public/ouranos so the static welcome page can use the same module. */
const VIEWER_MODULE = '/ouranos/ouranos-watch-3d.js'

interface Viewer {
  setExploded(on: boolean): void
  readonly exploded: boolean
  connect(options?: { duration?: number }): Promise<void>
  setConnected(on: boolean): void
  setScreen(screen: { title?: string; detail?: string; status?: string }): void
  dispose(): void
}

const SCREEN: Record<LinkState, { detail: string; status: string }> = {
  VERIFIED: { detail: 'Crew health', status: 'Connected' },
  SIMULATED: { detail: 'Simulated watch', status: 'Demo link' },
  WATCH_UNREACHABLE: { detail: 'Not reachable', status: '' },
  NOT_PAIRED: { detail: 'Not paired', status: '' },
}

/**
 * The OURANOS watch from our CAD, following the real watch link: apart while no watch is paired,
 * together while the link is quiet, and the star connect sequence when the link is verified.
 */
export function OuranosWatch3D({ link, className = '', compact = false }: { link: LinkState; className?: string; compact?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const played = useRef(false)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [exploded, setExploded] = useState(true)

  useEffect(() => {
    let disposed = false
    let created: Viewer | undefined
    void import(/* @vite-ignore */ VIEWER_MODULE)
      .then(async ({ createOuranosWatch }) => {
        if (disposed || !canvas.current) return
        created = (await createOuranosWatch(canvas.current, {
          labels: compact ? null : labels.current, exploded: true, onExplodedChange: setExploded, distance: compact ? 250 : 300,
        })) as Viewer
        if (disposed) return created.dispose()
        viewer.current = created
        setReady(true)
      })
      .catch(() => { if (!disposed) setUnavailable(true) })
    return () => {
      disposed = true
      created?.dispose()
      viewer.current = null
    }
  }, [])

  useEffect(() => {
    const v = viewer.current
    if (!v) return
    const live = link === 'VERIFIED' || link === 'SIMULATED'
    v.setScreen({ title: 'OURANOS', ...SCREEN[link] })
    if (live) {
      if (!played.current) {
        played.current = true
        void v.connect()
      } else v.setConnected(true)
    } else {
      played.current = false
      v.setConnected(false)
      v.setExploded(link === 'NOT_PAIRED')
    }
  }, [ready, link])

  if (unavailable) return null
  return (
    <div className={`ouranos-watch3d ${className}`}>
      <div className="ouranos-stage">
        <canvas ref={canvas} className="ouranos-canvas" {...(compact
          ? { 'aria-hidden': true }
          : { role: 'img', 'aria-label': '3D model of the OURANOS watch from our CAD files. Drag to turn it, click to take it apart.' })} />
        <div ref={labels} className="ouranos-labels" aria-hidden="true" />
        {!ready && !compact && <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-2">Loading the watch model…</div>}
      </div>
      {ready && !compact && (
        <button type="button" className="ouranos-button" onClick={() => viewer.current?.setExploded(!exploded)}>
          {exploded ? 'Put it together' : 'Take it apart'}
        </button>
      )}
    </div>
  )
}
