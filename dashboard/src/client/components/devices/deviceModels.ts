/**
 * Procedural device models for the monitoring-system cards. Built from three.js primitives with
 * PBR materials; no files to load. Each builder returns a group centred on the origin with a
 * bounding sphere of radius 1, so every card frames its model the same way.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export type ModelKind = 'chest-strap' | 'bp-cuff' | 'suit-biomonitor' | 'generic'

const TAU = Math.PI * 2

function materials() {
  return {
    fabric: new THREE.MeshPhysicalMaterial({ color: 0x262c38, roughness: 0.9, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x7083ad), side: THREE.DoubleSide }),
    navyFabric: new THREE.MeshPhysicalMaterial({ color: 0x1b2a46, roughness: 0.88, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x5d79b8), side: THREE.DoubleSide }),
    hook: new THREE.MeshPhysicalMaterial({ color: 0x2b3b5c, roughness: 0.97, sheen: 0.6, sheenColor: new THREE.Color(0x8ea4d6), side: THREE.DoubleSide }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x12151a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide }),
    shell: new THREE.MeshPhysicalMaterial({ color: 0xdfe4ea, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    anodized: new THREE.MeshPhysicalMaterial({ color: 0xe8ebee, roughness: 0.5, metalness: 0.15, clearcoat: 0.3 }),
    panel: new THREE.MeshPhysicalMaterial({ color: 0x1c2129, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc8ced6, roughness: 0.24, metalness: 1 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x5a616b, roughness: 0.35, metalness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.72, side: THREE.DoubleSide }),
    tube: new THREE.MeshPhysicalMaterial({ color: 0x8c96a6, roughness: 0.35, clearcoat: 0.6 }),
    screen: new THREE.MeshPhysicalMaterial({ color: 0x04080f, roughness: 0.08, clearcoat: 1, emissive: new THREE.Color(0x0d4a85), emissiveIntensity: 0.55 }),
    ledMint: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(0x3ddc97), emissiveIntensity: 2.4 }),
    ledCyan: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(0x4fb4ff), emissiveIntensity: 2.4 }),
    ledAmber: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(0xffc53d), emissiveIntensity: 1.8 }),
  }
}
type Mats = ReturnType<typeof materials>

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(x, y, z)
  return m
}

/** A band cross-section with rounded edges, for LatheGeometry: radius r, thickness t, half height h. */
function bandProfile(r: number, t: number, h: number, round = 0.35) {
  const e = Math.min(t, h) * round
  const pts: THREE.Vector2[] = []
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 4; i += 1) {
      const a = from + (i / 4) * (Math.PI / 2)
      pts.push(new THREE.Vector2(cx + Math.cos(a) * e, cy + Math.sin(a) * e))
    }
  }
  corner(r + e, -h + e, Math.PI)
  corner(r + t - e, -h + e, -Math.PI / 2)
  corner(r + t - e, h - e, 0)
  corner(r + e, h - e, Math.PI / 2)
  pts.push(pts[0].clone())
  return pts
}

function chestStrap(m: Mats) {
  const g = new THREE.Group()
  const r = 1
  const t = 0.05
  const gap = 0.32
  // The elastic band, open at the back where the buckle joins it.
  const band = mesh(new THREE.LatheGeometry(bandProfile(r, t, 0.15), 120, Math.PI + gap, TAU - gap * 2), m.fabric)
  g.add(band)
  // Two electrode pads on the inside, either side of the sensor.
  for (const phi of [-0.42, 0.42]) {
    g.add(mesh(new THREE.LatheGeometry(bandProfile(r - 0.018, 0.02, 0.11, 0.5), 24, phi - 0.17, 0.34), m.rubber))
  }
  // Buckle halves at the back.
  for (const side of [-1, 1]) {
    const phi = Math.PI + side * gap
    const clip = mesh(new RoundedBoxGeometry(0.06, 0.3, 0.12, 3, 0.02), m.gloss, Math.sin(phi) * (r + t / 2), 0, Math.cos(phi) * (r + t / 2))
    clip.rotation.y = phi + Math.PI / 2
    g.add(clip)
  }
  // The sensor pod snapped to the front of the band.
  const front = r + t
  const pod = mesh(new RoundedBoxGeometry(0.66, 0.36, 0.16, 5, 0.075), m.gloss, 0, 0, front + 0.07)
  g.add(pod)
  g.add(mesh(new RoundedBoxGeometry(0.42, 0.05, 0.02, 2, 0.01), m.metal, 0, -0.08, front + 0.155))
  const led = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 20), m.ledMint, 0.2, 0.08, front + 0.152)
  led.rotation.x = Math.PI / 2
  g.add(led)
  for (const x of [-0.24, 0.24]) {
    const stud = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 24), m.metal, x, 0, front + 0.005)
    stud.rotation.x = Math.PI / 2
    g.add(stud)
  }
  // A chest is wider than it is deep.
  g.scale.set(1, 1, 0.74)
  return g
}

function bpCuff(m: Mats) {
  const g = new THREE.Group()
  const cuff = new THREE.Group()
  const r = 0.5
  cuff.add(mesh(new THREE.LatheGeometry(bandProfile(r, 0.07, 0.44, 0.3), 96), m.navyFabric))
  // The hook-and-loop flap that wraps over the sleeve, with a metal D-ring at its edge.
  cuff.add(mesh(new THREE.LatheGeometry(bandProfile(r + 0.07, 0.025, 0.4, 0.5), 32, -0.5, 1.15), m.hook))
  const ring = mesh(new THREE.TorusGeometry(0.11, 0.014, 12, 40), m.metal, Math.sin(0.68) * (r + 0.1), 0, Math.cos(0.68) * (r + 0.1))
  ring.rotation.y = 0.68
  cuff.add(ring)
  // The artery marker.
  cuff.add(mesh(new RoundedBoxGeometry(0.12, 0.05, 0.01, 2, 0.005), m.shell, Math.sin(-0.3) * (r + 0.075), -0.3, Math.cos(-0.3) * (r + 0.075)))
  cuff.rotation.z = 0.32
  g.add(cuff)
  // The hand unit with its screen and start button.
  const unit = new THREE.Group()
  unit.add(mesh(new RoundedBoxGeometry(0.72, 0.52, 0.2, 5, 0.07), m.shell))
  unit.add(mesh(new RoundedBoxGeometry(0.5, 0.24, 0.02, 3, 0.012), m.screen, 0, 0.07, 0.1))
  for (const [x, mat] of [[-0.12, m.gloss], [0.12, m.ledCyan]] as const) {
    const button = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), mat, x, -0.15, 0.1)
    button.rotation.x = Math.PI / 2
    unit.add(button)
  }
  unit.position.set(1.05, -0.42, 0.3)
  unit.rotation.y = -0.45
  g.add(unit)
  // The air tube from the cuff to the unit.
  const tubePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, -0.1, 0.55),
    new THREE.Vector3(0.45, -0.35, 0.85),
    new THREE.Vector3(0.75, -0.55, 0.65),
    new THREE.Vector3(1.02, -0.42, 0.42),
  ])
  g.add(mesh(new THREE.TubeGeometry(tubePath, 48, 0.022, 10), m.tube))
  return g
}

function suitBiomonitor(m: Mats) {
  const g = new THREE.Group()
  const w = 1.1
  const h = 0.7
  const d = 0.32
  g.add(mesh(new RoundedBoxGeometry(w, h, d, 6, 0.07), m.anodized))
  g.add(mesh(new RoundedBoxGeometry(w - 0.18, h - 0.22, 0.04, 3, 0.02), m.panel, 0, 0.02, d / 2))
  // Status lights and a label plate on the front.
  ;[m.ledMint, m.ledMint, m.ledCyan].forEach((mat, i) => {
    const led = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), mat, -0.3 + i * 0.12, 0.12, d / 2 + 0.025)
    led.rotation.x = Math.PI / 2
    g.add(led)
  })
  g.add(mesh(new RoundedBoxGeometry(0.34, 0.08, 0.012, 2, 0.006), m.metal, 0.2, -0.1, d / 2 + 0.022))
  // Two suit connectors on top, one with its cable.
  for (const x of [-0.3, 0.3]) {
    g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 28), m.metal, x, h / 2 + 0.05, 0))
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.125, 20), m.rubber, x, h / 2 + 0.06, 0))
  }
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.3, h / 2 + 0.1, 0),
    new THREE.Vector3(-0.32, h / 2 + 0.38, -0.08),
    new THREE.Vector3(-0.6, h / 2 + 0.52, -0.3),
    new THREE.Vector3(-0.95, h / 2 + 0.45, -0.45),
  ])
  g.add(mesh(new THREE.TubeGeometry(cable, 40, 0.035, 12), m.rubber))
  // Heat-sink fins on the back and the mounting strap that holds it to the suit.
  for (let i = 0; i < 7; i += 1) g.add(mesh(new THREE.BoxGeometry(w - 0.24, 0.028, 0.06), m.darkMetal, 0, -0.24 + i * 0.08, -d / 2 - 0.025))
  g.add(mesh(new RoundedBoxGeometry(1.62, 0.2, 0.035, 2, 0.012), m.fabric, 0, -0.08, -d / 2 - 0.075))
  for (const x of [-0.78, 0.78]) g.add(mesh(new RoundedBoxGeometry(0.08, 0.26, 0.06, 2, 0.015), m.metal, x, -0.08, -d / 2 - 0.075))
  g.rotation.x = 0.12
  return g
}

function genericSensor(m: Mats) {
  const g = new THREE.Group()
  const profile = [
    new THREE.Vector2(0, -0.14),
    new THREE.Vector2(0.62, -0.14),
    new THREE.Vector2(0.7, -0.1),
    new THREE.Vector2(0.73, 0),
    new THREE.Vector2(0.7, 0.09),
    new THREE.Vector2(0.6, 0.14),
    new THREE.Vector2(0, 0.15),
  ]
  g.add(mesh(new THREE.LatheGeometry(profile, 72), m.gloss))
  const ring = mesh(new THREE.TorusGeometry(0.5, 0.018, 12, 72), m.ledCyan, 0, 0.145, 0)
  ring.rotation.x = Math.PI / 2
  g.add(ring)
  g.add(mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.05, 72), m.rubber, 0, -0.16, 0))
  g.rotation.x = 0.5
  return g
}

const BUILDERS: Record<ModelKind, (m: Mats) => THREE.Group> = {
  'chest-strap': chestStrap,
  'bp-cuff': bpCuff,
  'suit-biomonitor': suitBiomonitor,
  generic: genericSensor,
}

/** Build one model, centred, with a bounding sphere of radius 1. */
export function buildDeviceModel(kind: ModelKind): THREE.Group {
  const inner = BUILDERS[kind](materials())
  const box = new THREE.Box3().setFromObject(inner)
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  inner.position.sub(sphere.center)
  const root = new THREE.Group()
  root.add(inner)
  root.scale.setScalar(1 / sphere.radius)
  return root
}

/** Free every geometry and material in a model. */
export function disposeModel(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.geometry.dispose()
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (seen.has(mat)) continue
      seen.add(mat)
      mat.dispose()
    }
  })
}
