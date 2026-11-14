import { ArrowLeft, Check, ClipboardCheck, Download, Hand } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { BASELINE_EXCLUSION_LABEL, EXCLUSION_LABEL, RULES, type PhaseComparison } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { REVIEW_CHECKLIST, type Dataset, type ResolvedEvidence } from '../../shared/dataset'
import { buildEventContext, explainEvent, knownsAndUnknowns, reasonInfo, timelineFor, type EventContext, type Fact } from '../../shared/explain'
import { plural, signed, SYMPTOM_LABEL, utcStamp, utcTime } from '../../shared/format'
import { BaselineChart } from '../components/BaselineChart'
import { ackLabel, Timeline } from '../components/Events'
import { HrChart } from '../components/HrChart'
import { Empty, KV, Panel, Pill, RealTag, SimTag, TONE } from '../components/ui'
import { ApiError } from '../lib/api'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SOURCE_META, STATUS_META, subjectLabel } from '../lib/view'
import { CrewReport, headlineFor } from './Overview'

function EvidenceItem({ r }: { r: ResolvedEvidence }) {
  if (!r.found)
    return (
      <div className="text-[12px] text-amber">
        Cited {r.kind.toLowerCase()} {r.ref.refId ? <span className="font-mono">{r.ref.refId}</span> : null} is not available ·{' '}
        {r.reason === 'SESSION_NOT_RECEIVED' ? 'the session record has not been received' : 'not found in the stored records'}
      </div>
    )
  switch (r.kind) {
    case 'SYMPTOM':
      return (
        <div className="text-[12.5px]">
          <span className="font-bold text-coral">{SYMPTOM_LABEL[r.symptom.code]}</span>
          <span className="text-ink-2"> — {r.symptom.reportedBy === 'SELF_REPORTED' ? 'self-reported' : 'crew-observed'} at {utcTime(r.symptom.reportedAt)}</span>
          {r.symptom.phase && <span className="text-ink-3"> · {r.symptom.phase.toLowerCase()} phase</span>}
          {r.symptom.note && <div className="text-[12px] text-ink-3">“{r.symptom.note}”</div>}
        </div>
      )
    case 'MEASUREMENT': {
      const m = r.measurement
      return (
        <div className="text-[12.5px]">
          <span className="font-bold text-ink">
            {m.indicator.replace(/_/g, ' ').toLowerCase()} {m.value ?? '--'} {m.unit}
          </span>
          <span className="text-ink-2">
            {' '}
            · {m.source.device ?? m.source.kind} · measured {utcStamp(m.measuredAt)} · quality {m.quality.toLowerCase()}
          </span>
          {r.ref.note && <div className="text-[12px] text-ink-3">{r.ref.note}</div>}
        </div>
      )
    }
    case 'PHASE':
      return (
        <div className="text-[12.5px] text-ink-2">
          <span className="font-bold text-ink">{r.phase.phase} phase</span> {utcTime(r.phase.startedAt)} → {r.phase.endedAt ? utcTime(r.phase.endedAt) : 'no end time'}
        </div>
      )
    case 'SESSION':
      return (
        <div className="text-[12.5px] text-ink-2">
          Session <span className="font-mono text-[11.5px]">{r.session.sessionId}</span> · {utcStamp(r.session.startedAt)}
        </div>
      )
    case 'DEVICE':
      return <div className="text-[12.5px] text-ink-2">Device {r.device.deviceId} · last seen {utcStamp(r.device.lastSeenAt)}</div>
  }
}

function WhyFlagged({ ctx }: { ctx: EventContext }) {
  const sentences = explainEvent(ctx)
  return (
    <Panel title="Why this was flagged" meta={<span className="text-[11.5px] text-ink-3">From the event’s own reason codes</span>} className="lg:col-span-5">
      <div data-testid="explanation">
        <p className="text-[15px] leading-relaxed font-bold text-ink">{sentences[0]}</p>
        <div className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink-2">
          {sentences.slice(1).map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      </div>
      <div className="mt-5 border-t border-hair pt-4">
        <div className="micro mb-3">Reason codes and the records behind them</div>
        <ul className="space-y-3" data-testid="reason-codes">
          {ctx.event.reasonCodes.map((code) => {
            const info = reasonInfo(code)
            const ev = ctx.evidence.filter((e) => e.ref.reasonCode === code)
            return (
              <li key={code} className="well px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-line bg-void px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink">{code}</span>
                  <span className="text-[12.5px] text-ink">{info.known ? info.label : 'Unrecognised code'}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-ink-3">{info.meaning}</p>
                <div className="mt-2 space-y-1.5">
                  {ev.length ? ev.map((r, i) => <EvidenceItem key={i} r={r} />) : <div className="text-[12px] text-ink-3">The event cites no record for this code.</div>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </Panel>
  )
}

function WatchSummaryCheck({ session, c }: { session: StoredSession; c: PhaseComparison }) {
  const s = session.summary
  if (!s) return <p className="text-[11.5px] text-ink-3">The watch sent no summary of its own for this session.</p>
  const same = s.restMedianBpm === c.restMedian && s.recoveryMedianBpm === c.recoveryMedian && s.deltaBpm === c.observedDelta
  return (
    <p className={`text-[11.5px] ${same ? 'text-ink-3' : 'text-amber'}`} data-testid="summary-check">
      Watch summary: rest {s.restMedianBpm ?? '--'}, recovery {s.recoveryMedianBpm ?? '--'}, difference {s.deltaBpm === null ? '--' : signed(s.deltaBpm)} bpm ·{' '}
      {same ? 'matches this computer’s recalculation.' : 'differs from this computer’s recalculation; check the watch rules or the transfer.'}
    </p>
  )
}

export function RecoveryPanel({ session, c, className = '' }: { session: StoredSession | null; c: PhaseComparison | null; className?: string }) {
  return (
    <Panel title="Recovery heart rate" meta={session?.isSimulated ? <SimTag /> : session ? <RealTag /> : undefined} className={className}>
      {!session || !c ? (
        <Empty title="Session record not received">The event arrived without its session, so there are no readings to show. Nothing is estimated in their place.</Empty>
      ) : (
        <>
          {c.status === 'CALCULATED' ? (
            <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hair bg-hair sm:grid-cols-4" data-testid="phase-stats">
              {[
                ['Rest median', `${c.restMedian} bpm`, `${plural(c.rest.valid.length, 'valid reading')}`],
                ['Recovery median', `${c.recoveryMedian} bpm`, `${plural(c.recovery.valid.length, 'valid reading')}`],
                ['Observed difference', `${signed(c.observedDelta)} bpm`, 'Recovery − rest, descriptive'],
                ['Left out', `${c.rest.excluded.length + c.recovery.excluded.length}`, 'Readings not used'],
              ].map(([k, v, sub]) => (
                <div key={k} className="bg-panel px-4 py-3">
                  <dt className="micro">{k}</dt>
                  <dd className="mt-1.5 text-[20px] leading-none font-bold text-ink">{v}</dd>
                  <dd className="mt-1.5 text-[11px] text-ink-3">{sub}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mb-4 rounded-xl border border-amber/40 bg-amber/[0.07] px-4 py-3" data-testid="insufficient">
              <div className="text-[12px] font-bold tracking-[0.14em] text-amber uppercase">Insufficient samples to calculate phase comparison</div>
              <p className="mt-1 text-[12.5px] text-ink-2">
                Rest has {plural(c.rest.valid.length, 'valid reading')}, recovery has {plural(c.recovery.valid.length, 'valid reading')}. At least {RULES.minValidSamplesPerPhase} are needed in each
                phase. No difference is shown.
              </p>
            </div>
          )}
          <HrChart session={session} comparison={c} />
          <div className="mt-3 space-y-1">
            <p className="text-[11.5px] text-ink-3">Medians use valid readings timestamped inside each recorded phase. The difference is descriptive and is not a clinical threshold.</p>
            <WatchSummaryCheck session={session} c={c} />
          </div>
        </>
      )}
    </Panel>
  )
}

function FactList({ facts, mark }: { facts: Fact[]; mark: 'known' | 'unknown' }) {
  return (
    <ul className="space-y-2.5">
      {facts.map((f) => (
        <li key={f.id} className="flex gap-2.5 text-[12.5px] leading-snug" data-testid={`fact-${f.id}`}>
          <span
            className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${mark === 'known' ? 'bg-mint' : f.kind === 'limit' ? 'bg-ink-3' : 'bg-amber'}`}
            aria-hidden
          />
          <span className={mark === 'known' ? 'text-ink' : 'text-ink-2'}>
            {f.text}
            {f.kind === 'limit' && <span className="ml-1.5 text-[10px] tracking-[0.14em] text-ink-3 uppercase">Not measured</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function KnowPanel({ ctx }: { ctx: EventContext }) {
  const k = knownsAndUnknowns(ctx)
  return (
    <Panel title="What we know / what we don't know" className="lg:col-span-4">
      <div className="grid gap-5" data-testid="knowns">
        <div>
          <div className="micro mb-2.5 text-mint">What we know</div>
          <FactList facts={k.known} mark="known" />
        </div>
        <div className="border-t border-hair pt-4">
          <div className="micro mb-2.5 text-amber">What we don’t know</div>
          <FactList facts={k.unknown} mark="unknown" />
        </div>
      </div>
    </Panel>
  )
}

export function HistoryPanel({ ctx, className = '' }: { ctx: Pick<EventContext, 'baseline' | 'session' | 'comparison'>; className?: string }) {
  const b = ctx.baseline
  const s = ctx.session
  return (
    <Panel title="Personal history" className={className} meta={b ? <Pill tone={b.status === 'ESTABLISHED' ? 'cyan' : 'muted'}>{b.status === 'ESTABLISHED' ? 'Baseline established' : 'Not established'}</Pill> : undefined}>
      {!b || !s ? (
        <Empty title="No session to compare" />
      ) : (
        <div data-testid="history">
          {b.status === 'ESTABLISHED' ? (
            <p className="text-[13px] text-ink-2">
              Baseline <span className="font-bold text-ink">{signed(b.baselineDelta ?? 0)} bpm</span>: median recovery − rest difference of the {b.used.length} most recent of{' '}
              {plural(b.compatibleCount, 'earlier comparable session')}.
              {b.differenceFromBaseline !== null && (
                <>
                  {' '}
                  This session: <span className="font-bold text-ink">{signed(b.currentDelta ?? 0)} bpm</span>, {signed(b.differenceFromBaseline)} bpm from the baseline. Descriptive only.
                </>
              )}
            </p>
          ) : (
            <div className="rounded-xl border border-line px-4 py-3">
              <div className="text-[12px] font-bold tracking-[0.14em] text-ink uppercase">Personal baseline not established</div>
              <p className="mt-1 text-[12.5px] text-ink-2">
                {b.compatibleCount} of {b.required} earlier comparable sessions. A baseline needs {b.required} {s.isSimulated ? 'simulated' : 'genuine'} sessions with the same protocol and enough readings.
              </p>
            </div>
          )}
          {(b.used.length > 0 || ctx.comparison?.status === 'CALCULATED') && (
            <div className="mt-4">
              <BaselineChart
                prior={b.used}
                current={ctx.comparison?.status === 'CALCULATED' ? { sessionId: s.sessionId, startedAt: s.startedAt, observedDelta: ctx.comparison.observedDelta } : null}
                baseline={b.baselineDelta}
              />
            </div>
          )}
          {b.used.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Sessions compared" data-testid="compared-sessions">
              {b.used.map((u) => (
                <li key={u.sessionId}>
                  <span className="tnum text-ink-3">{utcStamp(u.startedAt).slice(5, 10)}</span> <span className="font-bold text-ink">{signed(u.observedDelta)}</span> bpm
                </li>
              ))}
            </ul>
          )}
          {b.excluded.length > 0 && (
            <details className="mt-3 text-[12px] text-ink-3">
              <summary className="cursor-pointer text-ink-2">{plural(b.excluded.length, 'other session')} not compared</summary>
              <ul className="mt-2 space-y-1">
                {b.excluded.map((x) => (
                  <li key={x.sessionId}>
                    <span className="tnum text-[11px]">{utcStamp(x.startedAt).slice(0, 16)}</span> · {BASELINE_EXCLUSION_LABEL[x.reason]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  )
}

function ReviewWorkflow({ event }: { event: StoredEvent }) {
  const { actions } = useData()
  const r = event.review
  const [checked, setChecked] = useState<string[]>(r.checkedItems)
  const [reviewer, setReviewer] = useState(r.reviewer ?? '')
  const [notes, setNotes] = useState(r.notes ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const locked = r.state === 'REVIEWED' || r.state === 'CLOSED'
  const all = REVIEW_CHECKLIST.items.every((i) => checked.includes(i.id))

  async function run(kind: 'SAVE_PROGRESS' | 'MARK_REVIEWED' | 'CLOSE') {
    setBusy(kind)
    setErr(null)
    try {
      if (kind === 'CLOSE') await actions.review(event.eventId, { action: 'CLOSE', reviewer: reviewer.trim(), notes: notes.trim() || null })
      else if (kind === 'MARK_REVIEWED') await actions.review(event.eventId, { action: 'MARK_REVIEWED', reviewer: reviewer.trim(), checkedItems: checked, notes: notes.trim() || null })
      else await actions.review(event.eventId, { action: 'SAVE_PROGRESS', reviewer: reviewer.trim() || null, checkedItems: checked, notes: notes.trim() || null })
    } catch (e) {
      setErr(e instanceof ApiError ? `${e.message}${e.details.length ? ` (${e.details.join('; ')})` : ''}` : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" data-testid="review-workflow">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11.5px] text-ink-2">
            {REVIEW_CHECKLIST.id} · v{REVIEW_CHECKLIST.version}
          </span>
          <Pill tone={REVIEW_META[r.state].tone}>{REVIEW_META[r.state].label}</Pill>
        </div>
        <p className="mt-2 max-w-[70ch] text-[12px] text-ink-3">{REVIEW_CHECKLIST.disclaimer}</p>
        <ol className="mt-4 space-y-2">
          {REVIEW_CHECKLIST.items.map((item, i) => {
            const on = checked.includes(item.id)
            return (
              <li key={item.id}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${on ? 'border-violet/45 bg-violet/[0.08]' : 'border-hair hover:border-line'} ${locked ? 'cursor-default opacity-80' : ''}`}>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    disabled={locked}
                    onChange={() => setChecked((c) => (c.includes(item.id) ? c.filter((x) => x !== item.id) : [...c, item.id]))}
                    data-testid={`check-${item.id}`}
                  />
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border peer-focus-visible:outline-2 peer-focus-visible:outline-cyan ${on ? 'border-violet bg-violet text-void' : 'border-line'}`} aria-hidden>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="text-[13px] text-ink">
                    <span className="mr-2 font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                    {item.text}
                  </span>
                </label>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="micro">Reviewer (name or role)</span>
          <input className="field" value={reviewer} disabled={r.state === 'CLOSED'} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. Crew medical officer" data-testid="reviewer" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Notes</span>
          <textarea className="field h-24 resize-none py-2" value={notes} disabled={r.state === 'CLOSED'} onChange={(e) => setNotes(e.target.value)} placeholder="What was looked at, who was told" />
        </label>
        <div className="flex flex-wrap gap-2">
          {!locked && (
            <>
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('SAVE_PROGRESS')}>
                {busy === 'SAVE_PROGRESS' ? 'Saving' : 'Save progress'}
              </button>
              <button className="btn btn-primary" disabled={!!busy || !all || !reviewer.trim()} onClick={() => run('MARK_REVIEWED')} data-testid="mark-reviewed">
                <ClipboardCheck size={15} /> {busy === 'MARK_REVIEWED' ? 'Saving' : 'Mark reviewed'}
              </button>
            </>
          )}
          {r.state === 'REVIEWED' && (
            <button className="btn btn-ghost" disabled={!!busy || !reviewer.trim()} onClick={() => run('CLOSE')} data-testid="close-event">
              {busy === 'CLOSE' ? 'Closing' : 'Close event'}
            </button>
          )}
        </div>
        {!locked && !all && <p className="text-[11.5px] text-ink-3">Mark reviewed needs every checklist item and a reviewer.</p>}
        {r.reviewedAt && (
          <p className="text-[12px] text-mint">
            Reviewed by {r.reviewer} at {utcStamp(r.reviewedAt)}. This records a review; it is not a medical clearance.
          </p>
        )}
        {r.closedAt && <p className="text-[12px] text-ink-2">Closed at {utcStamp(r.closedAt)}.</p>}
        {err && (
          <p className="text-[12px] text-coral" role="alert">
            {err}
          </p>
        )}
        <div className="mt-1 rounded-xl border border-hair px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
          Acknowledged on the watch means the wearer saw the alert. Reviewed means a person on this computer went through the evidence. Neither is a diagnosis or a clearance.
        </div>
      </div>
    </div>
  )
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Investigation({ id }: { id: string }) {
  const { snapshot, workspace, setWorkspace, actions } = useData()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [ackBusy, setAckBusy] = useState(false)
  const reviewRef = useRef<HTMLDivElement>(null)
  // Own-property lookup: the id comes from the URL, and ids like "constructor" must not hit Object.prototype.
  const event = snapshot && Object.hasOwn(snapshot.dataset.events, id) ? snapshot.dataset.events[id] : undefined
  useEffect(() => {
    if (event && event.review.state !== 'NOT_STARTED') setReviewOpen(true)
  }, [event?.eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!snapshot) return null
  const ds: Dataset = snapshot.dataset
  if (!event) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Empty
          title="Event not found"
          action={
            <div className="flex gap-3">
              <a className="btn btn-ghost" href={href.events}>
                Event history
              </a>
              <button className="btn btn-sim" onClick={() => setWorkspace(workspace === 'demo' ? 'mission' : 'demo')}>
                Look in {workspace === 'demo' ? 'mission records' : 'the simulated demo'}
              </button>
            </div>
          }
        >
          No event <span className="font-mono">{id}</span> in {workspace === 'demo' ? 'the simulated demo' : 'mission records'}.
        </Empty>
      </div>
    )
  }

  const ctx = buildEventContext(event, ds, snapshot.serverTime)
  const cat = CATEGORY_META[event.category]
  const status = STATUS_META[event.status]
  const ack = ackLabel(event)
  const canSimAck = event.isSimulated && event.delivery.state === 'PRESENTED' && !event.acknowledgement
  const openReview = () => {
    setReviewOpen(true)
    requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="flex flex-col gap-5" data-testid="investigation">
      <section className={`panel rise relative overflow-hidden px-6 py-5`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${TONE[cat.tone].stroke}, transparent 70%)` }} aria-hidden />
        <a href={href.events} className="micro inline-flex items-center gap-1.5 hover:text-ink-2">
          <ArrowLeft size={12} /> Event history
        </a>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[12px] font-bold tracking-[0.18em] uppercase ${TONE[cat.tone].text}`}>{cat.title}</span>
              {event.isSimulated ? <SimTag /> : <RealTag />}
            </div>
            <h1 className="mt-2 text-[clamp(20px,2.1vw,27px)] leading-tight font-bold text-ink">{headlineFor(event, ds)}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={openReview} data-testid="open-review">
              <ClipboardCheck size={15} /> Open review workflow
            </button>
            {canSimAck && (
              <button
                className="btn btn-sim"
                disabled={ackBusy}
                onClick={async () => {
                  setAckBusy(true)
                  try {
                    await actions.simulateAck(event.eventId)
                  } finally {
                    setAckBusy(false)
                  }
                }}
              >
                <Hand size={15} /> Simulate watch acknowledgement
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => download(`${event.eventId}.json`, { exportedBy: 'gravityguard-mission-dashboard', event, session: ctx.session, linkedReadings: ctx.readings })}
            >
              <Download size={15} /> Export record
            </button>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-4 xl:grid-cols-7" data-testid="event-header">
          <KV k="Event ID" mono>
            {event.eventId}
          </KV>
          <KV k="Astronaut">{subjectLabel(event.subjectId)}</KV>
          <KV k="Created (UTC)">
            {utcStamp(event.createdAt)}
          </KV>
          <KV k="Status">
            <Pill tone={status.tone}>{status.label}</Pill>
          </KV>
          <KV k="Trigger source">
            {ORIGIN_LABEL[event.origin.kind]}
            {event.origin.ruleSet ? <span className="text-ink-3"> · {event.origin.ruleSet}</span> : null}
          </KV>
          <KV k="Data">
            <span className={TONE[SOURCE_META[ctx.sourceMode].tone].text}>{event.isSimulated ? 'SIMULATED' : `REAL · ${ctx.sourceMode}`}</span>
          </KV>
          <KV k="Acknowledgement">
            <span className={TONE[ack.tone].text}>{ack.text}</span>
          </KV>
        </dl>
      </section>

      <section className="grid gap-5 lg:grid-cols-12">
        <WhyFlagged ctx={ctx} />
        <RecoveryPanel session={ctx.session} c={ctx.comparison} className="lg:col-span-7" />
      </section>

      <section className="grid gap-5 lg:grid-cols-12">
        <Panel title="Crew health report" className="ticks lg:col-span-4">
          <CrewReport ds={ds} session={ctx.session} subjectId={event.subjectId} compact />
        </Panel>
        <KnowPanel ctx={ctx} />
        <HistoryPanel ctx={ctx} className="lg:col-span-4" />
      </section>

      <div ref={reviewRef} className="scroll-mt-40">
        {reviewOpen ? (
          <Panel title="Review workflow" meta={<span className="text-[11.5px] text-ink-3">Offline · stored on this computer</span>}>
            <ReviewWorkflow key={`${event.eventId}-${event.review.updatedAt ?? 'new'}`} event={event} />
          </Panel>
        ) : (
          <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="label text-ink">Review workflow</div>
              <div className="mt-1 text-[12.5px] text-ink-3">{REVIEW_META[event.review.state].label}. The checklist works offline and records who reviewed what, and when.</div>
            </div>
            <button className="btn btn-ghost" onClick={openReview}>
              Open review workflow
            </button>
          </div>
        )}
      </div>

      <section className="grid gap-5 lg:grid-cols-12">
        <Panel title="Event activity" className="lg:col-span-5">
          <Timeline items={timelineFor(event, ctx.session)} />
        </Panel>
        <Panel title="Source record" className="lg:col-span-7" meta={<span className="text-[11.5px] text-ink-3">Exactly as stored · provenance included</span>}>
          <details className="group">
            <summary className="cursor-pointer text-[12.5px] text-ink-2 hover:text-ink">Show the stored event and session JSON</summary>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-hair bg-void p-4 font-mono text-[11px] leading-relaxed text-ink-2">
              {JSON.stringify({ event, session: ctx.session ? { ...ctx.session, measurements: `${ctx.session.measurements.length} readings (see the chart table)` } : null }, null, 2)}
            </pre>
          </details>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KV k="Ingest path">{event.provenance.ingestPath ?? 'Created on this computer'}</KV>
            <KV k="Received">
              {event.provenance.receivedAt ? utcStamp(event.provenance.receivedAt) : '--'}
            </KV>
            <KV k="Import file">{event.provenance.importFileName ?? '--'}</KV>
          </dl>
          {ctx.session && ctx.comparison && ctx.comparison.rest.excluded.length + ctx.comparison.recovery.excluded.length > 0 && (
            <p className="mt-3 text-[11.5px] text-ink-3">
              Left out of the medians:{' '}
              {[...ctx.comparison.rest.excluded, ...ctx.comparison.recovery.excluded].map((x) => `${x.measurement.measurementId} (${EXCLUSION_LABEL[x.reason].toLowerCase()})`).join(', ')}.
            </p>
          )}
        </Panel>
      </section>
    </div>
  )
}
