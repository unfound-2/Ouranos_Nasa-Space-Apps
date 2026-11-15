import { ArrowLeft, Check, ClipboardCheck, Download, Hand, Minus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BASELINE_EXCLUSION_LABEL, EXCLUSION_LABEL, RULES, type PhaseComparison } from '../../shared/analysis'
import type { StoredEvent, StoredMeasurement, StoredSession } from '../../shared/contract'
import { recordSourceMode, REVIEW_CHECKLIST, type Dataset, type LinkState, type ResolvedEvidence } from '../../shared/dataset'
import {
  baselineBasis,
  buildEventContext,
  conclusionsFor,
  eventTitle,
  explainEvent,
  focusLabel,
  knownsAndUnknowns,
  reasonInfo,
  reasonLine,
  timelineFor,
  type EventContext,
  type Fact,
} from '../../shared/explain'
import { plural, signed, SYMPTOM_LABEL, utcDate, utcStamp, utcTime } from '../../shared/format'
import { BaselineChart } from '../components/BaselineChart'
import { ackLabel } from '../components/Events'
import { HrChart } from '../components/HrChart'
import { Empty, Pill, RealTag, SectionNo, SimTag, TONE } from '../components/ui'
import { ApiError } from '../lib/api'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { CATEGORY_META, ORIGIN_LABEL, REVIEW_META, SOURCE_META, STATUS_META, subjectLabel, type Tone } from '../lib/view'
import { CrewReport } from './Overview'

function Section({ index, title, children, className = '', aside }: { index?: string; title: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`panel min-w-0 ${className}`} data-index={index}>
      <header className="pane-head flex-wrap">
        <h2 className="label">
          {index && <SectionNo n={index} />}
          {title}
        </h2>
        {aside}
      </header>
      <div className="px-5 pt-1 pb-5">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Evidence items

function EvidenceItem({ r }: { r: ResolvedEvidence }) {
  if (r.ref.reasonCode === 'WATCH_TELEMETRY_FLAG' && r.ref.note) {
    return <div className="text-[12.5px] text-ink-2">{r.ref.note}</div>
  }
  if (!r.found)
    return (
      <div className="text-[12px] text-ink">
        Cited {r.kind.toLowerCase()} {r.ref.refId ? <span className="font-mono">{r.ref.refId}</span> : null} is not available ·{' '}
        {r.reason === 'SESSION_NOT_RECEIVED' ? 'the session record has not been received' : 'not found in the stored records'}
      </div>
    )
  switch (r.kind) {
    case 'SYMPTOM':
      return (
        <div className="text-[12.5px]">
          <span className="font-semibold text-ink">{SYMPTOM_LABEL[r.symptom.code]}</span>
          <span className="text-ink-2"> — {r.symptom.reportedBy === 'SELF_REPORTED' ? 'self-reported' : 'crew-observed'} at {utcTime(r.symptom.reportedAt)}</span>
          {r.symptom.phase && <span className="text-ink-3"> · {r.symptom.phase.toLowerCase()} phase</span>}
          {r.symptom.note && <div className="text-[12px] text-ink-3">“{r.symptom.note}”</div>}
        </div>
      )
    case 'MEASUREMENT': {
      const m = r.measurement
      return (
        <div className="text-[12.5px]">
          <span className="font-semibold text-ink">
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
          <span className="font-semibold text-ink">{r.phase.phase} phase</span> {utcTime(r.phase.startedAt)} → {r.phase.endedAt ? utcTime(r.phase.endedAt) : 'no end time'}
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

// ---------------------------------------------------------------------------
// The three questions

function Narrative({ ctx }: { ctx: EventContext }) {
  const timeline = timelineFor(ctx.event, ctx.session)
  const sentences = explainEvent(ctx)
  const concl = conclusionsFor(ctx)
  const watchAction = ctx.event.extensions?.watchReviewAction
  return (
    <section className="grid gap-4 xl:grid-cols-3" aria-label="Evidence narrative">
      <Section index="01" title="What happened?">
        <ol className="space-y-2.5" data-testid="what-happened">
          {timeline.map((i, idx) => (
            <li key={idx} className="grid grid-cols-[62px_minmax(0,1fr)] gap-x-3 text-[12.5px]">
              <span className="pt-px text-ink-3 tnum">
                {utcTime(i.at).replace(' UTC', 'Z')}
                {(idx === 0 || utcDate(i.at) !== utcDate(timeline[idx - 1].at)) && <span className="block text-[10px] text-ink-3">{utcDate(i.at)}</span>}
              </span>
              <span>
                <span className="font-semibold text-ink">{i.label}</span>
                {i.detail && <span className="block text-[11.5px] text-ink-3">{i.detail}</span>}
              </span>
            </li>
          ))}
          {!timeline.length && <li className="text-[13px] text-ink-3">Nothing recorded.</li>}
        </ol>
      </Section>

      <Section index="02" title="Why was this flagged?">
        <div data-testid="explanation">
          <p className="text-[14px] leading-relaxed font-semibold text-ink">{sentences[0]}</p>
          {typeof watchAction === 'string' && <p className="mt-3 text-[12.5px] text-ink-2">{watchAction}</p>}
        </div>
        <ul className="mt-4 space-y-2.5" data-testid="reason-codes">
          {ctx.event.reasonCodes.map((code) => {
            const info = reasonInfo(code)
            const ev = ctx.evidence.filter((e) => e.ref.reasonCode === code)
            return (
              <li key={code} className="well px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-medium text-ink">{code}</span>
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
      </Section>

      <Section index="03" title="What can we actually conclude?">
        <div data-testid="conclusions">
          <div className="micro text-ink">The record shows</div>
          <ul className="mt-2.5 space-y-2">
            {concl.supported.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-ink">
                <Check size={14} className="mt-0.5 shrink-0 text-ink" aria-hidden />
                {t}
              </li>
            ))}
            {!concl.supported.length && <li className="text-[12.5px] text-ink-3">Nothing that supports a conclusion.</li>}
          </ul>
          <div className="micro rule mt-4 pt-4 text-ink">The record cannot show</div>
          <ul className="mt-2.5 space-y-2">
            {concl.unsupported.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-ink-2">
                <Minus size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Heart-rate analysis with the measurement inspector

function ProvenanceRow({ k, children, mono = false }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-x-3 py-1.5">
      <dt className="micro pt-0.5">{k}</dt>
      <dd className={`min-w-0 text-[12.5px] break-words text-ink ${mono ? 'font-mono text-[11.5px]' : ''}`}>{children}</dd>
    </div>
  )
}

function MeasurementInspector({ m, c, links }: { m: StoredMeasurement | null; c: PhaseComparison; links: Record<string, LinkState> }) {
  if (!m) return <p className="text-[12.5px] text-ink-3">Select a reading in the chart or the table to see where it came from.</p>
  const used = [...c.rest.valid, ...c.recovery.valid].some((x) => x.measurementId === m.measurementId)
  const excl = [...c.rest.excluded, ...c.recovery.excluded].find((x) => x.measurement.measurementId === m.measurementId)
  const mode = recordSourceMode(m, m.provenance.deviceId ? (links[m.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED')
  const modeTone: Tone = SOURCE_META[mode].tone
  return (
    <dl className="divide-y divide-hair" data-testid="provenance-inspector">
      <div className="pb-3">
        <div className="text-[26px] font-semibold tnum text-ink">
          {m.value === null ? 'No value' : m.value}
          {m.value !== null && <span className="unit ml-1.5 text-[14px]">{m.unit}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Pill tone={modeTone}>{mode}</Pill>
          <Pill tone={used ? 'cyan' : 'amber'}>{used ? 'Used in median' : 'Left out'}</Pill>
        </div>
      </div>
      <ProvenanceRow k="Measured">{utcStamp(m.measuredAt)}</ProvenanceRow>
      <ProvenanceRow k="Received">{m.receivedAt ? utcStamp(m.receivedAt) : '--'}</ProvenanceRow>
      <ProvenanceRow k="Phase">{m.phase ? m.phase.toLowerCase() : 'not tagged'}</ProvenanceRow>
      <ProvenanceRow k="Quality">
        {m.quality.toLowerCase()}
        {excl && <span className="text-ink"> · {EXCLUSION_LABEL[excl.reason].toLowerCase()}</span>}
      </ProvenanceRow>
      <ProvenanceRow k="Device">{m.source.device ?? 'not recorded'}</ProvenanceRow>
      <ProvenanceRow k="Sensor">{m.source.sensor ?? 'not recorded'}</ProvenanceRow>
      <ProvenanceRow k="Source kind">{m.source.kind.replace(/_/g, ' ').toLowerCase()}</ProvenanceRow>
      <ProvenanceRow k="Arrived via">{(m.provenance.ingestPath ?? 'created on this computer').replace(/_/g, ' ').toLowerCase()}</ProvenanceRow>
      {m.provenance.importFileName && <ProvenanceRow k="Import file">{m.provenance.importFileName}</ProvenanceRow>}
      <ProvenanceRow k="Reading id" mono>
        {m.measurementId}
      </ProvenanceRow>
    </dl>
  )
}

function WatchSummaryCheck({ session, c }: { session: StoredSession; c: PhaseComparison }) {
  const s = session.summary
  if (!s) return <p className="text-[11.5px] text-ink-3">The watch sent no summary of its own for this session.</p>
  const same = s.restMedianBpm === c.restMedian && s.recoveryMedianBpm === c.recoveryMedian && s.deltaBpm === c.observedDelta
  return (
    <p className={`text-[11.5px] ${same ? 'text-ink-3' : 'text-ink'}`} data-testid="summary-check">
      Watch summary: rest {s.restMedianBpm ?? '--'}, recovery {s.recoveryMedianBpm ?? '--'}, difference {s.deltaBpm === null ? '--' : signed(s.deltaBpm)} bpm ·{' '}
      {same ? 'matches this computer’s recalculation.' : 'differs from this computer’s recalculation; check the watch rules or the transfer.'}
    </p>
  )
}

export function RecoveryPanel({ session, c, className = '', unlinked = false, index }: { session: StoredSession | null; c: PhaseComparison | null; className?: string; unlinked?: boolean; index?: string }) {
  const { snapshot } = useData()
  const hr = session ? session.measurements.filter((m) => m.indicator === 'HEART_RATE') : []
  const [picked, setSelectedId] = useState<string | null>(null)
  const latestValid = [...hr].filter((m) => m.value !== null && m.quality === 'VALID').sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))[0] ?? null
  const selectedId = picked ?? latestValid?.measurementId ?? null
  const selected = hr.find((m) => m.measurementId === selectedId) ?? null
  const src = hr[0]
  const mode = src ? recordSourceMode(src, src.provenance.deviceId ? (snapshot?.links[src.provenance.deviceId] ?? 'NOT_PAIRED') : 'NOT_PAIRED') : null
  return (
    <Section
      index={index}
      title="Heart-rate analysis"
      className={className}
      aside={
        session ? (
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
            <span>
              {src?.source.device ?? 'Unknown device'} · {plural(hr.length, 'reading')}
            </span>
            {session.isSimulated ? <SimTag /> : <RealTag />}
            {mode && !session.isSimulated && <Pill tone={SOURCE_META[mode].tone}>{mode}</Pill>}
          </span>
        ) : undefined
      }
    >
      {!session || !c ? (
        unlinked ? (
          <Empty title="Not linked to a recovery session">This event concerns readings outside a recovery check, so there is no heart-rate comparison to show.</Empty>
        ) : (
          <Empty title="Session record not received">The event arrived without its session, so there are no readings to show. Nothing is estimated in their place.</Empty>
        )
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {c.status === 'CALCULATED' ? (
              <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] bg-hair sm:grid-cols-4" data-testid="phase-stats">
                {[
                  ['Rest median', `${c.restMedian}`, 'bpm', plural(c.rest.valid.length, 'valid reading')],
                  ['Recovery median', `${c.recoveryMedian}`, 'bpm', plural(c.recovery.valid.length, 'valid reading')],
                  ['Observed difference', signed(c.observedDelta), 'bpm', 'Recovery − rest, descriptive'],
                  ['Left out', `${c.rest.excluded.length + c.recovery.excluded.length}`, '', 'Readings not used'],
                ].map(([k, v, u, sub]) => (
                  <div key={k} className="bg-panel-2 px-4 py-3">
                    <dt className="micro">{k}</dt>
                    <dd className="mt-1.5 text-[22px] leading-none font-semibold tnum text-ink">
                      {v}
                      {u && (
                        <>
                          {' '}
                          <span className="unit text-[12px]">{u}</span>
                        </>
                      )}
                    </dd>
                    <dd className="mt-1.5 text-[11px] text-ink-3">{sub}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="mb-4 rounded-[4px] border border-amber/40 bg-amber/[0.07] px-4 py-3" data-testid="insufficient">
                <div className="label text-ink">Insufficient samples to calculate phase comparison</div>
                <p className="mt-1 text-[12.5px] text-ink-2">
                  Rest has {plural(c.rest.valid.length, 'valid reading')}, recovery has {plural(c.recovery.valid.length, 'valid reading')}. At least {RULES.minValidSamplesPerPhase} are needed in each
                  phase. No difference is shown.
                </p>
              </div>
            )}
            <HrChart session={session} comparison={c} selectedId={selectedId} onSelect={setSelectedId} />
            <div className="mt-3 space-y-1">
              <p className="text-[11.5px] text-ink-3">
                Each dot is one recorded reading; nothing is drawn between readings. Medians use valid readings timestamped inside each recorded phase. The difference is descriptive, not a clinical threshold.
              </p>
              <WatchSummaryCheck session={session} c={c} />
            </div>
          </div>
          <div className="well px-4 py-4">
            <div className="label mb-3">Measurement provenance</div>
            <MeasurementInspector m={selected} c={c} links={snapshot?.links ?? {}} />
          </div>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Know / don't know, history

function FactList({ facts, mark }: { facts: Fact[]; mark: 'known' | 'unknown' }) {
  return (
    <ul className="space-y-2.5">
      {facts.map((f) => (
        <li key={f.id} className="flex gap-2.5 text-[12.5px] leading-snug" data-testid={`fact-${f.id}`}>
          <span className={`status-mark mt-[6px] ${mark === 'known' ? 'bg-mint' : f.kind === 'limit' ? 'bg-line-strong' : 'bg-amber'}`} aria-hidden />
          <span className={mark === 'known' ? 'text-ink' : 'text-ink-2'}>
            {f.text}
            {f.kind === 'limit' && <span className="micro ml-1.5">Not measured</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function KnowPanel({ ctx, index }: { ctx: EventContext; index: string }) {
  const k = knownsAndUnknowns(ctx)
  return (
    <Section index={index} title="What we know / what we don't know" className="lg:col-span-4">
      <div className="grid gap-4" data-testid="knowns">
        <div>
          <div className="micro mb-2.5 text-ink">What we know</div>
          <FactList facts={k.known} mark="known" />
        </div>
        <div className="rule pt-4">
          <div className="micro mb-2.5 text-ink">What we don’t know</div>
          <FactList facts={[...k.unknown, { id: 'diagnosis', kind: 'limit', text: 'Heart-rate data alone cannot diagnose orthostatic intolerance.' }]} mark="unknown" />
        </div>
      </div>
    </Section>
  )
}

export function HistoryPanel({ ctx, className = '', index }: { ctx: Pick<EventContext, 'baseline' | 'session' | 'comparison'>; className?: string; index?: string }) {
  const b = ctx.baseline
  const s = ctx.session
  return (
    <Section
      index={index}
      title="Personal history"
      className={className}
      aside={b ? <Pill tone={b.status === 'ESTABLISHED' ? 'cyan' : 'muted'}>{b.status === 'ESTABLISHED' ? 'Baseline established' : 'Not established'}</Pill> : undefined}
    >
      {!b || !s ? (
        <Empty title="No session to compare" />
      ) : (
        <div data-testid="history">
          {b.status === 'ESTABLISHED' ? (
            <p className="text-[13px] text-ink-2">
              Baseline <span className="font-semibold text-ink">{signed(b.baselineDelta ?? 0)} bpm</span>: median recovery − rest difference {baselineBasis(b)}.
              {b.differenceFromBaseline !== null && (
                <>
                  {' '}
                  This session: <span className="font-semibold text-ink">{signed(b.currentDelta ?? 0)} bpm</span>, {signed(b.differenceFromBaseline)} bpm from the baseline. Descriptive only.
                </>
              )}
            </p>
          ) : (
            <div className="rounded-[4px] border border-line px-4 py-3">
              <div className="label text-ink">Personal baseline not established</div>
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
                  <span className="tnum text-ink-3">{utcStamp(u.startedAt).slice(5, 10)}</span> <span className="font-semibold text-ink">{signed(u.observedDelta)}</span> bpm
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
                    <span className="tnum">{utcStamp(x.startedAt).slice(0, 16)}</span> · {BASELINE_EXCLUSION_LABEL[x.reason]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Review workflow

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
                <label className={`flex cursor-pointer items-start gap-3 rounded-[4px] border px-3.5 py-3 transition-colors ${on ? 'border-violet/45 bg-violet/[0.08]' : 'border-hair hover:border-line'} ${locked ? 'cursor-default opacity-80' : ''}`}>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    disabled={locked}
                    onChange={() => setChecked((c) => (c.includes(item.id) ? c.filter((x) => x !== item.id) : [...c, item.id]))}
                    data-testid={`check-${item.id}`}
                  />
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-cyan ${on ? 'border-violet bg-violet text-void' : 'border-line'}`} aria-hidden>
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
              <button className="btn btn-ghost" aria-busy={busy === 'SAVE_PROGRESS'} disabled={!!busy} onClick={() => run('SAVE_PROGRESS')}>
                Save progress
              </button>
              <button className="btn btn-primary" aria-busy={busy === 'MARK_REVIEWED'} disabled={!!busy || !all || !reviewer.trim()} onClick={() => run('MARK_REVIEWED')} data-testid="mark-reviewed">
                <ClipboardCheck size={15} /> Mark reviewed
              </button>
            </>
          )}
          {r.state === 'REVIEWED' && (
            <button className="btn btn-ghost" aria-busy={busy === 'CLOSE'} disabled={!!busy || !reviewer.trim()} onClick={() => run('CLOSE')} data-testid="close-event">
              Close event
            </button>
          )}
        </div>
        {!locked && !all && <p className="text-[11.5px] text-ink-3">Mark reviewed needs every checklist item and a reviewer.</p>}
        {r.reviewedAt && (
          <p className="text-[12px] text-ink">
            Reviewed by {r.reviewer} at {utcStamp(r.reviewedAt)}. This records a review; it is not a medical clearance.
          </p>
        )}
        {r.closedAt && <p className="text-[12px] text-ink-2">Closed at {utcStamp(r.closedAt)}.</p>}
        {err && (
          <p className="text-[12px] text-ink" role="alert">
            {err}
          </p>
        )}
        <div className="mt-1 rounded-[4px] border border-hair px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-3">
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

// ---------------------------------------------------------------------------
// Page

function HeaderField({ k, children, testId }: { k: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="micro">{k}</dt>
      <dd className="mt-0.5 text-[13px] break-words text-ink">{children}</dd>
    </div>
  )
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
  const tone: Tone = event.review.state === 'REVIEWED' || event.review.state === 'CLOSED' ? 'mint' : cat.tone
  const status = STATUS_META[event.status]
  const ack = ackLabel(event)
  const canSimAck = event.isSimulated && event.delivery.state === 'PRESENTED' && !event.acknowledgement
  const openReview = () => {
    setReviewOpen(true)
    requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const delivery =
    event.delivery.state === 'PRESENTED'
      ? `Presented on the ${event.delivery.channel === 'SIMULATED_WATCH' ? 'simulated watch' : 'watch'} ${event.delivery.presentedAt ? utcTime(event.delivery.presentedAt) : ''}`
      : event.delivery.state === 'WATCH_UNREACHABLE'
        ? 'Not delivered · watch unreachable'
        : event.delivery.state === 'UNCONFIRMED'
          ? 'Queued, never confirmed'
          : event.delivery.state === 'QUEUED'
            ? 'Queued for the watch'
            : 'Not attempted'

  return (
    <div className="flex flex-col gap-4" data-testid="investigation">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4 pb-4">
          <div className="min-w-0">
            <a href={href.events} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-2">
              <ArrowLeft size={12} /> Event history
            </a>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 font-mono text-[12px] font-medium text-ink"><span className={`status-mark ${TONE[tone].dot}`} aria-hidden />{focusLabel(event)}</span>
              {event.isSimulated ? <SimTag /> : <RealTag />}
            </div>
            <h1 className="display mt-2.5 text-[26px] text-ink">{eventTitle(ctx)}</h1>
            <p className="mt-0.5 text-[13.5px] text-ink-2">
              <span className="text-ink-3">Reason · </span>
              {reasonLine(ctx)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-hero" onClick={openReview} data-testid="open-review">
              <ClipboardCheck size={14} /> Open review workflow
            </button>
            {canSimAck && (
              <button
                className="btn btn-sim btn-sm"
                aria-busy={ackBusy}
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
                <Hand size={14} /> Simulate watch acknowledgement
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => download(`${event.eventId}.json`, { exportedBy: 'gravityguard-mission-dashboard', event, session: ctx.session, linkedReadings: ctx.readings })}
            >
              <Download size={14} /> Export record
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line bg-panel-2 px-4 py-3 md:grid-cols-4" data-testid="event-header">
          <HeaderField k="Event ID">
            <span className="font-mono text-[12px]">{event.eventId}</span>
          </HeaderField>
          <HeaderField k="Astronaut">{subjectLabel(event.subjectId)}</HeaderField>
          <HeaderField k="Timestamp (UTC)">
            <span className="tnum">{utcStamp(event.createdAt)}</span>
          </HeaderField>
          <HeaderField k="Event reason">
            <span className="text-[12px]">{event.reasonCodes.join(', ')}</span>
          </HeaderField>
          <HeaderField k="Status">
            <Pill tone={status.tone}>{status.label}</Pill>
          </HeaderField>
          <HeaderField k="Source">
            {ORIGIN_LABEL[event.origin.kind]}
            {event.origin.ruleSet ? <span className="text-ink-3"> · {event.origin.ruleSet}</span> : null}
            <span className={`mt-0.5 block text-[11.5px] ${TONE[SOURCE_META[ctx.sourceMode].tone].text}`}>{event.isSimulated ? 'SIMULATED' : `REAL · ${ctx.sourceMode}`}</span>
          </HeaderField>
          <HeaderField k="Delivery">
            <span className={event.delivery.state === 'PRESENTED' ? 'text-ink' : 'text-ink'}>{delivery}</span>
          </HeaderField>
          <HeaderField k="Acknowledgement">
            <span className={TONE[ack.tone].text}>{event.acknowledgement ? ack.text : event.delivery.state === 'PRESENTED' ? 'Presented · not acknowledged' : ack.text}</span>
          </HeaderField>
        </dl>
      </section>

      <Narrative ctx={ctx} />

      <RecoveryPanel index="04" session={ctx.session} c={ctx.comparison} unlinked={event.sessionId === null} />

      <section className="grid gap-4 lg:grid-cols-12">
        <Section index="05" title="Body evidence map" className="ticks lg:col-span-4">
          <CrewReport ds={ds} session={ctx.session} subjectId={event.subjectId} compact />
        </Section>
        <KnowPanel ctx={ctx} index="06" />
        <HistoryPanel ctx={ctx} className="lg:col-span-4" index="07" />
      </section>

      <div ref={reviewRef} className="scroll-mt-32">
        {reviewOpen ? (
          <Section index="08" title="Review workflow" aside={<span className="text-[11.5px] text-ink-3">Offline · stored on this computer</span>}>
            <ReviewWorkflow key={`${event.eventId}-${event.review.updatedAt ?? 'new'}`} event={event} />
          </Section>
        ) : (
          <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="label flex items-center gap-2.5">
                Review workflow
              </div>
              <div className="mt-1 text-[12.5px] text-ink-3">{REVIEW_META[event.review.state].label}. The checklist works offline and records who reviewed what, and when.</div>
            </div>
            <button className="btn btn-ghost" onClick={openReview}>
              Open review workflow
            </button>
          </div>
        )}
      </div>

      <section className="grid gap-4 lg:grid-cols-12">
        <Section index="09" title="State history" className="lg:col-span-5" aside={<span className="text-[11.5px] text-ink-3">Every status change, who made it</span>}>
          <ol className="divide-y divide-hair" data-testid="state-history">
            {event.statusHistory.map((h, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2.5">
                <span>
                  <span className="text-[12.5px] font-semibold text-ink">{STATUS_META[h.status].label}</span>
                  <span className="micro ml-2">{h.actor.replace('_', ' ')}</span>
                  {h.note && <span className="block text-[11.5px] text-ink-3">{h.note}</span>}
                </span>
                <span className="text-right text-[11.5px] text-ink-2 tnum">{utcStamp(h.at).slice(5)}</span>
              </li>
            ))}
          </ol>
        </Section>
        <Section index="10" title="Source record" className="lg:col-span-7" aside={<span className="text-[11.5px] text-ink-3">Exactly as stored · provenance included</span>}>
          <details className="group">
            <summary className="cursor-pointer text-[12.5px] text-ink-2 hover:text-ink">Show the stored event and session JSON</summary>
            <pre className="mt-3 max-h-[420px] overflow-auto code rounded-[4px] border border-hair bg-void p-4 text-[11px] leading-relaxed text-ink-2">
              {JSON.stringify({ event, session: ctx.session ? { ...ctx.session, measurements: `${ctx.session.measurements.length} readings (see the chart table)` } : null }, null, 2)}
            </pre>
          </details>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <HeaderField k="Ingest path">{event.provenance.ingestPath ?? 'Created on this computer'}</HeaderField>
            <HeaderField k="Received">
              <span className="tnum">{event.provenance.receivedAt ? utcStamp(event.provenance.receivedAt) : '--'}</span>
            </HeaderField>
            <HeaderField k="Import file">{event.provenance.importFileName ?? '--'}</HeaderField>
          </dl>
        </Section>
      </section>
    </div>
  )
}
