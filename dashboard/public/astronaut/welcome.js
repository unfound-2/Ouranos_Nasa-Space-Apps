import { createMissionLogo } from './mission-logo-3d.js';

const title = document.querySelector('.welcome h1');
let crewName;
try {
  const saved = JSON.parse(sessionStorage.getItem('gg.crew-profiles') || 'null');
  crewName = saved?.profiles.find((profile) => profile.id === saved.activeId)?.name
    || JSON.parse(sessionStorage.getItem('gg.watch-sign-in') || 'null')?.name;
} catch {
  // Use the default greeting when session storage is unavailable.
}
const label = crewName ? `Welcome back, ${crewName}` : title.textContent;
const arc = document.createElement('span');
arc.className = 'welcome-title-arc';
arc.setAttribute('aria-hidden', 'true');
for (const [index, character] of Array.from(label).entries()) {
  const letter = document.createElement('span');
  const distance = 2 * index / (label.length - 1) - 1;
  letter.textContent = character === ' ' ? '\u00a0' : character;
  letter.style.transform = `translateY(${.13 * distance ** 2}em) rotate(${distance * 5}deg)`;
  arc.append(letter);
}
title.setAttribute('aria-label', label);
title.replaceChildren(arc);

const still = document.querySelector('.welcome-logo');
const pairWatch = document.querySelector('.watch-entry');
if (crewName) {
  pairWatch.querySelector('a').href = '/#/';
  pairWatch.querySelector('span').textContent = 'Mission health';
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function playIntro() {
  const veil = document.createElement('div');
  veil.className = 'intro-veil';
  veil.setAttribute('aria-hidden', 'true');

  const stage = document.createElement('div');
  stage.className = 'intro-logo';
  stage.setAttribute('aria-hidden', 'true');
  const image = still.cloneNode();
  image.removeAttribute('class');
  stage.append(image);

  await image.decode().catch(() => {});
  if (reducedMotion.matches || !image.naturalWidth || window.scrollY > 0) return;
  const progressRow = document.createElement('div');
  progressRow.className = 'intro-progress';
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 1;
  const percent = document.createElement('span');
  percent.textContent = '1%';
  progressRow.append(bar, percent);
  stage.append(progressRow);

  document.body.append(veil, stage);
  for (const element of [still, title, pairWatch]) element.style.visibility = 'hidden';

  try {
    const canvas = document.createElement('canvas');
    const bounds = stage.getBoundingClientRect();
    let logo;
    try {
      logo = createMissionLogo(canvas, bounds.width, bounds.height);
      image.replaceWith(canvas);
    } catch {
      // Keep the image when WebGL is unavailable.
    }
    try {
      await new Promise(resolve => {
        const start = performance.now();
        function draw(now) {
          const fraction = Math.min(1, (now - start) / 2000);
          const eased = fraction * fraction * (3 - 2 * fraction);
          logo?.draw(-Math.sin(Math.PI * eased) * .28, eased * Math.PI * 2);
          bar.value = Math.max(1, Math.floor(fraction * 100));
          percent.textContent = bar.value + '%';
          if (fraction < 1) requestAnimationFrame(draw);
          else resolve();
        }
        requestAnimationFrame(draw);
      });
    } finally {
      logo?.dispose();
      if (canvas.isConnected) canvas.replaceWith(image);
    }
    bar.value = 100;
    percent.textContent = '100%';
    await new Promise(resolve => setTimeout(resolve, 140));
    progressRow.remove();

    const from = stage.getBoundingClientRect();
    const to = still.getBoundingClientRect();
    const x = to.left + to.width / 2 - from.left - from.width / 2;
    const y = to.top + to.height / 2 - from.top - from.height / 2;
    const scale = to.width / from.width;

    const start = 'translate(-50%, -50%)';
    const dipped = `${start} translateY(18px) scale(${scale})`;
    const easing = 'cubic-bezier(.42,0,.22,1)';
    await stage.animate([
      { transform: start },
      { transform: dipped },
    ], { duration: 360, easing, fill: 'forwards' }).finished;

    veil.remove();
    await stage.animate([
      { transform: dipped },
      { transform: `${start} translate(${x}px, ${y}px) scale(${scale})` },
    ], { duration: 750, easing, fill: 'forwards' }).finished;

    still.style.visibility = '';
    stage.remove();

    for (const element of [pairWatch, title]) {
      element.style.visibility = '';
      await element.animate([
        { filter: 'blur(9px)', transform: 'translateY(4px)' },
        { filter: 'blur(0)', transform: 'translateY(0)' },
      ], { duration: 420, easing }).finished;
    }
  } finally {
    for (const element of [still, title, pairWatch]) element.style.visibility = '';
    veil.remove();
    stage.remove();
  }
}

if (!reducedMotion.matches && typeof still.animate === 'function') {
  playIntro().catch(() => {});
}
