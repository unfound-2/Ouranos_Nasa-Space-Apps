const title = document.querySelector('.welcome h1');
const label = title.textContent;
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
    const object = document.createElement('div');
    object.className = 'intro-logo-object';
    // The original alpha silhouette forms both faces and every slice of the extrusion.
    for (let layer = -6; layer <= 6; layer++) {
      const slice = image.cloneNode();
      slice.style.setProperty('--depth', layer * 1.15 + 'px');
      slice.style.setProperty('--light', .26 + (layer + 6) * .032);
      object.append(slice);
    }
    image.replaceWith(object);

    const spin = object.animate([
      { transform: 'rotateX(0deg) rotateY(0deg)' },
      { transform: 'rotateX(-16deg) rotateY(165deg)', offset: .44 },
      { transform: 'rotateX(0deg) rotateY(360deg)' },
    ], { duration: 2000, easing: 'cubic-bezier(.42,0,.30,1)', fill: 'forwards' });
    let progressFrame;
    function updateProgress() {
      const value = Math.max(1, Math.min(100, Math.floor(Number(spin.currentTime) / 20)));
      bar.value = value;
      percent.textContent = value + '%';
      if (value < 100) progressFrame = requestAnimationFrame(updateProgress);
    }
    updateProgress();
    try {
      await spin.finished;
    } finally {
      cancelAnimationFrame(progressFrame);
    }
    bar.value = 100;
    percent.textContent = '100%';
    await new Promise(resolve => setTimeout(resolve, 140));
    progressRow.remove();
    object.replaceWith(image);

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
