import * as THREE from './black-hole-engine.js';

export function createStars(pixelRatio, starCount) {
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    const starTwinkle = new Float32Array(starCount);
    const starFieldRadius = 2000;
    const starPalette = [
        new THREE.Color(0x88aaff), new THREE.Color(0xffaaff), new THREE.Color(0xaaffff),
        new THREE.Color(0xffddaa), new THREE.Color(0xffeecc), new THREE.Color(0xffffff),
        new THREE.Color(0xff8888), new THREE.Color(0x88ff88), new THREE.Color(0xffff88),
        new THREE.Color(0x88ffff)
    ];

    for (let i = 0; i < starCount; i++) {
        const i3 = i * 3;
        const phi = Math.acos(-1 + (2 * i) / starCount);
        const theta = Math.sqrt(starCount * Math.PI) * phi;
        const radius = Math.cbrt(Math.random()) * starFieldRadius + 100;

        starPositions[i3] = radius * Math.sin(phi) * Math.cos(theta);
        starPositions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        starPositions[i3 + 2] = radius * Math.cos(phi);

        const starColor = starPalette[Math.floor(Math.random() * starPalette.length)].clone();
        starColor.multiplyScalar(Math.random() * 0.7 + 0.3);
        starColors[i3] = starColor.r; starColors[i3 + 1] = starColor.g; starColors[i3 + 2] = starColor.b;
        starSizes[i] = THREE.MathUtils.randFloat(0.6, 3.0);
        starTwinkle[i] = Math.random() * Math.PI * 2;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    starGeometry.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
    starGeometry.setAttribute('twinkle', new THREE.BufferAttribute(starTwinkle, 1));

    const starMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: pixelRatio }
        },
        vertexShader: `
            uniform float uTime;
            uniform float uPixelRatio;
            attribute float size;
            attribute float twinkle;
            varying vec3 vColor;
            varying float vTwinkle;

            void main() {
                vColor = color;
                vTwinkle = sin(uTime * 2.5 + twinkle) * 0.5 + 0.5;

                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vTwinkle;

            void main() {
                float dist = distance(gl_PointCoord, vec2(0.5));
                if (dist > 0.5) discard;

                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                alpha *= (0.2 + vTwinkle * 0.8);

                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    return new THREE.Points(starGeometry, starMaterial);
}

export function animateStars(stars, elapsedTime, delta) {
    stars.material.uniforms.uTime.value = elapsedTime;
    stars.rotation.y += delta * .003;
    stars.rotation.x += delta * .001;
}
