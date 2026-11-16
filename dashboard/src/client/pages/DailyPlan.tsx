import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, LockKeyhole, Plus, Watch } from 'lucide-react'
import { actOnPlan, clock, DaySchema, demoDay, emptyDay, proposePlan, TaskSchema, utcDay, type DayPlan, type PlanAction, type PlanTask } from '../../shared/daily-plan'
import { PageSkeleton } from '../components/Skeleton'
import { useData } from '../lib/data'
import { useCrewProfile } from '../lib/crew-profile'
import { watchSignIn } from '../lib/watch-pairing'
import { request } from '../lib/api'
import { href } from '../lib/router'
import './daily-plan.css'

const kindNames = { fixed: 'Fixed', health: 'Health routine', flexible: 'Flexible' }
const minute = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const source = 'https://www.nasa.gov/reference/6-0-medical-operations/'

export function DailyPlan() {
  const { workspace, watchLinks } = useData()
  const crew = useCrewProfile()
  const deviceId = crew?.deviceId ?? watchSignIn()?.deviceId ?? null
  const scope = `${workspace}.${crew?.id ?? deviceId ?? 'crew'}.${utcDay()}`
  const frame = watchLinks?.find(link => link.deviceId === deviceId)?.watch
  const sleep = workspace === 'mission' && frame && !frame.simulated ? frame.readings.find(r => r.metric === 'Sleep in last 24 hours' && r.quality === 'valid' && r.unit === 'h' && r.measuredAt != null && Date.now() / 1000 - r.measuredAt < 86400 && Date.now() / 1000 >= r.measuredAt) : undefined
  return <Plan key={scope} sleep={sleep ? { hours: sleep.value, at: sleep.measuredAt! } : undefined} scope={scope} deviceId={workspace === 'mission' ? deviceId : null} demo={workspace === 'demo'} />
}

function Plan({ scope, deviceId, demo, sleep }: { scope: string; deviceId: string | null; demo: boolean; sleep?: { hours: number; at: number } }) {
  const key = `gg.daily-plan.${scope}`
  const [plan, setPlan] = useState<DayPlan>(() => {
    try {
      const saved = DaySchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'))
      if (saved.success && saved.data.date === utcDay() && saved.data.simulated === demo) return saved.data
    } catch { /* An empty plan remains usable without browser storage. */ }
    return demo ? demoDay() : emptyDay()
  })
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(!deviceId)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editor, setEditor] = useState<PlanTask | 'new' | null>(null)
  const [watchConnected, setWatchConnected] = useState(false)
  const [shared, setShared] = useState(false)
  const current = useRef(plan)
  const saving = useRef(false)
  const endpoint = deviceId ? `/planner/${encodeURIComponent(deviceId)}` : null
  const proposal = proposePlan(plan)
  const tasks = [...plan.tasks].filter(t => !t.deferred).sort((a, b) => a.start - b.start)
  const deferred = plan.tasks.filter(t => t.deferred)
  const [selected, setSelected] = useState<string | null>(null)

  function display(next: DayPlan) {
    current.current = next
    setPlan(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { setMessage('Saved for this visit. Browser storage is unavailable.') }
  }

  useEffect(() => {
    if (!endpoint) return
    let active = true
    async function sync() {
      if (saving.current) return
      try {
        const remote = await request<DayPlan | null>('GET', endpoint!, undefined, '/api')
        if (!active || saving.current) return
        setShared(!!remote && remote.date === utcDay())
        if (remote) {
          const parsed = DaySchema.parse(remote)
          if (parsed.date === utcDay() && parsed.revision !== current.current.revision) display(parsed)
        }
        setReady(true)
        setWatchConnected(true)
        setError('')
      } catch (e) {
        if (active) { setWatchConnected(false); setError((e as Error).message); setReady(false) }
      }
    }
    void sync()
    const timer = window.setInterval(sync, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [endpoint])

  async function save(next: DayPlan, notice: string) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      next = DaySchema.parse(next)
      if (endpoint) {
        const remote = await request<DayPlan | null>('GET', endpoint, undefined, '/api')
        if (remote && remote.date === next.date && remote.revision !== current.current.revision) {
          display(DaySchema.parse(remote))
          throw new Error('The watch updated your plan. Review the latest version and try again.')
        }
        next = await request<DayPlan>('POST', endpoint, { plan: next, expectedRevision: remote?.revision ?? 0 }, '/api')
        setShared(true)
      } else next = { ...next, revision: current.current.revision + 1, updatedAt: new Date().toISOString() }
      display(next)
      setMessage(notice)
      return true
    } catch (e) { setError((e as Error).message); return false }
    finally { saving.current = false; setBusy(false) }
  }
  async function action(action: PlanAction) {
    try { await save(actOnPlan(current.current, action), action.type === 'checkin' ? 'Check-in recorded. Review any suggested adjustment below.' : action.type === 'done' ? 'Activity completed.' : 'Delay recorded. Review the schedule before accepting changes.') }
    catch (e) { setError((e as Error).message) }
  }
  async function submitTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const result = TaskSchema.safeParse({ id: editor !== 'new' && editor ? editor.id : crypto.randomUUID(), title: data.get('title'), start: minute(String(data.get('start'))), duration: Number(data.get('duration')), kind: data.get('kind'), note: String(data.get('note') ?? ''), done: editor !== 'new' && editor ? editor.done : false })
    if (!result.success) { setError(result.error.issues[0].message); return }
    const next = { ...plan, tasks: [...plan.tasks.filter(t => t.id !== result.data.id), result.data] }
    if (await save(next, 'Activity saved.')) setEditor(null)
  }
  const disabled = busy || !ready
  if (!ready && !error) return <PageSkeleton page="plan" />
  return <div className="daily-plan mx-auto w-full max-w-5xl">
    <header className="mission-intro">
      <h1 className="display faded-label">Daily plan</h1>
      <p>A little room for your health. Even when the day changes.</p>
    </header>
    <div className="plan-dateline"><span>{new Date(plan.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} <span className="text-ink-2">· UTC</span></span><span className="plan-sync"><Watch size={15} aria-hidden />{demo ? 'Simulated day' : watchConnected ? shared ? 'Shared with your paired watch' : 'Watch paired · save activities to share' : deviceId ? 'Connecting to watch session' : 'Saved on this browser'}</span></div>
    {error && <p className="plan-notice" role="alert">{error}</p>}
    <p className="plan-status text-ink-2" role="status">{message}</p>
    <div className="plan-layout">
      <section className="plan-card plan-agenda" aria-labelledby="agenda-heading">
        <div className="plan-card-heading"><h2 id="agenda-heading">Your day</h2><button className="btn btn-ghost btn-sm" disabled={disabled || plan.tasks.length >= 64} onClick={() => { setEditor('new'); setError('') }}><Plus size={15} aria-hidden /> Add activity</button></div>
        {!tasks.length && <div className="plan-empty"><h3>Make space for your routine.</h3><p>Add your mission commitments and existing health routine. Fixed activities stay in place; flexible ones can move.</p><button className="btn btn-ghost" disabled={disabled} onClick={() => setEditor('new')}>Add your first activity <ArrowRight size={15} aria-hidden /></button></div>}
        <ol className="plan-timeline">
          {tasks.map(t => <li key={t.id} className={`plan-row ${t.done ? 'plan-complete' : ''}`}>
            <time className="plan-time">{clock(t.start)}</time>
            <div className="plan-task-body"><button className="plan-task-toggle" aria-expanded={selected === t.id} onClick={() => setSelected(selected === t.id ? null : t.id)}><span>{t.title}</span><span className="plan-task-meta">{t.done ? <><Check size={12} aria-hidden /> Complete</> : <>{t.kind !== 'flexible' && <LockKeyhole size={11} aria-hidden />}{kindNames[t.kind]} · {t.duration} min</>}</span></button>
              {selected === t.id && <div className="plan-task-details"><p>{t.note || 'An activity from your daily plan.'}</p><p>{t.kind === 'fixed' ? 'The planner keeps this commitment in place.' : t.kind === 'health' ? 'The planner preserves this time and duration. Follow your assigned routine.' : 'The planner can propose a new time when your day changes.'}</p><div className="plan-actions">{!t.done && <><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => void action({ type: 'done', taskId: t.id })}>Mark complete</button><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => void action({ type: 'delay', taskId: t.id, minutes: 15 })}>Running 15 min late</button></>}<button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setEditor(t)}>Edit</button></div></div>}
            </div>
          </li>)}
        </ol>
        <div className="plan-sleep"><LockKeyhole size={15} aria-hidden /><span>Protect sleep from <strong>{clock(plan.sleepStart)}</strong></span><details><summary>Change</summary><form onSubmit={e => { e.preventDefault(); void save({ ...plan, sleepStart: minute(String(new FormData(e.currentTarget).get('sleep'))) || 1440 }, 'Sleep boundary updated.') }}><label>Start of your planned sleep<input className="field" name="sleep" type="time" required defaultValue={clock(plan.sleepStart % 1440)} /></label><button className="btn btn-ghost btn-sm" disabled={disabled}>Save</button></form></details></div>
        {deferred.length > 0 && <details className="plan-deferred"><summary>To schedule tomorrow · {deferred.length}</summary><p className="text-ink-2">These activities are deferred, not booked into tomorrow.</p>{deferred.map(t => <div key={t.id} className="plan-deferred-row"><span>{t.title}</span><button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => void save({ ...plan, tasks: plan.tasks.map(a => a.id === t.id ? { ...a, deferred: false } : a) }, 'Activity restored for review.')}>Restore today</button></div>)}</details>}
      </section>
      <aside className="plan-sidebar" aria-label="Health and adjustments">
        <section className="plan-card"><h2>How are you feeling?</h2><p className="text-ink-2">A quick check-in helps make room in your day.</p>{sleep && <p className="plan-sleep-record"><strong>{sleep.hours.toFixed(1)} h</strong> recorded sleep in the last 24 hours.<br /><small>Watch record · {new Date(sleep.at * 1000).toLocaleString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC</small></p>}<div className="plan-checkin">{([['rested', 'Rested'], ['somewhat', 'Somewhat tired'], ['very', 'Very tired']] as const).map(([value, label]) => <button className="btn btn-ghost" key={value} aria-pressed={plan.fatigue === value} disabled={disabled} onClick={() => void action({ type: 'checkin', fatigue: value })}>{label}{plan.fatigue === value && <Check size={14} aria-hidden />}</button>)}</div><p className="plan-footnote">Your report, not a diagnosis. Also available on your watch.</p></section>
        <section className="plan-card" aria-labelledby="adjustment-heading"><h2 id="adjustment-heading">{proposal.changes.length ? 'A little more room.' : 'Room to adjust.'}</h2>{proposal.changes.length ? <><p className="text-ink-2">Review before anything moves.</p>{proposal.changes.map(c => <div className="plan-change" key={c.id}><h3>{c.title}</h3><p className="plan-change-time"><span>{c.before}</span><ArrowRight size={14} aria-hidden /><strong>{c.after}</strong></p><p className="text-ink-2">{c.reason}</p></div>)}<button className="btn btn-primary plan-accept" disabled={disabled || !!proposal.conflicts.length} onClick={() => void save({ ...plan, tasks: proposal.tasks, fatigueReviewed: true }, 'Changes accepted. Your plan is up to date.')}>Accept {proposal.changes.length === 1 ? 'change' : 'changes'} <ArrowRight size={15} aria-hidden /></button><button className="btn btn-ghost plan-accept" disabled={disabled} onClick={() => void save({ ...plan, fatigueReviewed: true }, 'Current times kept. Any remaining conflicts still need review.')}>Keep current times</button></> : <p className="text-ink-2">{tasks.length ? 'Report fatigue or a delay to review flexible activities. Your health routine and fixed commitments stay protected.' : 'Add your day to see where adjustments could help.'}</p>}{proposal.conflicts.map(c => <p className="plan-conflict" key={c}>{c}</p>)}</section>
        <details className="plan-card plan-explainer"><summary>Why protect this time?</summary><p>Sleep, workload and fatigue management belong in the crew schedule. This planner checks timing conflicts and suggests changes to flexible activities; it does not change your medical or exercise plan.</p><a href={source} target="_blank" rel="noreferrer">NASA · Medical operations ↗</a><a href={href.guide}>Open crew guide <ArrowRight size={13} aria-hidden /></a></details>
      </aside>
    </div>
    {editor && <section className="plan-card plan-editor" aria-labelledby="activity-editor"><h2 id="activity-editor">{editor === 'new' ? 'Add activity' : 'Edit activity'}</h2><form key={editor === 'new' ? 'new' : editor.id} onSubmit={e => void submitTask(e)}><label>Activity<input autoFocus className="field" name="title" maxLength={100} required defaultValue={editor === 'new' ? '' : editor.title} placeholder="e.g. Prescribed exercise" /></label><div className="plan-form-grid"><label>Start · UTC<input className="field" name="start" type="time" required defaultValue={editor === 'new' ? '13:00' : clock(editor.start)} /></label><label>Duration · minutes<input className="field" name="duration" type="number" required min={5} max={720} defaultValue={editor === 'new' ? 30 : editor.duration} /></label><label>Schedule rule<select className="field" name="kind" defaultValue={editor === 'new' ? 'flexible' : editor.kind}><option value="flexible">Flexible</option><option value="fixed">Fixed commitment</option><option value="health">Health routine</option></select></label></div><label>Instructions or context<textarea className="field" name="note" maxLength={400} rows={2} defaultValue={editor === 'new' ? '' : editor.note} placeholder="Use instructions from your existing mission plan." /></label><div className="plan-actions"><button className="btn btn-primary" disabled={disabled}>Save activity</button><button type="button" className="btn btn-ghost" onClick={() => setEditor(null)}>Cancel</button>{editor !== 'new' && <button type="button" className="btn btn-ghost" disabled={disabled} onClick={async () => { if (await save({ ...plan, tasks: plan.tasks.filter(t => t.id !== editor.id) }, 'Activity removed.')) setEditor(null) }}>Remove activity</button>}</div></form></section>}
    {demo && <p className="plan-footnote text-center">Example schedule and durations for demonstration. No assigned medical plan.</p>}
  </div>
}
