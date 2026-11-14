import { Check, CheckCircle2, FileUp, FlaskConical, Radio } from 'lucide-react'
import { useState } from 'react'
import { comparePhases, latestValidHeartRate, RULES, sessionCompleteness } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import { linkedReadings, recordSourceMode, REVIEW_CHECKLIST, subjectDevice, type Dataset, type LinkState } from '../../shared/dataset'
import { ringMetrics, timelineFor } from '../../shared/explain'
import { ago, listJoin, SYMPTOM_NOUN, utcDateTime, utcStamp } from '../../shared/format'
import { Astronaut } from '../components/Astronaut'
import { ackLabel, EventRow, Timeline } from '../components/Events'
import { Ring } from '../components/Ring'
import { Empty, KV, Panel, Pill, SimTag, TONE } from '../components/ui'
import { useData, useNow } from '../lib/data'
import { href } from '../lib/router'
import {
  CATEGORY_META,
  focusFor,
  isOpen,
  LINK_META,
  ORIGIN_LABEL,
  recoveryCheckState,
  regionsFor,
  reportedByText,
  REVIEW_META,
  sessionsOf,
  sortEvents,
  subjectLabel,
  symptomCheckText,
  type Region,
  type RegionInfo,
  type Tone,
} from '../lib/view'

export function headlineFor(e: StoredEvent, ds: Dataset): string {
  const s = e.sessionId ? ds.sessions[e.sessionId] : undefined
  if (e.category === 'REVIEW_SUGGESTED') {
    const names = [...new Set((s?.symptoms ?? []).map((x) => SYMPTOM_NOUN[x.code]))]
    return names.length ? `Gravity recovery assessment — ${listJoin(names)} reported` : 'Gravity recovery assessment — symptom reported'
  }
  if (e.category === 'VERIFY_SOURCE') return 'A measurement needs its source verified'
  return 'Recovery check recorded without enough data'
}

function AlertPanel({ event, ds, others }: { event: StoredEvent | null; ds: Dataset; others: number }) {
  if (!event) {
    return (
      <div className="rise flex items-start gap-4 rounded-2xl border border-line bg-panel/80 p-6">
        <CheckCircle2 className="mt-0.5 text-mint" size={22} />
        <div>
          <div className="label text-ink">No open review events</div>
          <p className="mt-1.5 max-w-[60ch] text-[13px] text-ink-2">
            Every recorded event has been reviewed or closed. A review records that someone looked at the evidence; it is not a medical clearance.
          </p>
        </div>
      </div>
    )
  }
  const cat = CATEGORY_META[event.category]
  const tone: Tone = cat.tone
  const ack = ackLabel(event)
  const t = TONE[tone]
  return (
    <div className={`rise relative overflow-hidden rounded-2xl border ${t.border} p-6`} style={{ background: `color-mix(in oklab, ${t.stroke} 7%, var(--color-panel))` }} data-testid="hero-alert">
      <div
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-60 blur-3xl"
        style={{ background: `color-mix(in oklab, ${t.stroke} 22%, transparent)` }}
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center gap-2.5">
        <span className={`pulse-dot h-2.5 w-2.5 rounded-full ${t.dot}`} aria-hidden />
        <span className={`text-[12px] font-bold uppercase tracking-[0.18em] ${t.text}`}>{cat.title}</span>
        {event.isSimulated && <SimTag />}
      </div>
      <h2 className="relative mt-3 text-[23px] leading-snug font-bold text-ink">{headlineFor(event, ds)}</h2>
      <p className="relative mt-1.5 text-[13px] text-ink-2">
        {subjectLabel(event.subjectId)} · Event created <span className="tnum text-[12px]">{utcDateTime(event.createdAt)}</span> · {ORIGIN_LABEL[event.origin.kind]}
      </p>
      <dl className="relative mt-5 grid gap-4 sm:grid-cols-3">
        <KV k="Why it was created">
          <span className="whitespace-normal">{event.reasonCodes.join(', ')}</span>
        </KV>
        <KV k="On the watch">
          <span className={TONE[ack.tone].text}>{ack.text}</span>
        </KV>
        <KV k="Medical review">
          <span className={TONE[REVIEW_META[event.review.state].tone].text}>{REVIEW_META[event.review.state].label}</span>
        </KV>
      </dl>
      <div className="relative mt-6 flex flex-wrap items-center gap-4">
        <a className={`btn ${tone === 'coral' ? 'btn-alert' : 'btn-primary'}`} href={href.event(event.eventId)} data-testid="open-evidence">
          Open evidence
        </a>
        {others > 0 && (
          <a className="text-[12px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink" href={href.events}>
            {others} more open {others === 1 ? 'event' : 'events'}
          </a>
        )}
      </div>
    </div>
  )
}

function StripCell({ label, value, sub, tone, testId }: { label: string; value: string; sub: string; tone?: Tone; testId?: string }) {
  return (
    <div className="min-w-0 px-5 py-4" data-testid={testId}>
      <div className="micro">{label}</div>
      <div className={`mt-2 truncate text-[20px] font-bold leading-none ${tone ? TONE[tone].text : 'text-ink'}`}>{value}</div>
      <div className="mt-2 truncate text-[11.5px] text-ink-3">{sub}</div>
    </div>
  )
}

function MeasurementStrip({ ds, subjectId, session, links, nowMs }: { ds: Dataset; subjectId: string | null; session: StoredSession | null; links: Record<string, string>; nowMs: number }) {
  const latest = latestValidHeartRate(sessionsOf(ds, subjectId))
  const recent = latest ? nowMs - Date.parse(latest.measuredAt) <= RULES.recentReadingSeconds * 1000 : false
  const c = session ? comparePhases(session) : null
  const recorded = session ? session.measurements.filter((m) => m.indicator === 'HEART_RATE').length : 0
  const valid = c ? c.rest.valid.length + c.recovery.valid.length : 0
  const device = subjectId ? subjectDevice(ds, subjectId) : null
  const link = device ? ((links[device.deviceId] as keyof typeof LINK_META) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const sessionLink = session?.provenance.deviceId ? ((links[session.provenance.deviceId] as LinkState | undefined) ?? 'NOT_PAIRED') : 'NOT_PAIRED'
  const check = recoveryCheckState(session, session ? recordSourceMode(session, sessionLink) : null)
  const st = session?.symptomCheck.status
  const symptomValue = session ? symptomCheckText(session) : '--'
  return (
    <section className="panel grid grid-cols-2 divide-hair md:grid-cols-3 xl:grid-cols-6 xl:divide-x" aria-label="Latest measurements" data-testid="measurement-strip">
      <StripCell
        testId="strip-hr"
        label="Latest heart rate"
        value={latest ? (recent ? `${latest.value} bpm` : 'No recent data') : '--'}
        sub={latest ? `${recent ? 'At' : `Last ${latest.value} bpm at`} ${utcStamp(latest.measuredAt).slice(5, 16)}Z` : 'No valid reading on record'}
        tone={latest && !recent ? 'muted' : undefined}
      />
      <StripCell label="Valid HR samples" value={session ? `${valid} / ${recorded}` : '--'} sub={session ? 'Valid of recorded, this check' : 'No check recorded'} />
      <StripCell label="Recovery check" value={check.value} sub={check.sub} testId="strip-check" />
      <StripCell label="Reported symptoms" value={symptomValue} sub={st === 'REPORTED' && session ? reportedByText(session) : session ? 'From the symptom check' : 'No check recorded'} tone={st === 'REPORTED' ? 'coral' : undefined} />
      <StripCell label="Watch connection" value={LINK_META[link].label} sub={device ? `Last contact ${ago(device.lastSeenAt, nowMs)}` : 'No device has checked in'} tone={LINK_META[link].tone} />
      <StripCell label="Last successful sync" value={device?.lastSyncAt ? `${utcStamp(device.lastSyncAt).slice(11)}` : '--'} sub={device?.lastSyncAt ? `${utcStamp(device.lastSyncAt).slice(0, 10)} · ${ago(device.lastSyncAt, nowMs)}` : 'Nothing received over live sync'} />
    </section>
  )
}

const LEGEND: { state: RegionInfo['state']; label: string; tone: Tone }[] = [
  { state: 'symptom', label: 'Symptom reported', tone: 'coral' },
  { state: 'data', label: 'Evidence recorded', tone: 'cyan' },
  { state: 'caution', label: 'Check the source', tone: 'amber' },
  { state: 'neutral', label: 'No evidence', tone: 'muted' },
]

export function RegionDetail({ info, unplaced }: { info: RegionInfo | null; unplaced: string[] }) {
  return (
    <div className="well px-4 py-3.5" data-testid="region-detail">
      {info ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="label text-ink">{info.name}</div>
            <Pill tone={LEGEND.find((l) => l.state === info.state)!.tone}>{LEGEND.find((l) => l.state === info.state)!.label}</Pill>
          </div>
          {info.items.length ? (
            <ul className="mt-3 space-y-2.5">
              {info.items.map((it, i) => (
                <li key={i}>
                  <div className={`text-[11.5px] font-bold tracking-[0.06em] ${TONE[it.tone].text}`}>{it.title}</div>
                  <div className="text-[12px] text-ink-2">{it.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-3">No evidence recorded for this region.</p>
          )}
          {info.note && <p className="mt-3 border-t border-hair pt-2.5 text-[11.5px] text-ink-3">{info.note}</p>}
        </>
      ) : (
        <>
          <div className="text-[12.5px] text-ink-2">Select a region to see the evidence behind it. A highlight shows where evidence was recorded, not a diagnosis.</div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {LEGEND.map((l) => (
              <span key={l.state} className="flex items-center gap-1.5 text-[11px] text-ink-3">
                <span className={`h-2 w-2 rounded-full ${TONE[l.tone].dot}`} aria-hidden />
                {l.label}
              </span>
            ))}
          </div>
        </>
      )}
      {unplaced.length > 0 && <p className="mt-3 text-[11.5px] text-ink-3">Also reported without a location: {unplaced.join(', ')}.</p>}
    </div>
  )
}

export function CrewReport({ ds, session, subjectId, compact = false }: { ds: Dataset; session: StoredSession | null; subjectId: string | null; compact?: boolean }) {
  const [selected, setSelected] = useState<Region | null>(null)
  const regions = regionsFor(session, session ? linkedReadings(ds, session.sessionId) : [])
  return (
    <div className="flex flex-col gap-4">
      <div className={`mx-auto w-full ${compact ? 'max-w-[400px]' : 'max-w-[520px]'}`}>
        <Astronaut regions={regions} selected={selected} onSelect={setSelected} label={`Evidence map for ${subjectId ? subjectLabel(subjectId) : 'crew member'}`} />
      </div>
      <RegionDetail info={selected ? regions[selected] : null} unplaced={regions.unplaced.map((s) => SYMPTOM_NOUN[s.code])} />
    </div>
  )
}

function EmptyWorkspace() {
  const { workspace, setWorkspace, actions } = useData()
  const [busy, setBusy] = useState(false)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 py-10">
      <div>
        <div className="micro">{workspace === 'demo' ? 'Simulated demo' : 'Mission records'}</div>
        <h1 className="mt-2 font-display text-[34px] tracking-[0.06em]">MISSION HEALTH</h1>
      </div>
      {workspace === 'mission' ? (
        <Empty
          title="No mission records yet"
          action={
            <div className="flex flex-wrap gap-3">
              <a className="btn btn-primary" href={href.system}>
                <FileUp size={15} /> Import a watch export
              </a>
              <button className="btn btn-sim" onClick={() => setWorkspace('demo')}>
                <FlaskConical size={15} /> Open simulated demo
              </button>
            </div>
          }
        >
          Nothing has arrived from a watch. Import a saved watch file, or start the API with GG_LAN=1 and pair the watch app (see System Status). The dashboard never fills this view with simulated data on its own.
        </Empty>
      ) : (
        <Empty
          title="The demo workspace is empty"
          action={
            <button
              className="btn btn-sim"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await actions.demoReset()
                } finally {
                  setBusy(false)
                }
              }}
            >
              <FlaskConical size={15} /> Load simulated scenarios
            </button>
          }
        >
          Load the six simulated scenarios (normal check, dizziness, insufficient data, stale cuff reading, unreachable watch, acknowledged but unreviewed).
        </Empty>
      )}
    </div>
  )
}

export function TriggerButton() {
  const { actions } = useData()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="btn btn-sim"
        data-testid="trigger-sim"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErr(null)
          try {
            await actions.demoTrigger()
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Radio size={15} /> Trigger simulated watch event
      </button>
      {err && <span className="text-[11.5px] text-coral">{err}</span>}
    </div>
  )
}

export function Overview() {
  const { snapshot, workspace, subjectId } = useData()
  const nowMs = useNow(5000)
  if (!snapshot) return null
  const ds = snapshot.dataset
  if (Object.keys(ds.sessions).length + Object.keys(ds.events).length === 0) return <EmptyWorkspace />

  const open = sortEvents(Object.values(ds.events)).filter(isOpen)
  const hero = open[0] ?? null
  const focus = focusFor(ds, subjectId)
  const session = focus.session
  const sessionEvents = session ? sortEvents(Object.values(ds.events).filter((e) => e.sessionId === session.sessionId)) : []
  const event = focus.event ?? sessionEvents[0] ?? focus.latestEvent
  const rings = ringMetrics(session, event, REVIEW_CHECKLIST.items.length)
  const timeline = timelineFor(event && (!session || event.sessionId === session.sessionId) ? event : (sessionEvents[0] ?? null), session)
  const feed = sortEvents(Object.values(ds.events)).slice(0, 6)

  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          <div className="rise flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="micro">Profile: gravity recovery check · {subjectId ? subjectLabel(subjectId) : 'No crew selected'}</div>
              <h1 className="mt-2 font-display text-[clamp(28px,3.2vw,42px)] leading-none tracking-[0.06em] text-ink">MISSION HEALTH</h1>
              <p className="mt-3 text-[14px] text-ink-2">Onboard monitoring, evidence, and crew health review.</p>
            </div>
            {workspace === 'demo' && <TriggerButton />}
          </div>
          <AlertPanel event={hero} ds={ds} others={Math.max(0, open.length - 1)} />
        </div>
        <Panel
          className="rise lg:col-span-5"
          title="Record signals"
          meta={session ? <span className="font-mono text-[11px] text-ink-3">{session.sessionId}</span> : undefined}
        >
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Ring value={rings.completeness} tone="mint" label="Session completeness" caption="Protocol steps present in the record" unavailable="No check recorded" size={128} />
            <Ring value={rings.coverage} tone="cyan" label="HR data coverage" caption="10-second phase intervals with a valid reading" unavailable="Phase times incomplete" size={128} />
            <Ring value={rings.review} tone="violet" label="Review workflow" caption={`Checklist items documented, v${REVIEW_CHECKLIST.version}`} unavailable="No event to review" size={128} />
          </div>
          {session && (
            <ul className="mt-5 grid gap-x-6 gap-y-2 border-t border-hair pt-4 sm:grid-cols-2" aria-label="Protocol steps in the record" data-testid="protocol-steps">
              {sessionCompleteness(session).steps.map((st) => (
                <li key={st.id} className="flex items-center gap-2.5 text-[12.5px]">
                  <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border ${st.done ? 'border-mint/60 bg-mint/15 text-mint' : 'border-line'}`} aria-hidden>
                    {st.done && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className={st.done ? 'text-ink' : 'text-ink-3'}>
                    {st.label}
                    <span className="sr-only">{st.done ? ' (recorded)' : ' (not recorded)'}</span>
                  </span>
                  <span className="ml-auto tnum text-[11.5px] text-ink-3">{st.at ? utcStamp(st.at).slice(11) : '--'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-hair pt-3 text-[11.5px] text-ink-3">
            Each ring counts what is in the record. None of them is a score of anyone’s health, readiness or safety.
          </p>
        </Panel>
      </section>

      <MeasurementStrip ds={ds} subjectId={subjectId} session={session} links={snapshot.links} nowMs={nowMs} />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,0.95fr)]">
        <Panel title="Active health events" meta={<Pill tone={open.length ? 'coral' : 'muted'}>{open.length} open</Pill>} bodyClassName="px-4 pb-4">
          <div className="flex flex-col gap-2.5" data-testid="event-feed">
            {feed.map((e) => (
              <EventRow key={e.eventId} e={e} ds={ds} />
            ))}
            {!feed.length && <div className="px-1 text-[13px] text-ink-3">No events recorded.</div>}
          </div>
          {Object.keys(ds.events).length > feed.length && (
            <a href={href.events} className="mt-3 block px-1 text-[12px] text-ink-2 hover:text-ink">
              All {Object.keys(ds.events).length} events →
            </a>
          )}
        </Panel>

        <Panel
          title="Crew health report"
          className="ticks"
          meta={
            <>
              <span className="text-[12px] text-ink-2">{subjectId ? subjectLabel(subjectId) : '--'}</span>
              {session?.isSimulated && <SimTag />}
            </>
          }
        >
          <CrewReport ds={ds} session={session} subjectId={subjectId} />
          {session && (
            <a href={href.session(session.sessionId)} className="mt-3 block text-[12px] text-ink-2 hover:text-ink">
              Open session report →
            </a>
          )}
        </Panel>

        <Panel title="Mission activity" meta={session ? <span className="text-[11.5px] text-ink-3">{utcStamp(session.startedAt).slice(0, 10)}</span> : undefined}>
          <Timeline items={timeline} empty="No recorded activity for this crew member." />
        </Panel>
      </section>
    </div>
  )
}
