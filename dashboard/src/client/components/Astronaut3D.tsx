import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Region, RegionInfo } from '../lib/view'
import { KIND, REGION_NO, REGION_ORDER } from './Astronaut'
import type { BodyMapProps } from './BodyMap'

/*
 * The crew member as a real-time 3D model, built from primitives (no downloaded asset, nothing
 * fetched): a white EVA suit with red bands, grey knee pads and harness, the chest control box and
 * hoses, a glossy visor, the backpack, and the watch on the crew member's LEFT wrist.
 * It renders on demand only (drag, resize, view or selection change), never in a loop, and it
 * never moves by itself. Every region also has an HTML button over the canvas, so selection works
 * by keyboard and the tests can find region-HEAD / CHEST / ARMS / LEGS.
 */

const STATE_HEX: Record<RegionInfo['state'], number | null> = { symptom: 0xff6170, data: 0x7cc8ff, caution: 0xe6b56c, neutral: null }
const ICE = 0x7cc8ff

/** Where each region's hotspot sits on the model, and which way that spot faces (x, z). */
const ANCHOR: Record<Region, { p: [number, number, number]; n: [number, number] }> = {
  HEAD: { p: [0.118, 1.672, 0.118], n: [0.75, 0.66] },
  CHEST: { p: [0, 1.222, 0.205], n: [0, 1] },
  ARMS: { p: [0.418, 0.822, 0.05], n: [0.9, 0.45] },
  LEGS: { p: [-0.108, 0.522, 0.11], n: [0, 1] },
}

const TARGET = new THREE.Vector3(0, 0.93, 0)

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A fine fabric grain for the suit, as a bump map. */
function fabricTexture() {
  const t = canvasTexture(256, (g, s) => {
    const img = g.createImageData(s, s)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < s * s; i++) {
      const y = Math.floor(i / s)
      const weave = 128 + 18 * Math.sin(y * 0.9) + (rnd() - 0.5) * 70
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = weave
      img.data[i * 4 + 3] = 255
    }
    g.putImageData(img, 0, 0)
  })
  t.colorSpace = THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(5, 5)
  return t
}

/** The neutral GRAVITYGUARD mission patch: an orbit around a heartbeat trace. No agency insignia. */
function patchTexture() {
  return canvasTexture(256, (g, s) => {
    const c = s / 2
    g.fillStyle = '#0d1b33'
    g.beginPath()
    g.arc(c, c, c - 4, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 10
    g.strokeStyle = '#d9dde3'
    g.stroke()
    g.lineWidth = 5
    g.strokeStyle = '#7cc8ff'
    g.beginPath()
    g.ellipse(c, c, c - 34, (c - 34) * 0.38, -0.42, 0, Math.PI * 2)
    g.stroke()
    g.lineWidth = 9
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#ffffff'
    g.beginPath()
    g.moveTo(52, 136)
    g.lineTo(92, 136)
    g.lineTo(108, 96)
    g.lineTo(136, 168)
    g.lineTo(156, 116)
    g.lineTo(168, 136)
    g.lineTo(206, 136)
    g.stroke()
  })
}

function radialTexture(stops: [number, string][]) {
  return canvasTexture(256, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    for (const [o, c] of stops) gr.addColorStop(o, c)
    g.fillStyle = gr
    g.fillRect(0, 0, s, s)
  })
}

interface RegionParts {
  group: THREE.Group
  /** Materials that take the region's tint. */
  tintable: THREE.MeshStandardMaterial[]
  /** Glow shells around the large parts, shown for a reported symptom or the selected region. */
  shells: THREE.Mesh[]
  shellMaterial: THREE.MeshBasicMaterial
  pickable: THREE.Mesh[]
}

function buildSuit(fabric: THREE.Texture, patch: THREE.Texture) {
  const root = new THREE.Group()
  const regions = {} as Record<Region, RegionParts>

  for (const r of REGION_ORDER) {
    const shellMaterial = new THREE.MeshBasicMaterial({ color: ICE, side: THREE.BackSide, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    regions[r] = { group: new THREE.Group(), tintable: [], shells: [], shellMaterial, pickable: [] }
    regions[r].group.name = r
    root.add(regions[r].group)
  }

  const mats = (r: Region) => {
    const suit = new THREE.MeshStandardMaterial({ color: 0xe9e8e4, roughness: 0.86, metalness: 0, bumpMap: fabric, bumpScale: 0.35 })
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xf1f1ee, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3 })
    const soft = new THREE.MeshStandardMaterial({ color: 0xd7d8d9, roughness: 0.8, bumpMap: fabric, bumpScale: 0.25 })
    const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.72 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.62 })
    const red = new THREE.MeshStandardMaterial({ color: 0xc23a40, roughness: 0.62 })
    regions[r].tintable.push(suit, shell, soft, grey, red)
    return { suit, shell, soft, grey, dark, red }
  }

  const add = (r: Region, mesh: THREE.Mesh, opts: { shell?: boolean; pick?: boolean } = {}) => {
    mesh.userData.region = r
    regions[r].group.add(mesh)
    if (opts.pick !== false) regions[r].pickable.push(mesh)
    if (opts.shell) {
      const s = new THREE.Mesh(mesh.geometry, regions[r].shellMaterial)
      s.scale.setScalar(1.06)
      s.renderOrder = -1
      s.visible = false
      mesh.add(s)
      regions[r].shells.push(s)
    }
    return mesh
  }
  const place = (m: THREE.Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    return m
  }
  const capsule = (r: number, len: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 10, 28), m)
  const sphere = (r: number, m: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), m)
  const rbox = (w: number, h: number, d: number, rad: number, m: THREE.Material) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, rad), m)
  const band = (r: number, h: number, m: THREE.Material) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 40, 1, true), m)
  const torus = (R: number, t: number, m: THREE.Material) => new THREE.Mesh(new THREE.TorusGeometry(R, t, 14, 48), m)

  // ---- legs: hips, thighs with red bands and cargo pockets, knee pads, shins, boots
  {
    const m = mats('LEGS')
    add('LEGS', place(rbox(0.34, 0.17, 0.235, 0.07, m.suit), 0, 0.93, 0), { shell: true })
    for (const s of [-1, 1]) {
      const x = s * 0.106
      add('LEGS', place(capsule(0.087, 0.26, m.suit), s * 0.11, 0.765, 0), { shell: true })
      add('LEGS', place(band(0.0905, 0.034, m.red), s * 0.11, 0.69, 0))
      add('LEGS', place(rbox(0.04, 0.12, 0.09, 0.016, m.soft), s * 0.192, 0.75, 0.005, 0, 0, s * 0.05))
      add('LEGS', place(rbox(0.1, 0.118, 0.042, 0.018, m.grey), x, 0.522, 0.052, -0.08))
      add('LEGS', place(capsule(0.068, 0.29, m.suit), x, 0.335, 0), { shell: true })
      add('LEGS', place(band(0.071, 0.03, m.grey), x, 0.165, 0))
      add('LEGS', place(rbox(0.128, 0.14, 0.255, 0.045, m.suit), x, 0.082, 0.028), { shell: true })
      add('LEGS', place(rbox(0.134, 0.036, 0.266, 0.014, m.dark), x, 0.018, 0.03))
    }
  }

  // ---- chest: torso, belt, chest box with hoses, harness, patch, backpack
  {
    const m = mats('CHEST')
    const torso = add('CHEST', place(capsule(0.19, 0.25, m.suit), 0, 1.225, 0), { shell: true })
    torso.scale.set(1.13, 1, 0.75)
    add('CHEST', place(rbox(0.405, 0.048, 0.285, 0.02, m.grey), 0, 1.012, 0))
    add('CHEST', place(rbox(0.065, 0.044, 0.02, 0.007, m.dark), 0, 1.012, 0.146))
    // chest control box
    add('CHEST', place(rbox(0.205, 0.115, 0.075, 0.016, m.shell), 0, 1.222, 0.168), { shell: true })
    add('CHEST', place(rbox(0.055, 0.036, 0.012, 0.005, m.dark), -0.052, 1.232, 0.207))
    add('CHEST', place(rbox(0.07, 0.022, 0.012, 0.005, m.grey), 0.045, 1.245, 0.207))
    for (const x of [0.03, 0.06]) add('CHEST', place(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16), m.grey), x, 1.205, 0.208, Math.PI / 2))
    // hoses looping from under the chest box to the sides
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.07, 1.17, 0.19),
        new THREE.Vector3(s * 0.12, 1.085, 0.215),
        new THREE.Vector3(s * 0.185, 1.055, 0.17),
        new THREE.Vector3(s * 0.205, 1.11, 0.1),
      ])
      add('CHEST', new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.019, 12, false), m.soft))
      for (let i = 1; i < 6; i++) {
        const p = curve.getPoint(i / 6)
        add('CHEST', place(torus(0.02, 0.0035, m.grey), p.x, p.y, p.z, Math.PI / 2 + 0.3, 0, s * 0.6), { pick: false })
      }
    }
    // harness straps and shoulder straps
    for (const s of [-1, 1]) {
      add('CHEST', place(rbox(0.042, 0.4, 0.016, 0.006, m.grey), s * 0.118, 1.24, 0.147, 0, 0, s * 0.05))
      add('CHEST', place(rbox(0.046, 0.022, 0.3, 0.008, m.grey), s * 0.128, 1.44, 0.0, 0.0, 0, s * 0.12))
    }
    // the mission patch on a small plate above the chest box
    add('CHEST', place(rbox(0.12, 0.085, 0.02, 0.008, m.suit), 0, 1.355, 0.142))
    const patchMesh = new THREE.Mesh(new THREE.CircleGeometry(0.034, 48), new THREE.MeshStandardMaterial({ map: patch, roughness: 0.7 }))
    add('CHEST', place(patchMesh, 0, 1.355, 0.1535), { pick: true })
    // backpack (PLSS) with panels and a vent grille
    add('CHEST', place(rbox(0.41, 0.53, 0.16, 0.03, m.shell), 0, 1.215, -0.22), { shell: true })
    add('CHEST', place(rbox(0.3, 0.2, 0.014, 0.006, m.soft), 0, 1.33, -0.302))
    add('CHEST', place(rbox(0.13, 0.05, 0.014, 0.006, m.grey), 0, 1.45, -0.302))
    for (let i = 0; i < 6; i++) add('CHEST', place(rbox(0.12, 0.007, 0.012, 0.003, m.dark), 0, 1.03 + i * 0.019, -0.302))
    for (const s of [-1, 1]) {
      add('CHEST', place(rbox(0.05, 0.32, 0.1, 0.014, m.grey), s * 0.228, 1.2, -0.215))
      add('CHEST', place(rbox(0.03, 0.03, 0.012, 0.005, m.dark), s * 0.12, 1.15, -0.302))
    }
  }

  // ---- arms: shoulders, upper arms with red bands, elbows, forearms, wrist rings, gloves, the watch
  {
    const m = mats('ARMS')
    for (const s of [-1, 1]) {
      add('ARMS', place(sphere(0.096, m.suit), s * 0.255, 1.39, 0), { shell: true })
      add('ARMS', place(capsule(0.069, 0.2, m.suit), s * 0.3, 1.222, 0, 0, 0, s * 0.16), { shell: true })
      add('ARMS', place(band(0.0725, 0.034, m.red), s * 0.296, 1.25, 0, 0, 0, s * 0.16))
      add('ARMS', place(sphere(0.064, m.suit), s * 0.334, 1.07, 0.004), { shell: true })
      add('ARMS', place(capsule(0.061, 0.165, m.suit), s * 0.355, 0.94, 0.012, 0, 0, s * 0.1), { shell: true })
      add('ARMS', place(torus(0.058, 0.0125, m.grey), s * 0.372, 0.812, 0.014, Math.PI / 2, 0, s * 0.1))
      const glove = add('ARMS', place(sphere(0.056, m.soft), s * 0.381, 0.735, 0.018), { shell: true })
      glove.scale.set(0.82, 1.32, 0.98)
      add('ARMS', place(rbox(0.066, 0.05, 0.05, 0.016, m.grey), s * 0.387, 0.672, 0.02))
      add('ARMS', place(capsule(0.016, 0.035, m.soft), s * 0.352, 0.708, 0.055, 0.4, 0, -s * 0.35))
    }
    // the watch on the crew member's left wrist (viewer's right in the front view)
    const watch = new THREE.Group()
    watch.position.set(0.411, 0.823, 0.034)
    watch.rotation.set(0, 1.0, -0.1)
    const caseMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.35, metalness: 0.5 })
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.058, 0.02, 4, 0.01), caseMat)
    body.userData.region = 'ARMS'
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.043), new THREE.MeshStandardMaterial({ color: 0x08121c, emissive: ICE, emissiveIntensity: 0.55, roughness: 0.2 }))
    screen.position.z = 0.0105
    screen.userData.region = 'ARMS'
    watch.add(body, screen)
    regions.ARMS.group.add(watch)
    regions.ARMS.pickable.push(body, screen)
  }

  // ---- head: neck ring, helmet shell, glossy visor, side lights
  {
    const m = mats('HEAD')
    add('HEAD', place(torus(0.117, 0.024, m.grey), 0, 1.5, 0, Math.PI / 2))
    add('HEAD', place(sphere(0.166, m.shell), 0, 1.66, -0.004), { shell: true })
    const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x030406, metalness: 0.85, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 })
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1695, 64, 40, Math.PI / 2 - 1.0, 2.0, 0.6, 1.12), visorMat)
    add('HEAD', place(visor, 0, 1.66, -0.004))
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 1.6 })
    for (const s of [-1, 1]) {
      add('HEAD', place(rbox(0.036, 0.062, 0.075, 0.012, m.grey), s * 0.168, 1.667, 0.006))
      add('HEAD', place(new THREE.Mesh(new THREE.CircleGeometry(0.0125, 24), lensMat), s * 0.168, 1.682, 0.0445))
      add('HEAD', place(new THREE.Mesh(new THREE.CircleGeometry(0.0125, 24), lensMat), s * 0.168, 1.652, 0.0445))
    }
  }

  return { root, regions }
}

interface Engine {
  render: () => void
  resize: (w: number, h: number) => void
  project: () => Record<Region, { x: number; y: number; facing: boolean }>
  setView: (view: 'front' | 'back', animate: boolean) => void
  applyStates: (regions: Record<Region, RegionInfo>, selected: Region | null) => void
  pick: (clientX: number, clientY: number) => Region | null
  azimuth: () => number
  dispose: () => void
  onChange: (fn: () => void) => void
}

function createEngine(canvas: HTMLCanvasElement, w: number, h: number): Engine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.02
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = envRT.texture
  scene.environmentIntensity = 0.5

  const camera = new THREE.PerspectiveCamera(26, w / h, 0.1, 50)
  const fitDistance = () => {
    const vFov = THREE.MathUtils.degToRad(camera.fov)
    const needH = 2.08
    const needW = 1.15
    const dH = needH / 2 / Math.tan(vFov / 2)
    const dW = needW / 2 / (Math.tan(vFov / 2) * camera.aspect)
    return Math.max(dH, dW)
  }
  camera.position.set(0, TARGET.y + 0.06, fitDistance())

  // Lights travel with the camera, so the front and the back are lit the same way: a white key
  // from the upper right, a soft fill, and cold rim lights from behind the figure.
  scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x0b0f16, 0.5))
  scene.add(camera)
  const aim = new THREE.Object3D()
  aim.position.set(0, 0, -5)
  camera.add(aim)
  const rigLight = (color: number, intensity: number, x: number, y: number, z: number) => {
    const l = new THREE.DirectionalLight(color, intensity)
    l.position.set(x, y, z)
    l.target = aim
    camera.add(l)
  }
  rigLight(0xffffff, 1.95, 2.4, 2.9, 0.6)
  rigLight(0xd6e4ff, 0.5, -3, 0.8, 0)
  rigLight(0x6fb8ff, 2.3, -2.8, 1.8, -9.5)
  rigLight(0x6fb8ff, 1.7, 3, 1.2, -9)

  const fabric = fabricTexture()
  const patch = patchTexture()
  const { root, regions } = buildSuit(fabric, patch)
  scene.add(root)

  // Pedestal: a contact shadow, a soft glow and two thin rings under the feet. Static.
  const glowTex = radialTexture([
    [0, 'rgba(124,200,255,0.42)'],
    [0.45, 'rgba(70,140,255,0.12)'],
    [1, 'rgba(70,140,255,0)'],
  ])
  const shadowTex = radialTexture([
    [0, 'rgba(0,0,0,0.75)'],
    [0.5, 'rgba(0,0,0,0.35)'],
    [1, 'rgba(0,0,0,0)'],
  ])
  const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geo, mat)
    m.rotation.x = -Math.PI / 2
    m.position.y = y
    scene.add(m)
    return m
  }
  flat(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), -0.002)
  flat(new THREE.PlaneGeometry(0.75, 0.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 0.001)
  flat(new THREE.RingGeometry(0.455, 0.463, 128), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }), 0.002)
  flat(new THREE.RingGeometry(0.6, 0.603, 128), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }), 0.002)
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const tick = flat(new THREE.PlaneGeometry(0.004, i % 4 === 0 ? 0.04 : 0.02), new THREE.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.35, depthWrite: false }), 0.002)
    tick.position.x = Math.sin(a) * 0.53
    tick.position.z = Math.cos(a) * 0.53
    tick.rotation.z = -a
  }

  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(TARGET)
  controls.enableZoom = false
  controls.enablePan = false
  controls.enableDamping = false
  controls.rotateSpeed = 0.55
  controls.update()
  const polar = controls.getPolarAngle()
  controls.minPolarAngle = polar
  controls.maxPolarAngle = polar

  let frame = 0
  const listeners: (() => void)[] = []
  const render = () => {
    renderer.render(scene, camera)
    for (const fn of listeners) fn()
  }
  controls.addEventListener('change', render)

  const projectV = new THREE.Vector3()
  const project = () => {
    const out = {} as Record<Region, { x: number; y: number; facing: boolean }>
    const size = renderer.getSize(new THREE.Vector2())
    const dir = new THREE.Vector2(camera.position.x - TARGET.x, camera.position.z - TARGET.z).normalize()
    root.updateMatrixWorld()
    for (const r of REGION_ORDER) {
      const a = ANCHOR[r]
      projectV.set(...a.p).applyMatrix4(root.matrixWorld).project(camera)
      const n = new THREE.Vector2(a.n[0], a.n[1]).normalize()
      out[r] = { x: ((projectV.x + 1) / 2) * size.x, y: ((1 - projectV.y) / 2) * size.y, facing: n.dot(dir) > -0.05 }
    }
    return out
  }

  const radius = () => Math.hypot(camera.position.x - TARGET.x, camera.position.z - TARGET.z)
  const azimuth = () => Math.atan2(camera.position.x - TARGET.x, camera.position.z - TARGET.z)
  const setAzimuth = (a: number) => {
    const r = radius()
    camera.position.x = TARGET.x + Math.sin(a) * r
    camera.position.z = TARGET.z + Math.cos(a) * r
    camera.lookAt(TARGET)
    controls.update()
  }
  const setView = (view: 'front' | 'back', animate: boolean) => {
    cancelAnimationFrame(frame)
    const from = azimuth()
    let to = view === 'front' ? 0 : Math.PI
    // take the short way round
    while (to - from > Math.PI) to -= Math.PI * 2
    while (to - from < -Math.PI) to += Math.PI * 2
    if (!animate) {
      setAzimuth(to)
      render()
      return
    }
    const start = performance.now()
    const dur = 650
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const e = 1 - Math.pow(1 - t, 3)
      setAzimuth(from + (to - from) * e)
      render()
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  const applyStates = (info: Record<Region, RegionInfo>, selected: Region | null) => {
    for (const r of REGION_ORDER) {
      const state = info[r].state
      const hex = STATE_HEX[state]
      const isSel = selected === r
      const tint = hex ?? (isSel ? ICE : null)
      const base = state === 'symptom' ? 0.07 : state === 'caution' ? 0.05 : 0
      const intensity = tint === null ? 0 : base + (isSel ? 0.1 : 0)
      for (const m of regions[r].tintable) {
        m.emissive.setHex(tint ?? 0x000000)
        m.emissiveIntensity = intensity
      }
      const showShell = isSel || state === 'symptom'
      regions[r].shellMaterial.color.setHex(tint ?? ICE)
      regions[r].shellMaterial.opacity = isSel ? 0.85 : 0.5
      for (const s of regions[r].shells) s.visible = showShell
    }
    render()
  }

  const raycaster = new THREE.Raycaster()
  const pickables = REGION_ORDER.flatMap((r) => regions[r].pickable)
  const pick = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(pickables, false)[0]
    return (hit?.object.userData.region as Region | undefined) ?? null
  }

  const resize = (nw: number, nh: number) => {
    if (nw < 2 || nh < 2) return
    renderer.setSize(nw, nh, false)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
    const a = azimuth()
    const d = fitDistance()
    camera.position.set(TARGET.x + Math.sin(a) * d, TARGET.y + 0.06, TARGET.z + Math.cos(a) * d)
    camera.lookAt(TARGET)
    controls.update()
    render()
  }

  const dispose = () => {
    cancelAnimationFrame(frame)
    controls.dispose()
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[]
        for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose()
      }
    })
    for (const t of [fabric, patch, glowTex, shadowTex]) t.dispose()
    envRT.dispose()
    pmrem.dispose()
    renderer.dispose()
    listeners.length = 0
  }

  return { render, resize, project, setView, applyStates, pick, azimuth, dispose, onChange: (fn) => void listeners.push(fn) }
}

/** The 3D body map. Loaded lazily by BodyMap, which falls back to the 2D drawing if WebGL fails. */
export default function Astronaut3D({ regions, selected, onSelect, label, size = 'hero', onError }: BodyMapProps & { onError: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const hotspotRefs = useRef<Partial<Record<Region, HTMLButtonElement | null>>>({})
  const latest = useRef({ selected, onSelect })
  latest.current = { selected, onSelect }
  const [view, setView] = useState<'front' | 'back'>('front')
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // Create the scene once, before paint, so the region buttons are placed on the first frame.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    let engine: Engine
    try {
      engine = createEngine(canvas, Math.max(2, wrap.clientWidth), Math.max(2, wrap.clientHeight))
    } catch {
      onError()
      return
    }
    engineRef.current = engine
    const place = () => {
      const pos = engine.project()
      const mid = wrap.clientWidth / 2
      for (const r of REGION_ORDER) {
        const el = hotspotRefs.current[r]
        if (!el) continue
        const p = pos[r]
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
        el.style.opacity = p.facing ? '1' : '0.4'
        el.dataset.side = p.x >= mid ? 'right' : 'left'
        const chip = el.querySelector<HTMLElement>('[data-chip]')
        if (chip) chip.style.visibility = p.facing ? 'visible' : 'hidden'
      }
      const a = Math.abs(engine.azimuth())
      setView(a > Math.PI / 2 ? 'back' : 'front')
    }
    engine.onChange(place)
    const ro = new ResizeObserver(() => engine.resize(wrap.clientWidth, wrap.clientHeight))
    ro.observe(wrap)
    engine.render()

    // A click without a drag selects the region under the pointer.
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

  const turn = (v: 'front' | 'back') => {
    setView(v)
    engineRef.current?.setView(v, !reduced)
  }

  return (
    <div className="relative h-full w-full overflow-hidden select-none" role="group" aria-label={label}>
      <div ref={wrapRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full cursor-grab touch-pan-y" aria-hidden />
      </div>
      {REGION_ORDER.map((r) => {
        const info = regions[r]
        const k = KIND[info.state]
        const marked = Boolean(k && info.callout)
        const isSel = selected === r
        const color = k ? k.color : 'var(--color-ink-3)'
        return (
          <button
            key={r}
            ref={(el) => {
              hotspotRefs.current[r] = el
            }}
            type="button"
            data-testid={`region-${r}`}
            data-state={info.state}
            data-selected={isSel}
            aria-pressed={isSel}
            aria-label={`${REGION_NO[r]}, ${info.name}: ${info.callout ?? 'no evidence recorded'}`}
            onClick={() => onSelect(isSel ? null : r)}
            className="group absolute top-0 left-0 z-10 -mt-3.5 -ml-3.5 h-7 w-7 transition-opacity duration-200"
            style={{ transform: 'translate(-9999px, -9999px)' }}
          >
            <span
              className={`absolute inset-0 grid place-items-center rounded-full border text-[11px] font-bold backdrop-blur-sm transition-[box-shadow,background-color] ${isSel ? 'bg-void/80' : 'bg-void/55 group-hover:bg-void/80'}`}
              style={{ borderColor: color, color, boxShadow: marked || isSel ? `0 0 0 3px color-mix(in oklab, ${isSel ? color : 'transparent'} 25%, transparent), 0 0 14px color-mix(in oklab, ${color} 55%, transparent)` : undefined }}
            >
              {REGION_NO[r]}
            </span>
            {marked && size === 'hero' && (
              <span
                data-chip
                className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 items-center gap-0 group-data-[side=left]:right-full group-data-[side=left]:flex-row-reverse group-data-[side=right]:left-full sm:flex`}
              >
                <span className="h-px w-7" style={{ background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 30%, transparent))` }} />
                <span className="rounded-full border bg-void/75 px-2 py-[3px] text-[10px] font-bold tracking-[0.08em] whitespace-nowrap backdrop-blur-sm" style={{ borderColor: `color-mix(in oklab, ${color} 55%, transparent)`, color }}>
                  {REGION_NO[r]} · {k!.tag}
                </span>
              </span>
            )}
          </button>
        )
      })}
      <div className="seg absolute top-3 left-3 z-20" role="group" aria-label="Model view">
        {(['front', 'back'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => turn(v)}>
            {v === 'front' ? 'Front' : 'Back'}
          </button>
        ))}
      </div>
      <p className="pointer-events-none absolute right-3 bottom-2 z-10 text-[10.5px] text-ink-3">{size === 'hero' ? 'Drag to turn · select a marker' : 'Drag to turn'}</p>
    </div>
  )
}
