import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Region, RegionInfo } from '../lib/view'
import { KIND, REGION_NO, REGION_ORDER, STATE_TONE } from './Astronaut'
import { BADGE, TONE } from './ui'
import type { BodyMapProps } from './BodyMap'

/*
 * The crew member as NASA's Z2 spacesuit model (NASA 3D Resources, "free and without copyright"),
 * served locally from /models with its Draco decoder in /draco, so it works offline. The texture
 * was cleaned of grime and the agency insignia (scripts/notes in docs/CREDITS.md).
 * Body regions are tinted by height and width in the shader, since the model is one mesh. It
 * renders on demand only and never moves by itself. Every region also has an HTML button over the
 * canvas, so selection works by keyboard and the tests can find region-HEAD / CHEST / ARMS / LEGS.
 */

const MODEL_URL = '/models/z2-suit.glb'
const DRACO_PATH = '/draco/'
const STATE_HEX: Record<RegionInfo['state'], number | null> = { symptom: 0xe5484d, data: 0x0090ff, caution: 0xffc53d, neutral: null }
const SELECT_HEX = 0xededed

/** Where each region's marker is cast onto the suit, as fractions of the model's size. */
const PROBE: Record<Region, { x: number; y: number }> = {
  HEAD: { x: 0.14, y: 0.885 },
  CHEST: { x: 0.0, y: 0.725 },
  ARMS: { x: 0.37, y: 0.6 },
  LEGS: { x: -0.14, y: 0.27 },
}

interface Engine {
  render: () => void
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
  let mesh: THREE.Mesh | null = null
  let anchors: Record<Region, { p: THREE.Vector3; n: THREE.Vector2 }> | null = null

  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(target)
  controls.enableZoom = false
  controls.enablePan = false
  controls.enableDamping = false
  controls.rotateSpeed = 0.55
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
  controls.addEventListener('change', render)

  const draco = new DRACOLoader()
  draco.setDecoderPath(DRACO_PATH)
  draco.setDecoderConfig({ type: 'wasm' })
  const loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  loader.load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return
      const root = gltf.scene
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        mesh = m
        const mat = m.material as THREE.MeshStandardMaterial
        mat.onBeforeCompile = (shader) => {
          Object.assign(shader.uniforms, uniforms)
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;')
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
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      root.position.x -= center.x
      root.position.z -= center.z
      root.position.y -= box.min.y
      scene.add(root)
      root.updateMatrixWorld(true)
      modelHeight = size.y
      target.set(0, size.y * 0.5, 0)
      controls.target.copy(target)

      // Region bounds in the mesh's own coordinates (the shader reads the position attribute).
      if (mesh) {
        mesh.geometry.computeBoundingBox()
        const gb = mesh.geometry.boundingBox!
        const gh = gb.max.y - gb.min.y
        const gw = gb.max.x - gb.min.x
        const gcx = (gb.max.x + gb.min.x) / 2
        uniforms.uBounds.value.set(gb.min.y + gh * 0.817, gb.min.y + gh * 0.537, gw * 0.271, gcx)
      }

      // Cast each marker onto the suit's surface from the front.
      const ray = new THREE.Raycaster()
      const found = {} as Record<Region, { p: THREE.Vector3; n: THREE.Vector2 }>
      const wb = new THREE.Box3().setFromObject(root)
      const ws = wb.getSize(new THREE.Vector3())
      for (const r of REGION_ORDER) {
        const pr = PROBE[r]
        const origin = new THREE.Vector3(pr.x * ws.x * 1.0, wb.min.y + pr.y * ws.y, wb.max.z + 2)
        ray.set(origin, new THREE.Vector3(0, 0, -1))
        const hit = mesh ? ray.intersectObject(mesh, false)[0] : undefined
        if (hit) {
          const nrm = hit.face ? hit.face.normal.clone().transformDirection(mesh!.matrixWorld) : new THREE.Vector3(0, 0, 1)
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
    if (!mesh) return null
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera)
    const hit = raycaster.intersectObject(mesh, false)[0]
    if (!hit) return null
    const local = mesh.worldToLocal(hit.point.clone())
    const b = uniforms.uBounds.value
    return local.y > b.x ? 'HEAD' : local.y < b.y ? 'LEGS' : Math.abs(local.x - b.w) > b.z ? 'ARMS' : 'CHEST'
  }

  const resize = (nw: number, nh: number) => {
    if (nw < 2 || nh < 2) return
    renderer.setSize(nw, nh, false)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
    const a = Math.atan2(camera.position.x - target.x, camera.position.z - target.z)
    const d = fitDistance()
    camera.position.set(target.x + Math.sin(a) * d, target.y, target.z + Math.cos(a) * d)
    camera.lookAt(target)
    controls.update()
    render()
  }

  const dispose = () => {
    disposed = true
    controls.dispose()
    draco.dispose()
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

  return { render, resize, project, applyStates, pick, dispose, onChange: (fn) => void listeners.push(fn) }
}

/** The 3D body map. Loaded lazily by BodyMap, which falls back to the 2D drawing if WebGL fails. */
export default function Astronaut3D({ regions, selected, onSelect, label, size = 'hero', onError }: BodyMapProps & { onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const markerRefs = useRef<Partial<Record<Region, HTMLButtonElement | null>>>({})
  const latest = useRef({ selected, onSelect, regions })
  latest.current = { selected, onSelect, regions }
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
      const mid = wrap.clientWidth / 2
      for (const r of REGION_ORDER) {
        const el = markerRefs.current[r]
        if (!el) continue
        const p = pos[r]
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        el.style.opacity = p.facing ? '1' : '0.35'
        // labels sit outside the figure, but flip inward when they would run off the edge
        el.dataset.side = p.x >= mid ? (p.x + 200 > wrap.clientWidth ? 'left' : 'right') : p.x - 200 < 0 ? 'right' : 'left'
        const tag = el.querySelector<HTMLElement>('[data-chip]')
        if (tag) tag.style.visibility = p.facing ? 'visible' : 'hidden'
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
      if (r) latest.current.onSelect(latest.current.selected === r ? null : r)
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

  return (
    <div className="relative h-full w-full overflow-hidden select-none" role="group" aria-label={label}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full cursor-grab touch-pan-y" aria-hidden />
      </div>
      {!loaded && <div className="absolute inset-0 grid place-items-center text-[13px] text-ink-2">Loading the 3D model…</div>}
      {REGION_ORDER.map((r) => {
        const info = regions[r]
        const k = KIND[info.state]
        const marked = Boolean(k && info.callout)
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
            aria-label={`${REGION_NO[r]}, ${info.name}: ${info.callout ?? 'no evidence recorded'}`}
            onClick={() => onSelect(isSel ? null : r)}
            className="group absolute top-0 left-0 z-10 -mt-3 -ml-3 grid h-6 w-6 place-items-center transition-opacity duration-150"
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            <span
              className={`grid h-[18px] w-[18px] place-items-center rounded-[4px] border font-mono text-[10px] font-semibold ${isSel ? 'border-ink bg-ink text-void' : 'border-line-strong bg-panel text-ink group-hover:border-ink-2'}`}
            >
              {REGION_NO[r]}
            </span>
            {marked && size === 'hero' && (
              <span data-chip className="pointer-events-none absolute top-1/2 hidden -translate-y-1/2 items-center group-data-[side=left]:right-full group-data-[side=left]:flex-row-reverse group-data-[side=right]:left-full sm:flex">
                <span className="h-px w-6 bg-line-strong" />
                <span className="flex items-center gap-2 rounded-[6px] border border-line bg-panel py-1 pr-1 pl-2.5 text-[13px] font-medium whitespace-nowrap text-ink">
                  {info.name}
                  <span className={`${BADGE} ${TONE[STATE_TONE[info.state]].badge} h-[20px] text-[10px]`}>{k!.tag}</span>
                </span>
              </span>
            )}
          </button>
        )
      })}
      <p className="pointer-events-none absolute right-3 bottom-2 text-[12px] text-ink-3">Drag to rotate</p>
    </div>
  )
}
