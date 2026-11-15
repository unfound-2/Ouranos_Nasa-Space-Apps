import { Activity, Cpu, Gauge, HeartPulse, type LucideIcon } from 'lucide-react'
import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { SystemKind } from './systems'

// three.js lives in its own chunk, loaded only when a device card is shown.
const DeviceModel3D = lazy(() => import('./DeviceModel3D'))

let webgl: boolean | null = null
function hasWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
    webgl = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}

function forced2d(): boolean {
  try {
    return localStorage.getItem('gg.force2d') === '1'
  } catch {
    return false
  }
}

class Fallback extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const GLYPH: Record<Exclude<SystemKind, 'ouranos-watch'>, LucideIcon> = {
  'chest-strap': HeartPulse,
  'bp-cuff': Gauge,
  'suit-biomonitor': Cpu,
  generic: Activity,
}

/** A flat drawing when WebGL is off, failed, or too many models are on screen. */
export function DeviceGlyph({ kind }: { kind: Exclude<SystemKind, 'ouranos-watch'> }) {
  const Icon = GLYPH[kind]
  return (
    <div className="device-glyph" aria-hidden="true">
      <Icon size={46} strokeWidth={1.4} />
    </div>
  )
}

/**
 * The device picture on a monitoring-system card, always the same square size. The Ouranos watch
 * gets an empty slot for the CAD-based watch model; every other kind gets a procedural 3D model.
 */
export function DeviceModel({ kind, label }: { kind: SystemKind; label: string }) {
  const [failed, setFailed] = useState(false)
  if (kind === 'ouranos-watch') {
    // Slot for the CAD-based watch model. Keep the data-slot name: the watch model mounts here.
    return <div data-slot="ouranos-watch-3d" className="device-model device-model-watch" role="img" aria-label={label} />
  }
  return (
    <div className="device-model" role="img" aria-label={label}>
      {failed || forced2d() || !hasWebGL() ? (
        <DeviceGlyph kind={kind} />
      ) : (
        <Fallback onFail={() => setFailed(true)}>
          <Suspense fallback={<DeviceGlyph kind={kind} />}>
            <DeviceModel3D kind={kind} onError={() => setFailed(true)} />
          </Suspense>
        </Fallback>
      )}
    </div>
  )
}
