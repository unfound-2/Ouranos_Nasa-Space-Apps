import { useEffect, useState, type FormEvent } from 'react'
import earth from '../assets/earth-horizon.webp'
import { api, request } from '../lib/api'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { rememberSimulator, rememberWatch, takeWatchPairingCode } from '../lib/watch-pairing'
import './pair-watch.css'

export function PairWatch() {
  const { workspace, setWorkspace, refresh } = useData()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<'watch' | 'demo' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const sharedCode = takeWatchPairingCode()
    if (sharedCode !== null) setCode(sharedCode)
  }, [])

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !code.trim() || pending) return
    setPending('watch')
    setError('')
    try {
      const paired = await request<{ deviceId: string; adapterToken: string }>('POST', '/pairing/redeem', { code }, '/api')
      rememberWatch(name.trim(), paired.deviceId, paired.adapterToken)
      if (workspace !== 'mission') setWorkspace('mission')
      await refresh()
      navigate(href.system)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not pair the watch.')
    } finally {
      setPending(null)
    }
  }

  async function runSimulator() {
    if (pending) return
    setPending('demo')
    setError('')
    try {
      const { dataset } = await api.snapshot('demo')
      if (Object.keys(dataset.sessions).length === 0) await api.demoReset()
      rememberSimulator()
      if (workspace !== 'demo') setWorkspace('demo')
      await refresh()
      navigate(href.overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the simulator.')
    } finally {
      setPending(null)
    }
  }

  return (
    <main className="pair-page">
      <section className="pair-card" aria-labelledby="pair-title">
        <img className="pair-card-image" src={earth} alt="" />
        <img className="pair-card-image pair-card-image-blur" src={earth} alt="" />
        <h1 id="pair-title" className="faded-label">Pair watch</h1>
        <form onSubmit={pair}>
          <label>
            <span className="faded-label">What’s your name?</span>
            <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </label>
          <label>
            <span className="faded-label">What’s your watch code?</span>
            <input className="pair-code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE-12345" value={code} onChange={(event) => setCode(event.target.value)} maxLength={24} required />
          </label>
          <button className="watch-cta" disabled={pending !== null || !name.trim() || !code.trim()}>
            <span>{pending === 'watch' ? 'Pairing…' : 'Pair watch'}</span>
          </button>
        </form>
      </section>
      <p className="pair-simulator faded-label">Don’t have a watch? Run our simulator with simulated information to see how the experience works.</p>
      <button className="watch-cta" onClick={runSimulator} disabled={pending !== null}>
        <span>{pending === 'demo' ? 'Opening simulator…' : 'Run simulator'}</span>
      </button>
      {error && <p role="alert" className="pair-error">{error}</p>}
    </main>
  )
}
