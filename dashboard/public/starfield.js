import * as THREE from './astronaut/black-hole-engine.js';
import { createStars, animateStars } from './astronaut/star-particles.js';

function mountStarfield(canvas) {
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, powerPreference: 'low-power' });
    } catch {
        return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const stars = createStars(renderer.getPixelRatio(), 12000);
    const scene = new THREE.Scene();
    scene.add(stars);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 4000);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let elapsed = 0;
    let previousTime = 0;
    let frame;

    function resize() {
        const { clientWidth: width, clientHeight: height } = canvas;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }

    function animate(now) {
        frame = requestAnimationFrame(animate);
        const delta = (now - previousTime) / 1000;
        if (delta < 1 / 30) return;
        previousTime = now;
        elapsed += Math.min(delta, .08);
        animateStars(stars, elapsed, delta);
        renderer.render(scene, camera);
    }

    function syncAnimation() {
        cancelAnimationFrame(frame);
        if (reducedMotion.matches || document.hidden) return;
        previousTime = performance.now();
        frame = requestAnimationFrame(animate);
    }

    new ResizeObserver(resize).observe(canvas);
    reducedMotion.addEventListener('change', syncAnimation);
    document.addEventListener('visibilitychange', syncAnimation);
    syncAnimation();
}

const canvas = document.querySelector('.site-stars');
if (canvas) mountStarfield(canvas);
