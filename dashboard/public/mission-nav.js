const container = document.querySelector('#mission-navigation')

container.innerHTML = `
  <a class="mission-brand" href="/#/" aria-label="Ouranos overview">Ouranos</a>
  <details class="mission-nav">
    <summary aria-label="Toggle navigation">
      <img src="/astronaut/mission-logo.png" alt="" width="28" height="29">
    </summary>
    <nav aria-label="Main">
      <a class="mission-pair" href="/#/pair"><span>Pair watch</span></a>
      <a href="/#/">Overview</a>
      <a href="/#/plan">Daily plan</a>
      <a href="/#/guide">Crew guide</a>
      <a href="/#/crew">Crew Health</a>
      <a href="/#/attention">Health review</a>
      <a href="/#/system">System Status</a>
      <a href="/astronaut/">Home</a>
    </nav>
  </details>
  <details class="crew-nav"><summary>Crew</summary><div></div></details>
  <a class="mission-nav-shortcut" href="/#/pair"><span>Pair watch</span></a>
`

const menu = container.querySelector('.mission-nav')

function updateCurrentLink() {
  const current = location.pathname + location.hash
  for (const link of container.querySelectorAll('a')) {
    if (link.getAttribute('href') === current) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

history.scrollRestoration = 'manual'

try {
  menu.open = sessionStorage.getItem('gg.keep-menu-open') === '1'
  sessionStorage.removeItem('gg.keep-menu-open')
} catch {
  // The menu still works when browser storage is unavailable.
}

let lastScrollInput = -Infinity
function markScrollInput() {
  if (menu.open) lastScrollInput = performance.now()
}

window.addEventListener('wheel', (event) => {
  if (event.deltaY && !event.ctrlKey) markScrollInput()
}, { passive: true })
window.addEventListener('touchmove', markScrollInput, { passive: true })
window.addEventListener('pointerdown', (event) => {
  if (event.clientX >= document.documentElement.clientWidth) markScrollInput()
})
window.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, button, summary, [contenteditable]')) return
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markScrollInput()
})

menu.addEventListener('click', (event) => {
  if (event.target.closest('summary')) {
    lastScrollInput = -Infinity
    return
  }
  const link = event.target.closest('a')
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  lastScrollInput = -Infinity
  if (link.pathname !== location.pathname) {
    try {
      sessionStorage.setItem('gg.keep-menu-open', '1')
    } catch {
      // Other pages can still open normally.
    }
  }
})
menu.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !menu.open) return
  menu.open = false
  menu.querySelector('summary').focus()
})
window.addEventListener('scroll', () => {
  if (!menu.open || performance.now() - lastScrollInput > 750) return
  if (menu.querySelector('nav').contains(document.activeElement)) menu.querySelector('summary').focus({ preventScroll: true })
  menu.open = false
}, { passive: true })
window.addEventListener('hashchange', () => {
  lastScrollInput = -Infinity
  updateCurrentLink()
})
updateCurrentLink()

const crewNav = container.querySelector('.crew-nav')
function updateCrewMenu() {
  let crew
  let signedIn
  try {
    crew = JSON.parse(sessionStorage.getItem('gg.crew-profiles') || 'null')
    signedIn = JSON.parse(sessionStorage.getItem('gg.watch-sign-in') || 'null')
  } catch {
    // Pairing remains available without storage.
  }
  const profile = crew?.profiles.find(({ id }) => id === crew.activeId)
  crewNav.hidden = !profile && !signedIn
  container.classList.toggle('has-crew', !crewNav.hidden)
  crewNav.querySelector('summary').textContent = profile?.name || signedIn?.name || 'Crew'
  const actions = crewNav.querySelector('div')
  actions.replaceChildren()
  for (const item of crew?.profiles ?? []) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = item.name
    button.setAttribute('aria-pressed', String(item.id === crew.activeId))
    button.addEventListener('click', () => {
      sessionStorage.setItem('gg.crew-profiles', JSON.stringify({ ...crew, activeId: item.id }))
      crewNav.open = false
      window.dispatchEvent(new Event('gg:crew-change'))
      if (location.pathname === '/astronaut/') location.reload()
    })
    actions.append(button)
  }
  for (const [label, mode] of [['Add another astronaut', 'add'], ['Sync watch', 'sync']]) {
    const link = document.createElement('a')
    link.textContent = label
    link.href = '/#/pair?mode=' + mode
    link.addEventListener('click', () => { crewNav.open = false })
    actions.append(link)
  }
}
window.addEventListener('gg:crew-change', updateCrewMenu)
window.addEventListener('hashchange', updateCrewMenu)
updateCrewMenu()
