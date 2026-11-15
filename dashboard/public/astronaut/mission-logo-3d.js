import * as THREE from './black-hole-engine.js'

export function createMissionLogo(canvas, width, height) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.setSize(width, height, false)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
  camera.position.z = 6.5
  const shape = new THREE.Shape()
  shape.moveTo(0, 1.55)
  shape.bezierCurveTo(.07, .25, .22, .07, 1.45, 0)
  shape.bezierCurveTo(.22, -.07, .07, -.25, 0, -1.55)
  shape.bezierCurveTo(-.07, -.25, -.22, -.07, -1.45, 0)
  shape.bezierCurveTo(-.22, .07, -.07, .25, 0, 1.55)
  const hole = new THREE.Path()
  hole.moveTo(0, .85)
  hole.bezierCurveTo(-.07, .22, -.2, .07, -.78, 0)
  hole.bezierCurveTo(-.2, -.07, -.07, -.22, 0, -.85)
  hole.bezierCurveTo(.07, -.22, .2, -.07, .78, 0)
  hole.bezierCurveTo(.2, .07, .07, .22, 0, .85)
  shape.holes.push(hole)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .19, bevelEnabled: true, bevelThickness: .025, bevelSize: .022, bevelSegments: 3, curveSegments: 20,
  })
  geometry.center()
  const material = new THREE.MeshStandardMaterial({ color: '#9dccff', roughness: .27, metalness: .35 })
  const logo = new THREE.Mesh(geometry, material)
  scene.add(logo, new THREE.HemisphereLight('#e2eeff', '#264e90', 2.1))
  const key = new THREE.DirectionalLight('#f2f8ff', 3.2)
  key.position.set(3, 4, 5)
  scene.add(key)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  return {
    draw(x, y) {
      logo.rotation.set(x, y, 0)
      renderer.render(scene, camera)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
