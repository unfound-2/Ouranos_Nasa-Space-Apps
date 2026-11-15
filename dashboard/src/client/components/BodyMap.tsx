import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import type { Region, RegionInfo } from '../lib/view'
import { Astronaut } from './Astronaut'

export interface BodyMapProps {
  regions: Record<Region, RegionInfo>
  selected: Region | null
  onSelect: (r: Region | null) => void
  label: string
  /** 'hero': the large figure on the Overview. 'compact': inside a narrower card. */
  size?: 'hero' | 'compact'
  /** When set, the 3D figure flies the camera to this region and moves its parts apart (null = whole suit). */
  focus?: Region | null
}

// three.js lives in its own chunk, loaded only when a body map is shown.
const Astronaut3D = lazy(() => import('./Astronaut3D'))

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

/** If the 3D chunk fails to load or throws while rendering, fall back to the drawing. */
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

const BOX: Record<NonNullable<BodyMapProps['size']>, string> = {
  hero: 'h-[440px] sm:h-[540px] xl:h-[600px]',
  compact: 'h-[380px]',
}

/**
 * The crew member's body evidence map. Every caller renders this, never a figure directly.
 * It shows the 3D model when WebGL works and the 2D drawing otherwise (or when localStorage
 * gg.force2d is "1"). Both render one control per region with data-testid="region-<REGION>",
 * data-state, aria-pressed and role="button", and select through onSelect.
 */
export function BodyMap({ regions, selected, onSelect, label, size = 'hero', focus }: BodyMapProps) {
  const [failed, setFailed] = useState(false)
  if (failed || forced2d() || !hasWebGL())
    return (
      <div className={`flex w-full justify-center ${BOX[size]}`}>
        <div className="aspect-[324/578] h-full max-w-full">
          <Astronaut regions={regions} selected={selected} onSelect={onSelect} label={label} />
        </div>
      </div>
    )
  return (
    <div className={`relative w-full ${BOX[size]}`}>
      <Fallback onFail={() => setFailed(true)}>
        <Suspense fallback={<div className="grid h-full place-items-center text-[12px] text-ink-3">Loading the 3D model…</div>}>
          <Astronaut3D regions={regions} selected={selected} onSelect={onSelect} label={label} size={size} focus={focus} onError={() => setFailed(true)} />
        </Suspense>
      </Fallback>
    </div>
  )
}
