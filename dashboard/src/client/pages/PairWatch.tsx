import { useEffect, useState, type FormEvent } from 'react'
import earth from '../assets/earth-horizon.webp'
import { api, request } from '../lib/api'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { rememberSimulator, rememberWatch, takeWatchPairingCode, watchSignIn } from '../lib/watch-pairing'
import { currentCrew, saveCrew, type CrewProfile } from '../lib/crew-profile'
import './pair-watch.css'

export function PairWatch() {
  const { workspace, setWorkspace, refresh } = useData()
  const mode = new URLSearchParams(location.hash.split('?')[1]).get('mode')
  const previousSignIn = watchSignIn()
  const active = currentCrew() ?? (previousSignIn ? { ...previousSignIn, id: previousSignIn.deviceId } : null)
  const sync = mode === 'sync' && active !== null
  const add = mode === 'add'
  const [name, setName] = useState(sync ? active.name : '')
  const [setup, setSetup] = useState<{ deviceId: string | null; demo: boolean } | null>(null)
  const [history, setHistory] = useState('')
  const [limitations, setLimitations] = useState('')
  const [notes, setNotes] = useState('')
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
      if (sync) {
        saveCrew({ ...active, deviceId: paired.deviceId })
        if (workspace !== 'mission') setWorkspace('mission')
        await refresh()
        navigate(href.overview)
      } else {
        setSetup({ deviceId: paired.deviceId, demo: false })
      }
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
      if (active && !add) {
        if (workspace !== 'demo') setWorkspace('demo')
        navigate(href.overview)
      } else {
        setSetup({ deviceId: null, demo: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the simulator.')
    } finally {
      setPending(null)
    }
  }

  function finishSetup(profile: Partial<Pick<CrewProfile, 'history' | 'limitations' | 'notes'>> = {}) {
    if (!setup) return
    saveCrew({ id: crypto.randomUUID(), name: name.trim() || 'Astronaut', deviceId: setup.deviceId, ...profile })
    const next = setup.demo ? 'demo' : 'mission'
    if (workspace !== next) setWorkspace(next)
    void refresh()
    navigate(href.overview)
  }

  if (setup) return (
    <main className="pair-page">
      <section className="pair-card crew-setup" aria-labelledby="setup-title">
        <h1 id="setup-title" className="faded-label">Crew setup</h1>
        <form onSubmit={(event) => { event.preventDefault(); finishSetup({ history, limitations, notes }) }}>
          {setup.demo && <label>Name <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>}
          <label>Any existing conditions the crew should account for?
            <select value={history} onChange={(event) => setHistory(event.target.value)}>
              <option value="">Choose an answer</option><option>No</option><option>Yes</option><option>Prefer not to say</option>
            </select>
          </label>
          <label>Any activity restrictions?
            <select value={limitations} onChange={(event) => setLimitations(event.target.value)}>
              <option value="">Choose an answer</option><option>No</option><option>Yes</option><option>Prefer not to say</option>
            </select>
          </label>
          <label>Anything else the crew should know?
            <textarea rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <p className="text-ink-2 text-sm">Optional. Answers stay in this browser tab’s session.</p>
          <button className="watch-cta"><span>Finish setup</span></button>
          <button type="button" className="text-ink-2 underline" onClick={() => finishSetup()}>Skip questions</button>
        </form>
      </section>
    </main>
  )

  return (
    <main className="pair-page">
      <section className="pair-card" aria-labelledby="pair-title">
        <img className="pair-card-image" src={earth} alt="" />
        <img className="pair-card-image pair-card-image-blur" src={earth} alt="" />
        <h1 id="pair-title" className="faded-label">{sync ? 'Sync watch' : add ? 'Add another astronaut' : 'Pair watch'}</h1>
        <form onSubmit={pair}>
          {!sync && <label>
            <span className="faded-label">What’s your name?</span>
            <input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </label>}
          <label>
            <span className="faded-label">What’s your watch code?</span>
            <input className="pair-code" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE-12345" value={code} onChange={(event) => setCode(event.target.value)} maxLength={24} required />
          </label>
          <button className="watch-cta" disabled={pending !== null || !name.trim() || !code.trim()}>
            <span>{pending === 'watch' ? 'Syncing…' : sync ? 'Sync watch' : 'Continue'}</span>
          </button>
        </form>
      </section>
      {add && <button className="watch-cta" disabled={!name.trim() || pending !== null} onClick={() => setSetup({ deviceId: null, demo: workspace === 'demo' })}><span>Continue without a watch</span></button>}
      {!add && !sync && <><p className="pair-simulator faded-label">Don’t have a watch? Run our simulator with simulated information to see how the experience works.</p>
      <button className="watch-cta" onClick={runSimulator} disabled={pending !== null}>
        <span>{pending === 'demo' ? 'Opening simulator…' : 'Run simulator'}</span>
      </button>
      </>}
      {error && <p role="alert" className="pair-error">{error}</p>}
    </main>
  )
}
