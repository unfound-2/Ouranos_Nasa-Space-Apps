import { ArrowLeft } from 'lucide-react'
import { comparePhases, externalReadingFindings, formatDuration, personalBaseline } from '../../shared/analysis'
import { linkedReadings, REVIEW_CHECKLIST } from '../../shared/dataset'
import { ringMetrics, timelineFor } from '../../shared/explain'
import { SYMPTOM_LABEL, utcStamp } from '../../shared/format'
import { EventRow, Timeline } from '../components/Events'
import { Ring } from '../components/Ring'
import { Empty, KV, Panel, RealTag, SimTag } from '../components/ui'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import { sortEvents, subjectLabel } from '../lib/view'
import { HistoryPanel, RecoveryPanel } from './Investigation'
import { CrewReport } from './Overview'

export function SessionReport({ id }: { id: string }) {
  const { snapshot, workspace } = useData()
  if (!snapshot) return null
  const ds = snapshot.dataset
  const s = Object.hasOwn(ds.sessions, id) ? ds.sessions[id] : undefined
  if (!s)
    return (
      <div className="mx-auto max-w-2xl py-10">
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
    <div className="flex flex-col gap-4" data-testid="session-report">
      <section className="panel overflow-hidden">
        <div className="px-4 pt-3 pb-3">
          <a href={href.crew} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink-2">
            <ArrowLeft size={12} /> Recovery history
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-ink-2">Recovery assessment</span>
            {s.isSimulated ? <SimTag /> : <RealTag />}
          </div>
          <h1 className="mt-1 text-[20px] font-semibold">
            {subjectLabel(s.subjectId)} · {utcStamp(s.startedAt)}
          </h1>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line bg-panel-2 px-4 py-3 md:grid-cols-4 xl:grid-cols-7">
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
          <div className="grid grid-cols-2 gap-3">
            <Ring value={rings.completeness} tone="mint" label="Completeness" caption="Protocol steps present" size={120} />
            <Ring value={rings.coverage} tone="cyan" label="HR coverage" caption="10-second intervals with a valid reading" unavailable="Phase times incomplete" size={120} />
          </div>
          <div className="mt-5 border-t border-hair pt-4">
            <div className="micro mb-2">Symptom check</div>
            {s.symptomCheck.status === 'REPORTED' ? (
              <ul className="space-y-1.5">
                {s.symptoms.map((x) => (
                  <li key={x.symptomId} className="text-[12.5px]">
                    <span className="font-bold text-coral">{SYMPTOM_LABEL[x.code]}</span>{' '}
                    <span className="text-ink-2">
                      — {x.reportedBy === 'SELF_REPORTED' ? 'self-reported' : 'reported by a crew observer'} {utcStamp(x.reportedAt)}
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
                  <li key={i} className="text-[12px] text-amber">
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
