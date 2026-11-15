/**
 * 3D device models for the monitoring-system cards.
 *
 * Every card shares ONE WebGL renderer: it draws each visible card's scene in turn and copies the
 * pixels into that card's own 2D canvas. So ten cards cost one WebGL context, not ten. The loop
 * runs only while a card is on screen, never under prefers-reduced-motion (one still frame
 * instead), and everything is disposed when the last card unmounts.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildDeviceModel, disposeModel, type ModelKind } from './deviceModels'

/** CSS size of every model view, in pixels. Matches .device-model in crew-systems.css. */
export const MODEL_SIZE = 148
/** Views beyond this count show the flat drawing instead, to bound the per-frame work. */
export const MAX_MODEL_VIEWS = 12
const TURN_RADIANS_PER_SECOND = 0.42
const STILL_ANGLE = -0.55

interface View {
  kind: ModelKind
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  angle: number
  visible: boolean
  onFail: () => void
}

interface Stage {
  scene: THREE.Scene
  model: THREE.Group
}

class SharedRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly views = new Set<View>()
  private readonly pmrem: THREE.PMREMGenerator
  private readonly env: THREE.WebGLRenderTarget
  private readonly camera = new THREE.PerspectiveCamera(27, 1, 0.1, 50)
  private readonly stages = new Map<ModelKind, Stage>()
  private readonly shadowTexture: THREE.CanvasTexture
  private readonly shadowMaterial: THREE.MeshBasicMaterial
  private readonly shadowGeometry = new THREE.PlaneGeometry(2.3, 1.4)
  private readonly observer: IntersectionObserver | null
  private readonly motion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  private frame: number | null = null
  private last = 0
  private pixels = 0
  failed = false

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.fit()
    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.env = this.pmrem.fromScene(new RoomEnvironment(), 0.04)
    this.camera.position.set(0, 1.25, 4.6)
    this.camera.lookAt(0, -0.05, 0)

    // A soft contact shadow under each model.
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(0,0,0,0.55)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
    this.shadowTexture = new THREE.CanvasTexture(c)
    this.shadowMaterial = new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false })

    this.observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const view = [...this.views].find((v) => v.canvas === entry.target)
            if (!view) continue
            view.visible = entry.isIntersecting
            if (view.visible) this.draw(view)
          }
          this.schedule()
        })
      : null
    this.renderer.domElement.addEventListener('webglcontextlost', this.lost)
    this.motion?.addEventListener?.('change', this.schedule)
  }

  private lost = (event: Event) => {
    event.preventDefault()
    this.failed = true
    this.stop()
    for (const view of this.views) view.onFail()
  }

  /** Size the shared canvas to one view at this screen's pixel ratio. */
  private fit() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const pixels = Math.round(MODEL_SIZE * ratio)
    if (pixels === this.pixels) return
    this.pixels = pixels
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(pixels, pixels, false)
    for (const view of this.views) view.canvas.width = view.canvas.height = pixels
  }

  private stage(kind: ModelKind): Stage {
    const existing = this.stages.get(kind)
    if (existing) return existing
    const scene = new THREE.Scene()
    scene.environment = this.env.texture
    scene.environmentIntensity = 0.7
    // Soft studio light: a warm-white key from the upper right, a cool rim from behind, a low fill.
    scene.add(new THREE.HemisphereLight(0xe4ecff, 0x141a24, 0.45))
    const light = (color: number, intensity: number, x: number, y: number, z: number) => {
      const l = new THREE.DirectionalLight(color, intensity)
      l.position.set(x, y, z)
      scene.add(l)
    }
    light(0xfff6ec, 2.3, 2.6, 3.2, 2.4)
    light(0x8fb4ff, 1.7, -3, 1.6, -2.8)
    light(0xa8c8ff, 0.45, -2.2, -1.2, 2.2)
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial)
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -0.98
    scene.add(shadow)
    const model = buildDeviceModel(kind)
    scene.add(model)
    const stage = { scene, model }
    this.stages.set(kind, stage)
    return stage
  }

  add(view: View) {
    this.views.add(view)
    view.canvas.width = view.canvas.height = this.pixels
    this.fit()
    if (this.observer) this.observer.observe(view.canvas)
    else view.visible = true
    this.draw(view)
    this.schedule()
  }

  remove(view: View) {
    this.views.delete(view)
    this.observer?.unobserve(view.canvas)
    this.schedule()
  }

  draw(view: View) {
    if (this.failed) return
    const { scene, model } = this.stage(view.kind)
    model.rotation.y = this.animating() ? view.angle : STILL_ANGLE
    this.renderer.render(scene, this.camera)
    view.ctx.clearRect(0, 0, view.canvas.width, view.canvas.height)
    view.ctx.drawImage(this.renderer.domElement, 0, 0, view.canvas.width, view.canvas.height)
  }

  private animating() {
    return !this.motion?.matches
  }

  private schedule = () => {
    const wanted = !this.failed && this.animating() && [...this.views].some((v) => v.visible)
    if (wanted && this.frame === null) {
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    } else if (!wanted) {
      this.stop()
      // Reduced motion: one still frame per visible view.
      for (const view of this.views) if (view.visible) this.draw(view)
    }
  }

  private tick = (time: number) => {
    this.frame = null
    const dt = Math.min(0.1, (time - this.last) / 1000)
    this.last = time
    this.fit()
    for (const view of this.views) {
      if (!view.visible) continue
      view.angle += dt * TURN_RADIANS_PER_SECOND
      this.draw(view)
    }
    this.schedule()
  }

  private stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  dispose() {
    this.stop()
    this.observer?.disconnect()
    this.motion?.removeEventListener?.('change', this.schedule)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.lost)
    for (const { model } of this.stages.values()) disposeModel(model)
    this.stages.clear()
    this.shadowGeometry.dispose()
    this.shadowMaterial.dispose()
    this.shadowTexture.dispose()
    this.env.dispose()
    this.pmrem.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

let shared: SharedRenderer | null = null

function acquire(): SharedRenderer {
  if (!shared || shared.failed) shared = new SharedRenderer()
  return shared
}

function release(view: View) {
  if (!shared) return
  shared.remove(view)
  if (shared.views.size === 0) {
    shared.dispose()
    shared = null
  }
}

/** One rotating device model. Lazily loaded by DeviceModel, which handles the fallbacks. */
export default function DeviceModel3D({ kind, onError }: { kind: ModelKind; onError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const failRef = useRef(onError)
  failRef.current = onError

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      failRef.current()
      return
    }
    if ((shared?.views.size ?? 0) >= MAX_MODEL_VIEWS) {
      failRef.current()
      return
    }
    let engine: SharedRenderer
    try {
      engine = acquire()
    } catch {
      failRef.current()
      return
    }
    const view: View = { kind, ctx, canvas, angle: Math.random() * Math.PI * 2, visible: false, onFail: () => failRef.current() }
    try {
      engine.add(view)
    } catch {
      release(view)
      failRef.current()
      return
    }
    return () => release(view)
  }, [kind])

  return <canvas ref={canvasRef} className="device-model-canvas" aria-hidden="true" />
}
