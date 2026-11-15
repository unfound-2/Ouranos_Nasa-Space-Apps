let pendingCode = new URLSearchParams(window.location.hash.slice(1)).get('pair')

if (pendingCode !== null) {
  window.history.replaceState(window.history.state, '', '#/pair')
}

export function takeWatchPairingCode() {
  const code = pendingCode
  pendingCode = null
  return code
}

const sessionKey = 'gg.watch-sign-in'
let signIn: { name: string; deviceId: string } | null = null
try {
  const saved = sessionStorage.getItem(sessionKey)
  if (saved) signIn = JSON.parse(saved)
} catch {
  // The current page can still sign in when session storage is unavailable.
}

let adapterToken = ''

export function rememberWatch(name: string, deviceId: string, token: string) {
  signIn = { name, deviceId }
  adapterToken = token
  try {
    sessionStorage.setItem(sessionKey, JSON.stringify(signIn))
  } catch {
    // Keep the sign-in in memory for this page.
  }
}

export function watchSignIn() {
  return signIn
}

export function takeAdapterToken() {
  const token = adapterToken
  adapterToken = ''
  return token
}

let simulatorSignIn = false
try {
  simulatorSignIn = sessionStorage.getItem('gg.simulator-sign-in') === 'true'
} catch {
  // Session storage is optional.
}

export function rememberSimulator() {
  simulatorSignIn = true
  try {
    sessionStorage.setItem('gg.simulator-sign-in', 'true')
  } catch {
    // Keep the simulator available in memory for this page.
  }
}

export function hasSimulatorSignIn() {
  return simulatorSignIn
}
