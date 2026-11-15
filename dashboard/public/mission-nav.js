const container = document.querySelector('#mission-navigation')

container.innerHTML = `
  <details class="mission-nav">
    <summary aria-label="Toggle navigation">
      <img src="/astronaut/mission-logo.png" alt="" width="28" height="29">
    </summary>
    <nav aria-label="Main">
      <a class="mission-pair" href="/#/pair"><span>Pair watch</span></a>
      <a href="/#/">Overview</a>
      <a href="/#/crew">Crew Health</a>
      <a href="/#/events">Event History</a>
      <a href="/#/system">System Status</a>
      <a href="/#/guide">Crew guide</a>
      <a href="/astronaut/">Home</a>
    </nav>
  </details>
  <a class="mission-nav-shortcut" href="/#/pair"><span>Pair watch</span></a>
`

const menu = container.querySelector('details')

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
