let pendingCode = new URLSearchParams(window.location.hash.slice(1)).get('pair')

if (pendingCode !== null) {
  window.history.replaceState(window.history.state, '', '#/system')
}

export function takeWatchPairingCode() {
  const code = pendingCode
  pendingCode = null
  return code
}
