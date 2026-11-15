import { useMemo, useState, type ReactNode } from 'react'
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { BASELINE_EXCLUSION_LABEL, comparePhases, externalReadingFindings, formatDuration, personalBaseline } from '../../shared/analysis'
import type { IngestPathT, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, type Dataset } from '../../shared/dataset'
import { plural, signed, SYMPTOM_LABEL, utcDate, utcStamp } from '../../shared/format'
import { Disclosure, Empty, Pill, SimTag } from '../components/ui'
import { useData } from '../lib/data'
import { href, navigate } from '../lib/router'
import { eventsOf, REVIEW_META, sessionsOf, subjectLabel, subjectsOf, symptomCheckText } from '../lib/view'

export interface SessionRow {
  s: StoredSession
  durationS: number | null
  rest: ReturnType<typeof comparePhases>['rest']
  recovery: ReturnType<typeof comparePhases>['recovery']
  delta: number | null
  events: ReturnType<typeof eventsOf>
  flags: string[]
}

export function sessionRows(ds: Dataset, subjectId: string | null): SessionRow[] {
  return sessionsOf(ds, subjectId).map((s) => {
    const c = comparePhases(s)
    const events = eventsOf(ds, null).filter((e) => e.sessionId === s.sessionId)
    const excluded = c.rest.excluded.length + c.recovery.excluded.length
    const flags: string[] = []
    if (excluded) flags.push(`${excluded} left out`)
    if (c.status !== 'CALCULATED') flags.push('Insufficient samples')
    if (s.phases.some((p) => !p.endedAt)) flags.push('Phase end missing')
    if (s.endReason !== 'COMPLETED') flags.push(s.endReason.replace(/_/g, ' ').toLowerCase())
    if (externalReadingFindings(s, linkedReadings(ds, s.sessionId)).length) flags.push('External reading flagged')
    return {
      s,
      durationS: s.endedAt ? (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000 : null,
      rest: c.rest,
      recovery: c.recovery,
      delta: c.observedDelta,
      events,
      flags,
    }
  })
}

function evenTicks(lo: number, hi: number): number[] {
  const span = hi - lo
  const step = span <= 20 ? 5 : span <= 50 ? 10 : 20
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
  return out
}

const C = { cyan: 'var(--color-cyan)', coral: 'var(--color-coral)', ink2: 'var(--color-ink-2)', ink3: 'var(--color-ink-3)', line: 'var(--color-line)', hair: 'var(--color-hair)', panel: 'var(--color-panel)' }

function DeltaChart({ rows, baseline }: { rows: SessionRow[]; baseline: number | null }) {
  const pts = rows
    .filter((r) => r.delta !== null)
    .map((r) => ({
      t: Date.parse(r.s.startedAt),
      v: r.delta as number,
      id: r.s.sessionId,
      at: r.s.startedAt,
      symptom: r.s.symptoms.length > 0,
      symptoms: r.s.symptoms.map((x) => SYMPTOM_LABEL[x.code]).join(', '),
    }))
  const skipped = rows.length - pts.length
  if (!pts.length) return <Empty title="No session has enough readings for a phase comparison">Sessions with fewer than 3 valid readings in a phase are listed below without a difference.</Empty>
  const vs = [0, ...pts.map((p) => p.v), ...(baseline !== null ? [baseline] : [])]
  const lo = Math.floor((Math.min(...vs) - 4) / 5) * 5
  const hi = Math.ceil((Math.max(...vs) + 6) / 5) * 5
  const pad = 12 * 3600_000
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px] text-ink-2">
        <span className="text-ink-3">Recovery − rest, bpm</span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4.5" fill={C.cyan} />
          </svg>
          No symptom reported
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill="none" stroke={C.coral} strokeWidth="2" />
          </svg>
          Symptom reported in that check
        </span>
        {baseline !== null && (
          <span className="flex items-center gap-1.5">
            <svg width="16" height="6" aria-hidden>
              <line x1="0" y1="3" x2="16" y2="3" stroke={C.ink2} strokeDasharray="3 3" strokeWidth="1.5" />
            </svg>
            Personal baseline
          </span>
        )}
        {skipped > 0 && <span className="text-ink-3">{plural(skipped, 'session')} without enough readings not plotted</span>}
      </div>
      <div style={{ height: 330 }} data-testid="delta-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={C.hair} vertical={false} />
            <XAxis
              type="number"
              dataKey="t"
              domain={[Math.min(...pts.map((p) => p.t)) - pad, Math.max(...pts.map((p) => p.t)) + pad]}
              ticks={pts.map((p) => p.t)}
              interval={0}
              tickFormatter={(v: number) => utcDate(new Date(v).toISOString()).replace(/ \d{4}$/, '')}
              stroke={C.line}
              tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'inherit' }}
              tickLine={false}
            />
            <YAxis
              type="number"
              dataKey="v"
              domain={[lo, hi]}
              ticks={evenTicks(lo, hi)}
              interval={0}
              stroke={C.line}
              tick={{ fill: C.ink3, fontSize: 10.5, fontFamily: 'inherit' }}
              tickLine={false}
              width={40}
            />
            <ReferenceLine y={0} stroke={C.line} />
            {baseline !== null && (
              <ReferenceLine
                y={baseline}
                stroke={C.ink2}
                strokeDasharray="4 4"
                strokeWidth={1.25}
                label={{ value: `baseline ${signed(baseline)} bpm`, position: 'insideTopRight', fill: C.ink2, fontSize: 10.5 }}
              />
            )}
            <Tooltip
              cursor={false}
              isAnimationActive={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as (typeof pts)[number]
                return (
                  <div className="rounded-[3px] border border-line bg-panel px-3.5 py-2.5 shadow-[0_6px_20px_rgb(20_24_29/0.14)]">
                    <div className="text-[13px] font-semibold text-ink tnum">{signed(p.v)} bpm recovery − rest</div>
                    <div className="mt-1 text-[11px] text-ink-2 tnum">{utcStamp(p.at)}</div>
                    {p.symptom && <div className="mt-1 text-[11px] text-ink">{p.symptoms}</div>}
                    <div className="mt-1 font-mono text-[10px] text-ink-3">{p.id}</div>
                  </div>
                )
              }}
            />
            <Scatter
              data={pts}
              isAnimationActive={false}
              onClick={(d: { payload?: { id?: string } }) => d?.payload?.id && navigate(href.session(d.payload.id))}
              shape={(props: { cx?: number; cy?: number; payload?: { symptom: boolean } }) => (
                <g style={{ cursor: 'pointer' }}>
                  <circle cx={props.cx} cy={props.cy} r={12} fill="transparent" />
                  {props.payload?.symptom ? (
                    <circle cx={props.cx} cy={props.cy} r={5.5} fill={C.panel} stroke={C.coral} strokeWidth={2.25} />
                  ) : (
                    <circle cx={props.cx} cy={props.cy} r={5} fill={C.cyan} stroke={C.panel} strokeWidth={1.5} />
                  )}
                </g>
              )}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Recovery median minus rest median for each check with enough readings. Select a dot to open that session. Descriptive; not compared with any clinical threshold.</p>
    </div>
  )
}

export function SessionsTable({ rows, ds }: { rows: SessionRow[]; ds: Dataset }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table min-w-[980px]" data-testid="sessions-table">
        <thead>
          <tr>
            <th>Started (UTC)</th>
            <th>Astronaut</th>
            <th>Duration</th>
            <th>Rest</th>
            <th>Recovery</th>
            <th>Difference</th>
            <th>Symptoms</th>
            <th>Events</th>
            <th>Quality</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.s.sessionId} className="row-link" onClick={() => navigate(href.session(r.s.sessionId))} data-testid={`session-row-${r.s.sessionId}`}>
              <td>
                <a href={href.session(r.s.sessionId)} className="tnum text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                  {utcStamp(r.s.startedAt)}
                </a>
              </td>
              <td className="text-ink-2">
                {subjectLabel(r.s.subjectId)} {r.s.isSimulated && <SimTag className="ml-1" />}
              </td>
              <td className="text-ink-2 tnum">{r.durationS === null ? 'In progress' : formatDuration(r.durationS)}</td>
              <td className="tnum">
                {r.rest.median ?? '--'} <span className="text-ink-3">· {r.rest.valid.length} valid</span>
              </td>
              <td className="tnum">
                {r.recovery.median ?? '--'} <span className="text-ink-3">· {r.recovery.valid.length} valid</span>
              </td>
              <td className="font-semibold tnum">{r.delta === null ? <span className="font-normal text-ink-3">N/A</span> : `${signed(r.delta)} bpm`}</td>
              <td>
                {r.s.symptomCheck.status === 'REPORTED' ? (
                  <span className="text-ink">{r.s.symptoms.map((x) => SYMPTOM_LABEL[x.code]).join(', ')}</span>
                ) : (
                  <span className="text-ink-3">{symptomCheckText(r.s)}</span>
                )}
              </td>
              <td>
                {r.events.length ? (
                  <div className="flex flex-col gap-1">
                    {r.events.map((e) => (
                      <a key={e.eventId} href={href.event(e.eventId)} onClick={(ev) => ev.stopPropagation()} className="text-[11.5px] text-ink-2 hover:text-ink">
                        {e.category.replace(/_/g, ' ').toLowerCase()} · <span className="text-ink-3">{REVIEW_META[e.review.state].label.toLowerCase()}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-3">None</span>
                )}
              </td>
              <td>{r.flags.length ? <span className="text-ink">{r.flags.join(' · ')}</span> : <span className="text-ink-3">No flags</span>}</td>
              <td className="text-[11.5px] text-ink-2">{recordSourceMode(r.s, 'NOT_PAIRED') === 'SIMULATED DEMO' ? 'Simulated' : (r.s.provenance.ingestPath ?? '--').replace(/_/g, ' ').toLowerCase()}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={10} className="text-ink-3">
                No sessions match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {!Object.keys(ds.sessions).length && <p className="mt-3 text-[12px] text-ink-3">No sessions on this computer yet.</p>}
    </div>
  )
}

const SYMPTOM_FILTERS = ['ANY', 'NONE', 'DIZZY', 'WEAK', 'NAUSEATED', 'OTHER'] as const

const SOURCE_LABEL: Record<IngestPathT, string> = {
  LIVE_SYNC: 'Live sync',
  SAVED_DEVICE_FILE: 'Saved device file',
  FILE_IMPORT: 'File import',
  MANUAL_ENTRY: 'Manual entry',
  DEMO_FIXTURE: 'Simulated fixture',
  DEMO_TRIGGER: 'Simulated trigger',
}

function Section({ index, title, aside, children, className = '', testId }: { index: string; title: string; aside?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`} data-testid={testId} data-index={index}>
      <header className="pane-head flex-wrap">
        <h2 className="label">{title}</h2>
        {aside}
      </header>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  )
}

function useBaseline(ds: Dataset, subjectId: string | null) {
  return useMemo(() => {
    if (!subjectId) return null
    const latest = sessionsOf(ds, subjectId)[0]
    return latest ? { latest, result: personalBaseline(latest, Object.values(ds.sessions)) } : null
  }, [ds, subjectId])
}

function BaselinePanel({ baseline, subjectId }: { baseline: ReturnType<typeof useBaseline>; subjectId: string | null }) {
  if (!subjectId)
    return <p className="text-[12.5px] leading-relaxed text-ink-2">Choose a crew member. A baseline is personal: it is never pooled across the crew.</p>
  if (!baseline) return <p className="text-[12.5px] text-ink-3">No sessions recorded for {subjectLabel(subjectId)}.</p>
  const b = baseline.result
  const est = b.status === 'ESTABLISHED'
  return (
    <div className="flex flex-col gap-4" data-testid="baseline-panel">
      <div className="flex items-baseline gap-3">
        <span className="figure text-[30px] text-ink">{b.baselineDelta === null ? 'N/A' : signed(b.baselineDelta)}</span>
        {b.baselineDelta !== null && <span className="unit text-[13px]">bpm</span>}
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        {est
          ? `Median recovery − rest difference of the ${plural(b.used.length, 'comparable session')} before the latest check (${utcDate(baseline.latest.startedAt)}).`
          : `Needs ${b.required} earlier comparable sessions; ${b.compatibleCount} so far. Until then no baseline is shown.`}
      </p>
      {est && b.currentDelta !== null && b.differenceFromBaseline !== null && (
        <p className="text-[12.5px] text-ink-2">
          Latest check: <b className="font-semibold text-ink tnum">{signed(b.currentDelta)} bpm</b>, {signed(b.differenceFromBaseline)} bpm from the baseline. Descriptive only.
        </p>
      )}
      {b.used.length > 0 && (
        <div>
          <div className="micro mb-1.5">{est ? 'Sessions in the baseline' : 'Comparable so far'}</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2 tnum">
            {b.used.map((u) => (
              <li key={u.sessionId}>
                <a href={href.session(u.sessionId)} className="hover:text-ink">
                  {utcDate(u.startedAt).replace(/ \d{4}$/, '')} <b className="font-semibold text-ink">{signed(u.observedDelta)}</b>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.excluded.length > 0 && (
        <details className="text-[12px] text-ink-3">
          <summary className="cursor-pointer hover:text-ink-2">{plural(b.excluded.length, 'session')} not compared</summary>
          <ul className="mt-1.5 space-y-1">
            {b.excluded.map((x) => (
              <li key={x.sessionId}>
                {utcStamp(x.startedAt)} · {BASELINE_EXCLUSION_LABEL[x.reason]}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function SymptomHistory({ rows }: { rows: SessionRow[] }) {
  const items = rows.flatMap((r) => r.s.symptoms.map((x) => ({ r, x }))).sort((a, b) => Date.parse(b.x.reportedAt) - Date.parse(a.x.reportedAt))
  if (!items.length) return <p className="text-[12.5px] text-ink-3">No symptoms were reported in these sessions.</p>
  return (
    <ol className="flex flex-col divide-y divide-hair" data-testid="symptom-history">
      {items.map(({ r, x }) => (
        <li key={x.symptomId} className="py-2.5 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-[12.5px] font-semibold text-ink">{SYMPTOM_LABEL[x.code]}</span>
            <span className="text-[11px] text-ink-3 tnum">{utcStamp(x.reportedAt)}</span>
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-2">
            {x.reportedBy === 'SELF_REPORTED' ? 'Self-reported' : 'Crew observed'}
            {x.phase ? ` · ${x.phase.toLowerCase()} phase` : ''} · {subjectLabel(r.s.subjectId)} ·{' '}
            <a href={href.session(r.s.sessionId)} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              session
            </a>
            {r.events.map((e) => (
              <span key={e.eventId}>
                {' · '}
                <a href={href.event(e.eventId)} className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  event {REVIEW_META[e.review.state].label.toLowerCase()}
                </a>
              </span>
            ))}
          </div>
          {x.note && <p className="mt-1 text-[11.5px] text-ink-3">“{x.note}”</p>}
        </li>
      ))}
    </ol>
  )
}

export function CrewHealth() {
  const { snapshot, subjectId, setSubjectId, workspace } = useData()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [source, setSource] = useState<'ANY' | IngestPathT>('ANY')
  const [symptom, setSymptom] = useState<(typeof SYMPTOM_FILTERS)[number]>('ANY')
  const [review, setReview] = useState<'ANY' | 'OPEN' | 'REVIEWED' | 'NO_EVENT'>('ANY')
  const ds = snapshot?.dataset
  const all = useMemo(() => (ds ? sessionRows(ds, subjectId) : []), [ds, subjectId])
  const baseline = useBaseline(ds ?? ({ sessions: {} } as Dataset), subjectId)
  if (!ds) return null
  const sources = [...new Set(all.map((r) => r.s.provenance.ingestPath).filter((p): p is IngestPathT => p !== null))]
  const rows = all.filter((r) => {
    const day = r.s.startedAt.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (source !== 'ANY' && r.s.provenance.ingestPath !== source) return false
    if (symptom === 'NONE' && r.s.symptoms.length) return false
    if (symptom !== 'ANY' && symptom !== 'NONE' && !r.s.symptoms.some((x) => x.code === symptom)) return false
    if (review === 'NO_EVENT' && r.events.length) return false
    if (review === 'OPEN' && !r.events.some((e) => e.status !== 'REVIEWED' && e.status !== 'CLOSED')) return false
    if (review === 'REVIEWED' && !r.events.some((e) => e.review.state === 'REVIEWED' || e.review.state === 'CLOSED')) return false
    return true
  })
  const subjects = subjectsOf(ds)
  const symptomCount = rows.reduce((n, r) => n + r.s.symptoms.length, 0)
  const b = baseline?.result ?? null
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-[28px] text-ink">Recovery history</h1>
          <p className="mt-1 text-[12.5px] text-ink-2">Crew health · {subjectId ? subjectLabel(subjectId) : 'all crew'} · every recorded recovery assessment</p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="micro">Sessions</dt>
            <dd className="text-[14px] font-semibold text-ink tnum">
              {rows.length}
              {rows.length !== all.length && <span className="font-normal text-ink-3"> of {all.length}</span>}
            </dd>
          </div>
          <div>
            <dt className="micro">Symptom reports</dt>
            <dd className={`text-[14px] font-semibold tnum ${symptomCount ? 'text-ink' : 'text-ink'}`}>{symptomCount}</dd>
          </div>
          <div>
            <dt className="micro">Baseline</dt>
            <dd className={`text-[14px] font-semibold ${b?.status === 'ESTABLISHED' ? 'text-ink' : 'text-ink'}`}>
              {!subjectId ? 'Per person' : b?.status === 'ESTABLISHED' ? 'Established' : 'Not established'}
            </dd>
          </div>
        </dl>
      </header>

      <Disclosure title="Filters">
      <div className="panel flex flex-wrap items-end gap-3 px-4 py-3" role="search" aria-label="Filter sessions">
        <label className="flex flex-col gap-1.5">
          <span className="micro">Astronaut</span>
          <select className="field" value={subjectId ?? ''} onChange={(e) => setSubjectId(e.target.value || null)} data-testid="filter-subject">
            <option value="">All crew</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">From (UTC date)</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">To (UTC date)</span>
          <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Source</span>
          <select className="field" value={source} onChange={(e) => setSource(e.target.value as typeof source)} data-testid="filter-source">
            <option value="ANY">Any</option>
            {sources.map((p) => (
              <option key={p} value={p}>
                {SOURCE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Symptom</span>
          <select className="field" value={symptom} onChange={(e) => setSymptom(e.target.value as typeof symptom)} data-testid="filter-symptom">
            <option value="ANY">Any</option>
            <option value="NONE">None reported</option>
            <option value="DIZZY">Dizziness</option>
            <option value="WEAK">Weakness</option>
            <option value="NAUSEATED">Nausea</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="micro">Review status</span>
          <select className="field" value={review} onChange={(e) => setReview(e.target.value as typeof review)}>
            <option value="ANY">Any</option>
            <option value="OPEN">Has an open event</option>
            <option value="REVIEWED">Has a reviewed event</option>
            <option value="NO_EVENT">No event</option>
          </select>
        </label>
        <div className="ml-auto flex flex-col gap-1.5">
          <span className="micro">Data</span>
          <Pill tone={workspace === 'demo' ? 'violet' : 'cyan'} className="h-8">
            {workspace === 'demo' ? 'Simulated demo only' : 'Real mission records only'}
          </Pill>
        </div>
      </div>
      </Disclosure>

      <Section index="04" title="Recorded assessments" aside={<span className="text-[11.5px] text-ink-3">{rows.length} of {all.length}</span>}>
        <SessionsTable rows={rows} ds={ds} />
      </Section>
      <Disclosure title="Recovery trends, baseline and symptoms">
      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Section
          index="01"
          title="Recovery − rest difference by session"
          className="xl:col-span-8"
          aside={<span className="text-[11.5px] text-ink-3">{subjectId ? subjectLabel(subjectId) : 'All crew'}</span>}
        >
          <DeltaChart rows={rows} baseline={subjectId && b?.status === 'ESTABLISHED' ? b.baselineDelta : null} />
        </Section>
        <div className="flex flex-col gap-4 xl:col-span-4">
          <Section index="02" title="Personal baseline" aside={subjectId && b ? <Pill tone={b.status === 'ESTABLISHED' ? 'mint' : 'amber'}>{b.status === 'ESTABLISHED' ? 'Established' : 'Not established'}</Pill> : undefined}>
            <BaselinePanel baseline={baseline} subjectId={subjectId} />
          </Section>
          <Section index="03" title="Symptom history" aside={<span className="text-[11.5px] text-ink-3">{plural(symptomCount, 'report')}</span>}>
            <SymptomHistory rows={rows} />
          </Section>
        </div>
      </div>

      </Disclosure>
    </div>
  )
}
