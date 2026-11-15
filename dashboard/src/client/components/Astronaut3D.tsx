import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Region, RegionInfo } from '../lib/view'
import { REGION_NO, REGION_ORDER } from './Astronaut'
import type { BodyMapProps } from './BodyMap'
import './astronaut3d.css'

// The same updated Jungle Jim model used on the welcome page.
const MODEL_URL = '/astronaut/astronaut.glb'
const STATE_HEX: Record<RegionInfo['state'], number | null> = { symptom: 0xe5484d, data: 0x0090ff, caution: 0xffc53d, neutral: null }
const SELECT_HEX = 0xededed

/** Where each region's marker is cast onto the suit, as fractions of the model's size. */
const PROBE: Record<Region, { x: number; y: number }> = {
  HEAD: { x: 0.14, y: 0.885 },
  CHEST: { x: 0.0, y: 0.725 },
  ARMS: { x: 0.37, y: 0.6 },
  LEGS: { x: -0.14, y: 0.27 },
}

/** Camera framing for a focused region: height and side offset as fractions of the model, zoom as a
 * fraction of the full-body distance, and how far the view turns so moving parts read clearly. */
const FOCUS: Record<Region, { y: number; side: number; zoom: number; turn: number; back?: number }> = {
  HEAD: { y: 0.855, side: 0, zoom: 0.5, turn: 0.55 },
  CHEST: { y: 0.64, side: 0, zoom: 0.86, turn: 1.0, back: -0.13 },
  ARMS: { y: 0.52, side: 0.3, zoom: 0.46, turn: 0.42 },
  LEGS: { y: 0.27, side: 0, zoom: 0.6, turn: 0.25 },
}

interface Engine {
  render: () => void
  focus: (region: Region | null) => void
  resize: (w: number, h: number) => void
  project: () => Record<Region, { x: number; y: number; facing: boolean }> | null
  applyStates: (regions: Record<Region, RegionInfo>, selected: Region | null) => void
  pick: (clientX: number, clientY: number) => Region | null
  dispose: () => void
  onChange: (fn: () => void) => void
}

function createEngine(canvas: HTMLCanvasElement, w: number, h: number, onLoaded: () => void, onFail: () => void): Engine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.45

  const camera = new THREE.PerspectiveCamera(24, w / h, 0.05, 50)
  const target = new THREE.Vector3(0, 0.95, 0)
  let modelHeight = 1.94
  const fitDistance = () => {
    const vFov = THREE.MathUtils.degToRad(camera.fov)
    const dH = (modelHeight * 1.12) / 2 / Math.tan(vFov / 2)
    const dW = 1.0 / 2 / (Math.tan(vFov / 2) * camera.aspect)
    return Math.max(dH, dW)
  }
  camera.position.set(0, target.y, fitDistance())

  // Lights travel with the camera: the sun as a white key from the upper right, a faint blue
  // earthshine from below, and the sunrise behind the figure as cool rim light.
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2230, 0.35))
  scene.add(camera)
  const aim = new THREE.Object3D()
  aim.position.set(0, 0, -5)
  camera.add(aim)
  const rig = (color: number, intensity: number, x: number, y: number, z: number) => {
    const l = new THREE.DirectionalLight(color, intensity)
    l.position.set(x, y, z)
    l.target = aim
    camera.add(l)
  }
  rig(0xffffff, 2.4, 2.2, 2.6, 0.8)
  rig(0x8fb4ff, 0.55, -2.4, -1.6, 0.4)
  rig(0xa8c8ff, 2.6, -2.6, 1.8, -9.5)
  rig(0xa8c8ff, 1.8, 2.8, 0.8, -9)

  // A soft contact shadow, so the figure stands rather than floats.
  const shadowCanvas = document.createElement('canvas')
  shadowCanvas.width = shadowCanvas.height = 128
  const g = shadowCanvas.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(0,0,0,0.7)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const shadowTex = new THREE.CanvasTexture(shadowCanvas)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  scene.add(shadow)

  // Region tint: one uniform set per region, chosen in the shader by position in the model.
  const uniforms = {
    uTint: { value: REGION_ORDER.map(() => new THREE.Color(0x000000)) },
    uAmt: { value: REGION_ORDER.map(() => 0) },
    uBounds: { value: new THREE.Vector4(1.58, 1.04, 0.215, 0) },
  }
  const meshes: THREE.Mesh[] = []
  let anchors: Record<Region, { p: THREE.Vector3; n: THREE.Vector2 }> | null = null
  /** Parts that move apart when their region is in focus: offsets are in world units. */
  const movable: { mesh: THREE.Mesh; region: Region; world: THREE.Vector3; offset: THREE.Vector3 }[] = []
  const apart: Record<Region, number> = { HEAD: 0, CHEST: 0, ARMS: 0, LEGS: 0 }
  let focused: Region | null = null
  let modelWidth = 1

  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(target)
  controls.enableZoom = false
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.22
  controls.rotateSpeed = 0.27
  controls.update()
  const polar = controls.getPolarAngle()
  controls.minPolarAngle = polar
  controls.maxPolarAngle = polar

  const listeners: (() => void)[] = []
  let disposed = false
  const render = () => {
    if (disposed) return
    renderer.render(scene, camera)
    for (const fn of listeners) fn()
  }
  let motionFrame: number | null = null
  function renderMotion() {
    render()
    if (motionFrame !== null) return
    motionFrame = requestAnimationFrame(() => {
      motionFrame = null
      controls.update()
    })
  }
  controls.addEventListener('change', renderMotion)

  const loader = new GLTFLoader()
  loader.load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return
      const root = gltf.scene
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        meshes.push(m)
        const mat = m.material as THREE.MeshStandardMaterial
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms)
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = (modelMatrix * vec4(transformed, 1.0)).xyz;')
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
varying vec3 vObj;
uniform vec3 uTint[4];
uniform float uAmt[4];
uniform vec4 uBounds;`,
            )
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
{
  int r = vObj.y > uBounds.x ? 0 : (vObj.y < uBounds.y ? 3 : (abs(vObj.x - uBounds.w) > uBounds.z ? 2 : 1));
  vec3 tint = r == 0 ? uTint[0] : (r == 1 ? uTint[1] : (r == 2 ? uTint[2] : uTint[3]));
  float amt = r == 0 ? uAmt[0] : (r == 1 ? uAmt[1] : (r == 2 ? uAmt[2] : uAmt[3]));
  float fres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
  totalEmissiveRadiance += tint * amt * (0.18 + 1.9 * fres);
}`,
            )
        }
        mat.needsUpdate = true
      })
      // Stand the model on the ground at the origin and frame it.
      const box = new THREE.Box3().setFromObject(root)
      root.scale.multiplyScalar(1.94 / box.getSize(new THREE.Vector3()).y)
      box.setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      root.position.x -= center.x
      root.position.z -= center.z
      root.position.y -= box.min.y
      scene.add(root)
      root.updateMatrixWorld(true)
      modelHeight = size.y
      modelWidth = size.x
      target.set(0, size.y * 0.5, 0)
      controls.target.copy(target)

      // The life-support pack is its own group behind the body; the visor and helmet lamps have
      // their own materials. Found by position and material, since loaders rename nodes.
      for (const m of meshes) {
        const b = new THREE.Box3().setFromObject(m)
        const matName = (Array.isArray(m.material) ? m.material[0] : m.material).name
        let region: Region | null = null
        let offset: THREE.Vector3 | null = null
        if (b.max.z < -0.02 * size.y && b.min.y > size.y * 0.45) {
          region = 'CHEST'
          offset = new THREE.Vector3(0, 0.05, -0.42).multiplyScalar(size.y / 1.94)
        } else if (/visor|helmet.?lamps/i.test(matName)) {
          region = 'HEAD'
          offset = new THREE.Vector3(0, 0.055, 0.09).multiplyScalar(size.y / 1.94)
        }
        if (region && offset) movable.push({ mesh: m, region, world: m.getWorldPosition(new THREE.Vector3()), offset })
      }

      uniforms.uBounds.value.set(size.y * 0.81, size.y * 0.5, size.x * 0.25, 0)

      // Cast each marker onto the suit's surface from the front.
      const ray = new THREE.Raycaster()
      const found = {} as Record<Region, { p: THREE.Vector3; n: THREE.Vector2 }>
      const wb = new THREE.Box3().setFromObject(root)
      const ws = wb.getSize(new THREE.Vector3())
      for (const r of REGION_ORDER) {
        const pr = PROBE[r]
        const origin = new THREE.Vector3(pr.x * ws.x * 1.0, wb.min.y + pr.y * ws.y, wb.max.z + 2)
        ray.set(origin, new THREE.Vector3(0, 0, -1))
        const hit = ray.intersectObjects(meshes, false)[0]
        if (hit) {
          const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 0, 1)
          found[r] = { p: hit.point.clone(), n: new THREE.Vector2(nrm.x, nrm.z).normalize() }
        } else {
          found[r] = { p: new THREE.Vector3(origin.x, origin.y, wb.max.z * 0.6), n: new THREE.Vector2(0, 1) }
        }
      }
      anchors = found
      resize(canvas.clientWidth || w, canvas.clientHeight || h)
      onLoaded()
    },
    undefined,
    () => {
      if (!disposed) onFail()
    },
  )

  const projectV = new THREE.Vector3()
  const project = () => {
    if (!anchors) return null
    const size = renderer.getSize(new THREE.Vector2())
    const dir = new THREE.Vector2(camera.position.x - target.x, camera.position.z - target.z).normalize()
    const out = {} as Record<Region, { x: number; y: number; facing: boolean }>
    for (const r of REGION_ORDER) {
      projectV.copy(anchors[r].p).project(camera)
      out[r] = { x: ((projectV.x + 1) / 2) * size.x, y: ((1 - projectV.y) / 2) * size.y, facing: anchors[r].n.dot(dir) > -0.1 }
    }
    return out
  }

  const applyStates = (info: Record<Region, RegionInfo>, selected: Region | null) => {
    REGION_ORDER.forEach((r, i) => {
      const hex = STATE_HEX[info[r].state]
      const isSel = selected === r
      // A reported symptom always glows; measured and caution regions glow only when selected.
      const color = isSel ? (hex ?? SELECT_HEX) : info[r].state === 'symptom' ? hex : null
      uniforms.uTint.value[i].setHex(color ?? 0x000000)
      uniforms.uAmt.value[i] = color === null ? 0 : isSel ? 0.55 : 0.4
    })
    render()
  }

  const raycaster = new THREE.Raycaster()
  const pick = (clientX: number, clientY: number): Region | null => {
    if (!meshes.length) return null
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera)
    const hit = raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return null
    const local = hit.point
    const b = uniforms.uBounds.value
    return local.y > b.x ? 'HEAD' : local.y < b.y ? 'LEGS' : Math.abs(local.x - b.w) > b.z ? 'ARMS' : 'CHEST'
  }

  // Focus: fly the camera to a region and move that region's parts apart.
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const ease = (x: number) => x * x * (3 - 2 * x)
  let flight: { start: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number; fromA: number; toA: number } | null = null
  let flightFrame: number | null = null
  const placeParts = () => {
    for (const p of movable) {
      const w = p.world.clone().addScaledVector(p.offset, ease(apart[p.region]))
      p.mesh.position.copy(p.mesh.parent!.worldToLocal(w))
    }
  }
  const step = (now: number) => {
    flightFrame = null
    if (disposed) return
    let busy = false
    for (const r of REGION_ORDER) {
      const goal = focused === r ? 1 : 0
      if (apart[r] === goal) continue
      apart[r] = reducedMotion ? goal : apart[r] + Math.sign(goal - apart[r]) * Math.min(Math.abs(goal - apart[r]), 1 / 48)
      busy = true
    }
    if (busy) placeParts()
    if (flight) {
      const k = reducedMotion ? 1 : Math.min(1, (now - flight.start) / 1100)
      const e = ease(k)
      target.lerpVectors(flight.fromT, flight.toT, e)
      const d = flight.fromD + (flight.toD - flight.fromD) * e
      const a = flight.fromA + (flight.toA - flight.fromA) * e
      controls.target.copy(target)
      camera.position.set(target.x + Math.sin(a) * d, target.y, target.z + Math.cos(a) * d)
      camera.lookAt(target)
      if (k >= 1) flight = null
      busy = true
    }
    controls.update()
    render()
    if (busy) flightFrame = requestAnimationFrame(step)
  }
  const focusView = (region: Region | null) => {
    const full = fitDistance()
    if (!region) return { t: new THREE.Vector3(0, modelHeight * 0.5, 0), d: full, a: 0 }
    const f = FOCUS[region]
    const side = anchors ? Math.sign(anchors.ARMS.p.x) || 1 : 1
    const t = new THREE.Vector3(region === 'ARMS' && anchors ? anchors.ARMS.p.x * 0.9 : f.side * modelWidth * side, f.y * modelHeight, (f.back ?? 0) * modelHeight)
    return { t, d: full * f.zoom, a: f.turn * side }
  }
  const focus = (region: Region | null) => {
    if (region === focused && !flight) return
    focused = region
    const to = focusView(region)
    let fromA = Math.atan2(camera.position.x - target.x, camera.position.z - target.z)
    while (fromA - to.a > Math.PI) fromA -= 2 * Math.PI
    while (to.a - fromA > Math.PI) fromA += 2 * Math.PI
    flight = { start: performance.now(), fromT: target.clone(), toT: to.t, fromD: camera.position.distanceTo(target), toD: to.d, fromA, toA: to.a }
    if (flightFrame === null) flightFrame = requestAnimationFrame(step)
  }

  const resize = (nw: number, nh: number) => {
    if (nw < 2 || nh < 2) return
    renderer.setSize(nw, nh, false)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
    const a = Math.atan2(camera.position.x - target.x, camera.position.z - target.z)
    const d = focused ? focusView(focused).d : fitDistance()
    camera.position.set(target.x + Math.sin(a) * d, target.y, target.z + Math.cos(a) * d)
    camera.lookAt(target)
    controls.update()
    render()
  }

  const dispose = () => {
    disposed = true
    if (motionFrame !== null) cancelAnimationFrame(motionFrame)
    if (flightFrame !== null) cancelAnimationFrame(flightFrame)
    controls.dispose()
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        for (const x of Array.isArray(mat) ? mat : [mat]) {
          for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose()
          x.dispose()
        }
      }
    })
    shadowTex.dispose()
    envRT.dispose()
    pmrem.dispose()
    renderer.dispose()
    listeners.length = 0
  }

  return { render, focus, resize, project, applyStates, pick, dispose, onChange: (fn) => void listeners.push(fn) }
}

/** The 3D body map. Loaded lazily by BodyMap, which falls back to the 2D drawing if WebGL fails. */
export default function Astronaut3D({ regions, selected, onSelect, label, size = 'hero', focus, onError }: BodyMapProps & { onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const markerRefs = useRef<Partial<Record<Region, HTMLButtonElement | null>>>({})
  const latest = useRef({ selected, onSelect, regions, focus })
  latest.current = { selected, onSelect, regions, focus }
  const [loaded, setLoaded] = useState(false)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let engine: Engine
    try {
      engine = createEngine(
        canvas,
        Math.max(2, wrap.clientWidth),
        Math.max(2, wrap.clientHeight),
        () => {
          setLoaded(true)
          engine.applyStates(latest.current.regions, latest.current.selected)
          engine.focus(latest.current.focus ?? null)
        },
        onError,
      )
    } catch {
      onError()
      return
    }
    engineRef.current = engine
    const place = () => {
      const pos = engine.project()
      if (!pos) return
      for (const r of REGION_ORDER) {
        const el = markerRefs.current[r]
        if (!el) continue
        const p = pos[r]
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        el.style.opacity = p.facing ? '1' : '0.35'

      }
    }
    engine.onChange(place)
    const ro = new ResizeObserver(() => engine.resize(wrap.clientWidth, wrap.clientHeight))
    ro.observe(wrap)
    engine.render()

    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
      canvas.style.cursor = 'grabbing'
    }
    const onUp = (e: PointerEvent) => {
      canvas.style.cursor = 'grab'
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      down = null
      const r = engine.pick(e.clientX, e.clientY)
      if (r) {
        const { selected: sel, focus: foc } = latest.current
        latest.current.onSelect(sel === r && (foc === undefined || foc === r) ? null : r)
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    const onLost = (e: Event) => {
      e.preventDefault()
      onError()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    return () => {
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('webglcontextlost', onLost)
      engine.dispose()
      engineRef.current = null
    }
    // onError is stable for the lifetime of this mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stateKey = REGION_ORDER.map((r) => regions[r].state).join(',')
  useEffect(() => {
    engineRef.current?.applyStates(regions, selected)
    // regions only matter through their states
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, selected])

  useEffect(() => {
    if (loaded) engineRef.current?.focus(focus ?? null)
  }, [focus, loaded])

  return (
    <div className="relative h-full w-full overflow-hidden select-none" role="group" aria-label={label}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full cursor-grab touch-pan-y" aria-hidden />
      </div>
      {!loaded && <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-2">Loading the 3D model…</div>}
      {loaded && focus && (
        <button type="button" className="astro-whole" onClick={() => onSelect(null)}>
          Whole suit
        </button>
      )}
      {REGION_ORDER.map((r) => {
        const info = regions[r]
        const isSel = selected === r
        return (
          <button
            key={r}
            ref={(el) => {
              markerRefs.current[r] = el
            }}
            type="button"
            data-testid={`region-${r}`}
            data-state={info.state}
            data-selected={isSel}
            aria-pressed={isSel}
            aria-label={`${info.name}: ${info.callout ?? 'no evidence recorded'}`}
            onClick={() => onSelect(isSel && (focus === undefined || focus === r) ? null : r)}
            className={size === 'hero'
              ? `astro-hotspot group absolute top-0 left-0 z-10 transition-opacity duration-150 ${focus && focus !== r ? 'is-dim' : ''}`
              : 'group absolute top-0 left-0 z-10 -mt-3 -ml-3 grid h-6 w-6 place-items-center transition-opacity duration-150'}
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            {size === 'hero' ? (
              <>
                <span aria-hidden="true" className={`astro-ring astro-${info.state} ${isSel ? 'is-selected' : ''}`} />
                <span aria-hidden="true" className="astro-name">{info.name}</span>
              </>
            ) : (
              <span
                className={`grid h-[18px] w-[18px] place-items-center rounded-[4px] border font-mono text-[10px] font-semibold ${isSel ? 'border-ink bg-ink text-void' : 'border-line-strong bg-panel text-ink group-hover:border-ink-2'}`}
              >
                {REGION_NO[r]}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
