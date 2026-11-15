/**
 * OURANOS watch viewer: the real CAD (hardware/band, exported by scripts/export-ouranos-watch.py)
 * rendered with physically based materials, an exploded view with labels, and a connect sequence
 * that reuses the mission star: the star spins over the face while the parts pull in, then the case
 * snaps shut with a flash and a burst of small stars, and the screen lights up.
 *
 *   const watch = await createOuranosWatch(canvas, { labels: element })
 *   watch.setExploded(true) / watch.connect() / watch.setScreen({ title, detail }) / watch.dispose()
 */
import * as THREE from '../astronaut/black-hole-engine.js'

const MATERIALS = {
  'pla-shell': { color: '#ebe7de', roughness: 0.62, layers: true },
  'pla-plate': { color: '#dcd7cc', roughness: 0.66, layers: true },
  'pla-band': { color: '#2c3038', roughness: 0.58, layers: true },
  filament: { color: '#e9e4d8', roughness: 0.5 },
  aluminum: { color: '#c5c9cf', roughness: 0.3, metalness: 1 },
  'sensor-glass': { color: '#08090c', roughness: 0.06, clearcoat: 1 },
}
const LABELS = {
  shell: 'Printed shroud, OURANOS engraved',
  watch: 'Apple Watch SE, 40 mm',
  backplate: 'Slide-in back plate',
  'band-a': 'Chain band A',
  'band-b': 'Chain band B',
  hook: 'Glove hook',
  pin: 'Filament hinge pins',
}
const BLUE = '#7cc8ff'
const ease = (t) => t * t * (3 - 2 * t)

/** Thin horizontal shading every 0.2 mm, the layer height the parts were printed at. */
function withLayerLines(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLayerZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayerZ = position.z;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLayerZ;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.955 + 0.045 * (0.5 + 0.5 * sin(vLayerZ * 31.4159));')
  }
  return material
}

/** A small studio for reflections: dark room, three soft boxes and a cool rim panel. */
function studioEnvironment(renderer) {
  const room = new THREE.Scene()
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: '#0d1016', side: THREE.BackSide }))
  room.add(box)
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }))
    m.position.set(...pos)
    m.lookAt(0, 0, 0)
    room.add(m)
  }
  panel(4, 2.2, '#ffffff', 3.2, [0, 2.6, 3.5])
  panel(2.2, 3, '#f3f6ff', 1.6, [-4.5, 0.6, 1])
  panel(2.2, 3, '#ffffff', 1.1, [4.5, 0.4, -0.5])
  panel(5, 1.2, BLUE, 1.4, [0, -1.5, -4.5])
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(room, 0.035).texture
  pmrem.dispose()
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose() })
  return texture
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** The mission star from mission-logo-3d.js, at the same proportions. */
function starGeometry(size) {
  const k = size / 3.1
  const shape = new THREE.Shape()
  shape.moveTo(0, 1.55 * k)
  shape.bezierCurveTo(0.07 * k, 0.25 * k, 0.22 * k, 0.07 * k, 1.45 * k, 0)
  shape.bezierCurveTo(0.22 * k, -0.07 * k, 0.07 * k, -0.25 * k, 0, -1.55 * k)
  shape.bezierCurveTo(-0.07 * k, -0.25 * k, -0.22 * k, -0.07 * k, -1.45 * k, 0)
  shape.bezierCurveTo(-0.22 * k, 0.07 * k, -0.07 * k, 0.25 * k, 0, 1.55 * k)
  const hole = new THREE.Path()
  hole.moveTo(0, 0.85 * k)
  hole.bezierCurveTo(-0.07 * k, 0.22 * k, -0.2 * k, 0.07 * k, -0.78 * k, 0)
  hole.bezierCurveTo(-0.2 * k, -0.07 * k, -0.07 * k, -0.22 * k, 0, -0.85 * k)
  hole.bezierCurveTo(0.07 * k, -0.22 * k, 0.2 * k, -0.07 * k, 0.78 * k, 0)
  hole.bezierCurveTo(0.2 * k, 0.07 * k, 0.07 * k, 0.22 * k, 0, 0.85 * k)
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.19 * k, bevelEnabled: true, bevelThickness: 0.025 * k, bevelSize: 0.022 * k, bevelSegments: 3, curveSegments: 20 })
  g.center()
  return g
}

function spriteTexture(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  draw(c.getContext('2d'))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const glowTexture = () => spriteTexture((g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(160,210,255,.55)'); r.addColorStop(1, 'rgba(120,180,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
})
const sparkTexture = () => spriteTexture((g) => {
  g.translate(64, 64); g.fillStyle = '#fff'
  g.beginPath(); g.moveTo(0, -60)
  for (const [x, y] of [[60, 0], [0, 60], [-60, 0], [0, -60]]) g.quadraticCurveTo(0, 0, x, y)
  g.fill()
})

export async function createOuranosWatch(canvas, options = {}) {
  const base = new URL('./', import.meta.url)
  const [manifest, buffer] = await Promise.all([
    fetch(new URL('ouranos-watch.json', base)).then((r) => r.json()),
    fetch(new URL('ouranos-watch.bin', base)).then((r) => r.arrayBuffer()),
  ])
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.environment = studioEnvironment(renderer)
  const camera = new THREE.PerspectiveCamera(28, 1, 1, 4000)
  const key = new THREE.DirectionalLight('#ffffff', 2.4)
  key.position.set(90, 160, 220)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 50, far: 700 })
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.4
  const rim = new THREE.DirectionalLight(BLUE, 2.2)
  rim.position.set(-160, 60, -200)
  scene.add(key, rim, new THREE.HemisphereLight('#dfe9ff', '#10141c', 0.45))

  // The model: as-worn CAD coordinates (Z = watch face), turned so the face looks at the camera.
  const stage = new THREE.Group()
  const model = new THREE.Group()
  stage.add(model)
  scene.add(stage)
  const materials = {}
  const material = (name) => materials[name] ??= (() => {
    const spec = MATERIALS[name] ?? MATERIALS['pla-shell']
    const m = new THREE.MeshPhysicalMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness ?? 0, clearcoat: spec.clearcoat ?? 0, clearcoatRoughness: 0.08, envMapIntensity: 1 })
    return spec.layers ? withLayerLines(m) : m
  })()

  const parts = manifest.parts.map((p) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buffer, p.positions[0], p.positions[1]), 3))
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, p.indices[0], p.indices[1]), 1))
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, material(p.material))
    mesh.castShadow = mesh.receiveShadow = true
    const holder = new THREE.Group()
    holder.add(mesh)
    model.add(holder)
    g.computeBoundingBox()
    return { ...p, holder, mesh, center: g.boundingBox.getCenter(new THREE.Vector3()) }
  })

  // Watch display: a lit screen under a thin reflective glass, sitting on the watch body.
  const w = manifest.watch
  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = 340; screenCanvas.height = 400
  const screenTexture = new THREE.CanvasTexture(screenCanvas)
  screenTexture.colorSpace = THREE.SRGBColorSpace
  screenTexture.anisotropy = 8
  const screenShape = new THREE.ShapeGeometry(roundedRect(w.w - 3.4, w.h - 3.4, w.r - 1.6), 24)
  const uv = screenShape.attributes.position
  const uvs = new Float32Array(uv.count * 2)
  for (let i = 0; i < uv.count; i++) { uvs[i * 2] = uv.getX(i) / (w.w - 3.4) + 0.5; uvs[i * 2 + 1] = uv.getY(i) / (w.h - 3.4) + 0.5 }
  screenShape.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  const screen = new THREE.Mesh(screenShape, new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }))
  screen.position.z = w.zFront + 0.03
  const glass = new THREE.Mesh(screenShape, new THREE.MeshPhysicalMaterial({ color: '#000', roughness: 0.03, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.22, envMapIntensity: 1.6 }))
  glass.position.z = w.zFront + 0.12
  const watchPart = parts.find((p) => p.role === 'watch')
  watchPart.holder.add(screen, glass)

  // Mission star, connect flash and burst.
  const star = new THREE.Mesh(starGeometry(17), new THREE.MeshStandardMaterial({ color: '#9dccff', roughness: 0.25, metalness: 0.4, emissive: '#1b3c66', emissiveIntensity: 0.6 }))
  star.visible = false
  model.add(star)
  const glowMap = glowTexture()
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: '#cfe6ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }))
  flash.position.set(0, 0, manifest.case.zTop + 2)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: BLUE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }))
  halo.scale.setScalar(70)
  halo.position.copy(flash.position)
  model.add(flash, halo)
  const sparkMap = sparkTexture()
  const sparks = Array.from({ length: 22 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkMap, color: i % 3 ? '#cfe6ff' : BLUE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }))
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3
    s.userData.dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.25 + Math.random() * 0.6).normalize()
    s.userData.speed = 55 + Math.random() * 65
    model.add(s)
    return s
  })

  // Labels for the exploded view (HTML, positioned from the 3D anchors).
  const labelLayer = options.labels ?? null
  const labelEls = new Map()
  // Where each label sits relative to its part, in pixels at a 620 px stage, so none overlap.
  const LABEL_OFFSET = { shell: [-165, -58], watch: [120, -150], backplate: [-160, 78], pin: [170, 34], 'band-a': [128, -6], hook: [-122, -10], 'band-b': [-138, 8] }
  let leaders = null
  if (labelLayer) {
    leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    leaders.setAttribute('class', 'ouranos-leaders')
    labelLayer.append(leaders)
    for (const role of Object.keys(LABELS)) {
      const el = document.createElement('div')
      el.className = 'ouranos-label'
      el.textContent = LABELS[role]
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('r', '2.6')
      leaders.append(line, dot)
      labelLayer.append(el)
      labelEls.set(role, { el, line, dot })
    }
  }

  // State: explode 0 = assembled, 1 = apart. curl bends the chain around a wrist.
  const state = { explode: options.exploded === false ? 0 : 1, explodeTarget: options.exploded === false ? 0 : 1, curl: options.curl ?? 0.34,
    yaw: options.yaw ?? 0.42, pitch: options.pitch ?? -0.3, dist: options.distance ?? 290, spin: !reduced && options.autoRotate !== false,
    connect: null, connected: false, screen: { title: 'OURANOS', detail: 'Crew health' }, flashT: -1 }

  function pose() {
    const e = state.explode
    for (const side of ['a', 'b']) {
      const links = parts.filter((p) => p.role === `band-${side}` || (side === 'a' && p.role === 'hook'))
      const sign = side === 'a' ? -1 : 1
      let at = new THREE.Vector3(...links[0].pivot)
      let angle = 0
      links.forEach((link, i) => {
        angle += sign * state.curl * (i === 0 ? 0.35 : 1) * (link.role === 'hook' ? 0.2 : 1)
        if (i > 0) {
          const step = new THREE.Vector3(...link.pivot).sub(new THREE.Vector3(...links[i - 1].pivot))
          at = at.clone().add(step.applyAxisAngle(new THREE.Vector3(1, 0, 0), links[i - 1].angle))
        }
        link.angle = angle
        link.holder.position.copy(at).addScaledVector(new THREE.Vector3(...link.explode), e)
        link.holder.rotation.set(angle, 0, 0)
        link.mesh.position.set(-link.pivot[0], -link.pivot[1], -link.pivot[2])
      })
    }
    for (const p of parts) {
      if (p.role.startsWith('band') || p.role === 'hook') continue
      p.holder.position.set(...p.explode).multiplyScalar(e)
    }
  }

  let width = 1, height = 1
  function resize(wid = canvas.clientWidth, hei = canvas.clientHeight) {
    width = Math.max(1, wid); height = Math.max(1, hei)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resize(options.width, options.height)

  function drawScreen(progress) {
    const g = screenCanvas.getContext('2d')
    const W = screenCanvas.width, H = screenCanvas.height
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
    g.textAlign = 'center'
    const font = (weight, size) => `${weight} ${size}px -apple-system, "SF Pro Rounded", "Helvetica Neue", sans-serif`
    if (progress !== null) {
      g.strokeStyle = '#1b2533'; g.lineWidth = 14
      g.beginPath(); g.arc(W / 2, H / 2 - 18, 104, 0, Math.PI * 2); g.stroke()
      g.strokeStyle = BLUE; g.lineCap = 'round'
      g.beginPath(); g.arc(W / 2, H / 2 - 18, 104, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); g.stroke()
      g.fillStyle = '#f2f6ff'; g.font = font(600, 46)
      g.fillText(`${Math.round(progress * 100)}%`, W / 2, H / 2 - 2)
      g.fillStyle = '#8ea4c0'; g.font = font(500, 24)
      g.fillText('Connecting', W / 2, H - 52)
    } else {
      g.fillStyle = '#f5f7ff'; g.font = font(650, 40)
      g.letterSpacing = '9px'
      g.fillText(state.screen.title, W / 2 + 4, H / 2 - 12)
      g.letterSpacing = '0px'
      g.fillStyle = state.connected ? BLUE : '#8ea4c0'; g.font = font(500, 26)
      g.fillText(state.screen.detail, W / 2, H / 2 + 34)
      if (state.connected) {
        g.fillStyle = BLUE
        g.beginPath(); g.arc(W / 2 - 66, H - 62, 7, 0, Math.PI * 2); g.fill()
        g.fillStyle = '#c9d6e8'; g.font = font(500, 22); g.textAlign = 'left'
        g.fillText(state.screen.status || 'Connected', W / 2 - 50, H - 54)
      }
    }
    screenTexture.needsUpdate = true
  }
  drawScreen(null)

  // Drag to turn, click to take apart or put together.
  let drag = null
  const onDown = (ev) => { drag = { x: ev.clientX, y: ev.clientY, yaw: state.yaw, pitch: state.pitch, moved: false }; canvas.setPointerCapture?.(ev.pointerId) }
  const onMove = (ev) => {
    if (!drag) return
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
    state.yaw = drag.yaw + dx * 0.008
    state.pitch = Math.max(-1.1, Math.min(0.9, drag.pitch + dy * 0.006))
    wake()
  }
  const onUp = () => {
    if (drag && !drag.moved && options.clickToExplode !== false) api.setExploded(state.explodeTarget < 0.5)
    drag = null
  }
  if (options.interactive !== false) {
    canvas.style.touchAction = 'pan-y'
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const clock = new THREE.Clock()
  let frame = 0, visible = true, idleFrames = 0
  const anchor = new THREE.Vector3()
  function render() {
    frame = 0
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime
    if (state.spin && !drag) state.yaw += dt * 0.12
    const before = state.explode
    if (!state.connect) state.explode += (state.explodeTarget - state.explode) * Math.min(1, dt * 4.5)

    if (state.connect) {
      const c = state.connect
      const k = Math.min(1, (performance.now() - c.start) / c.duration)
      const load = Math.min(1, k / 0.72)
      star.visible = load < 1
      star.position.set(0, 0, manifest.case.zTop + 16 - 10 * ease(load))
      star.rotation.set(-Math.sin(Math.PI * ease(load)) * 0.28, ease(load) * Math.PI * 4, 0)
      star.scale.setScalar(1 - 0.85 * ease(Math.max(0, (load - 0.75) / 0.25)))
      if (k <= 0.72) {
        state.explode = c.from + (0.22 - c.from) * ease(load)
      } else {
        // Snap: accelerate into place, then a small recoil as the case closes.
        const s = (k - 0.72) / 0.28
        const shut = Math.min(1, s / 0.45)
        state.explode = 0.22 * (1 - shut ** 3) + (s > 0.45 ? 0.02 * Math.sin(Math.PI * (s - 0.45) / 0.55) * (1 - s) : 0)
      }
      if (load < 1) drawScreen(load)
      c.onProgress?.(load)
      if (load >= 1 && state.flashT < 0) {
        state.flashT = t
        state.connected = true
        drawScreen(null)
      }
      if (k >= 1) { state.connect = null; state.explode = 0; state.explodeTarget = 0; star.visible = false; options.onExplodedChange?.(false); c.resolve() }
    }
    if (state.flashT >= 0) {
      const f = t - state.flashT
      flash.material.opacity = Math.max(0, 1 - f / 0.7)
      flash.scale.setScalar(20 + 160 * ease(Math.min(1, f / 0.7)))
      for (const s of sparks) {
        const life = Math.min(1, f / 1.1)
        s.position.copy(flash.position).addScaledVector(s.userData.dir, s.userData.speed * ease(life))
        s.scale.setScalar(9 * (1 - life) + 2)
        s.material.opacity = (1 - life) * 0.95
      }
      if (f > 1.2) { state.flashT = -1; for (const s of sparks) s.material.opacity = 0; flash.material.opacity = 0 }
    }
    halo.material.opacity = state.connected && state.explode < 0.05 ? 0.16 + 0.1 * Math.sin(t * 2.2) : 0
    stage.position.y = reduced ? 0 : Math.sin(t * 0.8) * 2.2

    pose()
    // Coming apart, the view swings to a three-quarter side angle so the stack spreads across it.
    const e = ease(Math.max(0, Math.min(1, state.explode)))
    stage.rotation.set(state.pitch - 0.22 * e, state.yaw + 0.62 * e, 0)
    const dist = state.dist * (1 + 0.42 * e)
    camera.position.set(0, 18, dist)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)

    if (labelEls.size) {
      const show = state.explode > 0.55
      const k = width / 620
      for (const [role, { el, line, dot }] of labelEls) {
        const p = parts.find((x) => x.role === role)
        anchor.copy(p?.center ?? anchor); p?.mesh.localToWorld(anchor); anchor.project(camera)
        const ax = (anchor.x * 0.5 + 0.5) * width, ay = (-anchor.y * 0.5 + 0.5) * height
        const [ox, oy] = LABEL_OFFSET[role] ?? [0, -40]
        const half = (el.offsetWidth || 140) / 2 + 6
        const lx = Math.max(half, Math.min(width - half, ax + ox * k)), ly = Math.max(14, Math.min(height - 14, ay + oy * k))
        const alpha = p && show && anchor.z < 1 ? Math.min(1, (state.explode - 0.55) * 4) : 0
        el.style.transform = `translate(${lx}px, ${ly}px)`
        el.style.opacity = String(alpha)
        line.setAttribute('x1', ax); line.setAttribute('y1', ay); line.setAttribute('x2', lx); line.setAttribute('y2', ly)
        dot.setAttribute('cx', ax); dot.setAttribute('cy', ay)
        line.style.opacity = dot.style.opacity = String(alpha)
      }
    }
    const settling = Math.abs(before - state.explode) > 1e-4 || state.connect || state.flashT >= 0 || drag
    idleFrames = settling ? 0 : idleFrames + 1
    // Keep animating while on screen; with reduced motion, only until things settle.
    if (visible && (!reduced || settling || idleFrames < 2)) frame = requestAnimationFrame(render)
  }
  function wake() { if (!frame && visible) { clock.getDelta(); frame = requestAnimationFrame(render) } }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) wake()
    else if (frame) { cancelAnimationFrame(frame); frame = 0 }
  })
  observer.observe(canvas)
  wake()

  const api = {
    /** Take the watch apart (true) or put it together (false). */
    setExploded(on) { state.explodeTarget = on ? 1 : 0; options.onExplodedChange?.(Boolean(on)); wake() },
    get exploded() { return state.explodeTarget > 0.5 },
    /** Play the connect sequence; resolves when the case has snapped shut. */
    connect({ duration = 2600, onProgress } = {}) {
      if (reduced) { state.explode = state.explodeTarget = 0; state.connected = true; drawScreen(null); options.onExplodedChange?.(false); wake(); return Promise.resolve() }
      return new Promise((resolve) => {
        state.connected = false
        state.flashT = -1
        state.connect = { start: performance.now(), duration, from: state.explode, onProgress, resolve }
        wake()
      })
    },
    /** Show "not connected" again without taking the watch apart. */
    setConnected(on) { state.connected = on; drawScreen(null); wake() },
    setScreen({ title = 'OURANOS', detail = 'Crew health', status = 'Connected' } = {}) { state.screen = { title, detail, status }; drawScreen(null); wake() },
    setAutoRotate(on) { state.spin = on && !reduced; wake() },
    resize(wid, hei) { resize(wid, hei); wake() },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      for (const { el } of labelEls.values()) el.remove()
      leaders?.remove()
      scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose() }) })
      scene.environment?.dispose()
      renderer.dispose()
    },
  }
  return api
}
