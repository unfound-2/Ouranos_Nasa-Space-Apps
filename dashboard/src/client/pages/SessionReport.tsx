import { ArrowLeft } from 'lucide-react'
import { comparePhases, externalReadingFindings, formatDuration, personalBaseline } from '../../shared/analysis'
import type { StoredSession } from '../../shared/contract'
import { linkedReadings, REVIEW_CHECKLIST } from '../../shared/dataset'
import { ringMetrics, timelineFor } from '../../shared/explain'
import { plural, SYMPTOM_LABEL, utcStamp } from '../../shared/format'
import { EventRow, Timeline } from '../components/Events'
import { Meter } from '../components/Ring'
import { Empty, KV, Panel, RealTag, SimTag } from '../components/ui'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { sortEvents, subjectLabel } from '../lib/view'
import { HistoryPanel, RecoveryPanel } from './Investigation'
import { CrewReport } from './Overview'
import './tabs.css'

const QUALITY_KEYS = ['VALID', 'QUESTIONABLE', 'INVALID', 'MISSING'] as const
const QUALITY_LABEL = { VALID: 'Valid', QUESTIONABLE: 'Questionable', INVALID: 'Invalid', MISSING: 'No value' } as const
const QUALITY_BG = { VALID: 'bg-mint', QUESTIONABLE: 'bg-amber', INVALID: 'bg-coral', MISSING: 'bg-ink-3' } as const

/** What the record holds: heart-rate readings by quality, the symptom answer and the events it raised. */
function SessionStats({ s, events }: { s: StoredSession; events: number }) {
  const hr = s.measurements.filter((m) => m.indicator === 'HEART_RATE')
  const counts = QUALITY_KEYS.map((q) => ({ q, n: hr.filter((m) => m.quality === q).length }))
  const symptom = s.symptomCheck.status === 'REPORTED' ? `${s.symptoms.length}` : s.symptomCheck.status === 'NONE_REPORTED' ? 'None' : s.symptomCheck.status === 'NO_RESPONSE' ? 'No answer' : 'Not asked'
  return (
    <div className="tab-stats mt-6">
      <div className="tab-card tab-stat tab-stat-wide">
        <span className="tab-stat-label">Heart-rate readings</span>
        <span className="tab-stat-value">{hr.length}</span>
        {hr.length > 0 && (
          <>
            <div className="tab-strip mt-1" role="img" aria-label={counts.map((x) => `${x.n} ${QUALITY_LABEL[x.q].toLowerCase()}`).join(', ')}>
              {counts.filter((x) => x.n).map((x) => (
                <span key={x.q} className={QUALITY_BG[x.q]} style={{ flexGrow: x.n }} title={`${QUALITY_LABEL[x.q]}: ${x.n}`} />
              ))}
            </div>
            <div className="tab-legend mt-1">
              {counts.map((x) => (
                <span key={x.q}>
                  <span className={`status-mark ${QUALITY_BG[x.q]}`} aria-hidden />
                  {QUALITY_LABEL[x.q]} <b>{x.n}</b>
                </span>
              ))}
            </div>
          </>
        )}
        <span className="tab-stat-note">{s.measurements[0]?.source.device ?? s.provenance.deviceId ?? 'Device not recorded'}{s.isSimulated ? ', simulated' : ''}</span>
      </div>
      <div className="tab-card tab-stat">
        <span className="tab-stat-label">Symptoms reported</span>
        <span className="tab-stat-value">{symptom}</span>
        <span className="tab-stat-note">{s.symptomCheck.status === 'REPORTED' ? s.symptoms.map((x) => SYMPTOM_LABEL[x.code]).join(', ') : 'From the symptom check'}</span>
      </div>
      <div className="tab-card tab-stat">
        <span className="tab-stat-label">Review events</span>
        <span className="tab-stat-value">{events}</span>
        <span className="tab-stat-note">Raised for this session</span>
      </div>
    </div>
  )
}

export function SessionReport({ id }: { id: string }) {
  const { snapshot, workspace } = useData()
  if (!snapshot) return null
  const ds = snapshot.dataset
  const s = Object.hasOwn(ds.sessions, id) ? ds.sessions[id] : undefined
  if (!s)
    return (
      <div className="tab-page mx-auto max-w-2xl py-10">
        <div className="mission-horizon" aria-hidden="true" />
        <Empty title="Session not found" action={<a className="btn btn-ghost" href={href.crew}>Recovery history</a>}>
          No session <span className="font-mono">{id}</span> in {workspace === 'demo' ? 'the simulated demo' : 'mission records'}.
        </Empty>
      </div>
    )
  const c = comparePhases(s)
  const events = sortEvents(Object.values(ds.events).filter((e) => e.sessionId === s.sessionId))
  const readings = linkedReadings(ds, s.sessionId)
  const findings = externalReadingFindings(s, readings)
  const rings = ringMetrics(s, events[0] ?? null, REVIEW_CHECKLIST.items.length)
  const baseline = personalBaseline(s, Object.values(ds.sessions))
  return (
    <div className="tab-page" data-testid="session-report">
      <div className="mission-horizon" aria-hidden="true" />
      <section>
        <header className="mission-intro">
          <a href={href.crew} className="tab-back">
            <ArrowLeft size={13} /> Recovery history
          </a>
          <div className="tab-intro-tags">
            <span className="text-[13px] font-semibold text-ink-2">Recovery assessment</span>
            {s.isSimulated ? <SimTag /> : <RealTag />}
          </div>
          <h1 className="display faded-label tab-intro-title">{subjectLabel(s.subjectId)}</h1>
          <p>
            <span className="tnum">{utcStamp(s.startedAt)}</span>
            <span>{s.protocol.id.replace(/_/g, ' ').toLowerCase()} v{s.protocol.version}</span>
            <span>{plural(events.length, 'review event')}</span>
          </p>
        </header>
        <SessionStats s={s} events={events.length} />
        <dl className="panel tab-facts mt-4 p-3">
          <KV k="Session ID" mono>
            {s.sessionId}
          </KV>
          <KV k="Protocol">
            {s.protocol.id.replace(/_/g, ' ').toLowerCase()} v{s.protocol.version}
          </KV>
          <KV k="Duration">{s.endedAt ? formatDuration((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : 'In progress'}</KV>
          <KV k="Ended">{s.endReason.replace(/_/g, ' ').toLowerCase()}</KV>
          <KV k="Device">{s.measurements[0]?.source.device ?? s.provenance.deviceId ?? '--'}</KV>
          <KV k="Ingest path">{(s.provenance.ingestPath ?? '--').replace(/_/g, ' ').toLowerCase()}</KV>
          <KV k="Received">
            {s.provenance.receivedAt ? utcStamp(s.provenance.receivedAt) : '--'}
          </KV>
        </dl>
      </section>

      <section className="grid gap-4 lg:grid-cols-12">
        <RecoveryPanel session={s} c={c} className="lg:col-span-8" />
        <Panel title="Record signals" className="lg:col-span-4">
          <div className="flex flex-col gap-4">
            <Meter value={rings.completeness} tone="mint" label="Completeness" caption="Protocol steps present" />
            <Meter value={rings.coverage} tone="cyan" label="HR coverage" caption="10-second intervals with a valid reading" unavailable="Phase times incomplete" />
          </div>
          <div className="mt-5 border-t border-hair pt-4">
            <div className="micro mb-2">Symptom check</div>
            {s.symptomCheck.status === 'REPORTED' ? (
              <ul className="space-y-1.5">
                {s.symptoms.map((x) => (
                  <li key={x.symptomId} className="text-[12.5px]">
                    <span className="font-bold text-ink">{SYMPTOM_LABEL[x.code]}</span>{' '}
                    <span className="text-ink-2">
                      {x.reportedBy === 'SELF_REPORTED' ? 'self-reported' : 'reported by a crew observer'} {utcStamp(x.reportedAt)}
                    </span>
                    {x.bodyRegion && <span className="text-ink-3"> · location {x.bodyRegion.toLowerCase()}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-2">
                {s.symptomCheck.status === 'NONE_REPORTED' ? 'No symptoms reported.' : s.symptomCheck.status === 'NO_RESPONSE' ? 'The symptom question was not answered.' : 'No symptom check was recorded.'}
              </p>
            )}
          </div>
          <div className="mt-4 border-t border-hair pt-4">
            <div className="micro mb-2">External readings</div>
            {readings.length ? (
              <ul className="space-y-1.5">
                {readings.map((r) => (
                  <li key={r.measurementId} className="text-[12.5px] text-ink-2">
                    <span className="font-bold text-ink">
                      {r.indicator.replace('BLOOD_PRESSURE_', '').toLowerCase()} {r.value ?? '--'} {r.unit}
                    </span>{' '}
                    · {r.source.device} · {utcStamp(r.measuredAt)} · {r.quality.toLowerCase()}
                  </li>
                ))}
                {findings.map((f, i) => (
                  <li key={i} className="text-[12px] text-ink">
                    {f.reasonCode}: {f.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-3">None linked. The watch cannot measure blood pressure.</p>
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-12">
        <Panel title="Crew health report" className="ticks lg:col-span-4">
          <CrewReport ds={ds} session={s} subjectId={s.subjectId} compact />
        </Panel>
        <HistoryPanel ctx={{ baseline, session: s, comparison: c }} className="lg:col-span-4" />
        <Panel title="Activity" className="lg:col-span-4">
          <Timeline items={timelineFor(events[0] ?? null, s)} />
        </Panel>
      </section>

      <Panel title="Review events for this session" bodyClassName="px-4 pb-4">
        {events.length ? (
          <div className="grid gap-2.5 md:grid-cols-2">
            {events.map((e) => (
              <EventRow key={e.eventId} e={e} ds={ds} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-[13px] text-ink-3">No review event was created for this session.</p>
        )}
      </Panel>
    </div>
  )
}
