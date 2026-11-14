/**
 * View derivations for the dashboard. Pure functions over the stored records; no React.
 * Labels here describe records and workflow state, never a person's health.
 */
import { comparePhases, EXCLUSION_LABEL } from '../../shared/analysis'
import type {
  BodyRegionT,
  EventCategoryT,
  EventStatusT,
  SeverityT,
  StoredEvent,
  StoredMeasurement,
  StoredSession,
  Symptom,
} from '../../shared/contract'
import { recordSourceMode, type Dataset, type LinkState, type SourceMode } from '../../shared/dataset'
import { DEMO_SUBJECT_LABELS } from '../../shared/demo'
import { plural, SYMPTOM_LABEL, utcTime } from '../../shared/format'

export type Tone = 'mint' | 'cyan' | 'violet' | 'coral' | 'amber' | 'neutral' | 'muted'

export const STATUS_META: Record<EventStatusT, { label: string; tone: Tone }> = {
  CREATED: { label: 'Created', tone: 'neutral' },
  QUEUED: { label: 'Queued', tone: 'neutral' },
  DELIVERED: { label: 'Delivered', tone: 'cyan' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'cyan' },
  REVIEWED: { label: 'Reviewed', tone: 'mint' },
  CLOSED: { label: 'Closed', tone: 'muted' },
  DELIVERY_UNCONFIRMED: { label: 'Delivery unconfirmed', tone: 'amber' },
  WATCH_UNREACHABLE: { label: 'Watch unreachable', tone: 'amber' },
}

export const CATEGORY_META: Record<EventCategoryT, { label: string; title: string; tone: Tone }> = {
  REVIEW_SUGGESTED: { label: 'Review suggested', title: 'Health review required', tone: 'coral' },
  VERIFY_SOURCE: { label: 'Verify source', title: 'Verify measurement source', tone: 'amber' },
  RECORDING_INCOMPLETE: { label: 'Recording incomplete', title: 'Recording incomplete', tone: 'amber' },
}

export const SEVERITY_META: Record<SeverityT, { label: string; tone: Tone; rank: number }> = {
  PRIORITY_REVIEW: { label: 'Priority review', tone: 'coral', rank: 3 },
  REVIEW: { label: 'Review', tone: 'coral', rank: 2 },
  NOTICE: { label: 'Notice', tone: 'amber', rank: 1 },
}

export const LINK_META: Record<LinkState, { label: string; tone: Tone; hint: string }> = {
  VERIFIED: { label: 'Link verified', tone: 'mint', hint: 'Authenticated contact within the last 60 seconds.' },
  WATCH_UNREACHABLE: { label: 'Watch unreachable', tone: 'amber', hint: 'No authenticated contact within the last 60 seconds.' },
  NOT_PAIRED: { label: 'No watch link', tone: 'muted', hint: 'No watch has checked in with this computer.' },
  SIMULATED: { label: 'Simulated watch', tone: 'violet', hint: 'A demo device. No real link exists.' },
}

export const SOURCE_META: Record<SourceMode, { tone: Tone; hint: string }> = {
  'LIVE DEVICE': { tone: 'mint', hint: 'Received over authenticated live sync, and the watch link is verified right now.' },
  'SAVED DEVICE DATA': { tone: 'cyan', hint: 'Recorded by the watch and stored on this computer. Not a live connection.' },
  'MANUALLY ENTERED': { tone: 'cyan', hint: 'Typed in on this computer.' },
  IMPORTED: { tone: 'cyan', hint: 'Imported from a file. Not a live connection.' },
  'SIMULATED DEMO': { tone: 'violet', hint: 'Every reading, symptom and alert here is simulated. No astronaut data.' },
  UNAVAILABLE: { tone: 'muted', hint: 'No mission records on this computer yet.' },
}

export const ORIGIN_LABEL: Record<StoredEvent['origin']['kind'], string> = {
  WATCH_RULES: 'Watch rules',
  MISSION_COMPUTER_CHECK: 'Mission computer check',
  DEMO_TRIGGER: 'Simulated trigger',
  DEMO_FIXTURE: 'Simulated watch',
}

export const REVIEW_META: Record<StoredEvent['review']['state'], { label: string; tone: Tone }> = {
  NOT_STARTED: { label: 'Not reviewed', tone: 'muted' },
  IN_PROGRESS: { label: 'Review in progress', tone: 'violet' },
  REVIEWED: { label: 'Reviewed', tone: 'mint' },
  CLOSED: { label: 'Closed', tone: 'muted' },
}

const t = (iso: string) => Date.parse(iso)

export const isOpen = (e: StoredEvent) => e.status !== 'REVIEWED' && e.status !== 'CLOSED'

/** Open events first, then by severity, then ones the wearer has not acknowledged, then newest first. */
export function sortEvents(events: StoredEvent[]): StoredEvent[] {
  return [...events].sort(
    (a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) ||
      SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank ||
      Number(!b.acknowledgement) - Number(!a.acknowledgement) ||
      t(b.createdAt) - t(a.createdAt),
  )
}

export function subjectLabel(id: string): string {
  return DEMO_SUBJECT_LABELS[id] ?? id
}

export function subjectsOf(ds: Dataset): { id: string; label: string }[] {
  const ids = new Set<string>()
  for (const s of Object.values(ds.sessions)) ids.add(s.subjectId)
  for (const e of Object.values(ds.events)) ids.add(e.subjectId)
  for (const d of Object.values(ds.devices)) if (d.subjectId) ids.add(d.subjectId)
  return [...ids].sort().map((id) => ({ id, label: subjectLabel(id) }))
}

export function sessionsOf(ds: Dataset, subjectId: string | null): StoredSession[] {
  return Object.values(ds.sessions)
    .filter((s) => !subjectId || s.subjectId === subjectId)
    .sort((a, b) => t(b.startedAt) - t(a.startedAt))
}

export function eventsOf(ds: Dataset, subjectId: string | null): StoredEvent[] {
  return sortEvents(Object.values(ds.events).filter((e) => !subjectId || e.subjectId === subjectId))
}

/** The record the overview is about: the subject's most pressing open event, else their latest session. */
export function focusFor(ds: Dataset, subjectId: string | null): { event: StoredEvent | null; session: StoredSession | null; latestEvent: StoredEvent | null } {
  const events = eventsOf(ds, subjectId)
  const event = events.find(isOpen) ?? null
  const latestEvent = [...events].sort((a, b) => t(b.createdAt) - t(a.createdAt))[0] ?? null
  const fromEvent = event?.sessionId ? (ds.sessions[event.sessionId] ?? null) : null
  return { event, session: fromEvent ?? sessionsOf(ds, subjectId)[0] ?? null, latestEvent }
}

/** The subject whose open event most needs attention, used as the default selection. */
export function defaultSubject(ds: Dataset): string | null {
  const top = sortEvents(Object.values(ds.events)).find(isOpen)
  return top?.subjectId ?? subjectsOf(ds)[0]?.id ?? null
}

/** The data-source label for the header. The demo workspace is always SIMULATED DEMO. */
export function bannerSourceMode(ds: Dataset, links: Record<string, LinkState>, subjectId: string | null): SourceMode {
  if (ds.workspace === 'demo') return 'SIMULATED DEMO'
  const sessions = sessionsOf(ds, subjectId)
  const events = eventsOf(ds, subjectId)
  const record = sessions[0] ?? events[0] ?? sessionsOf(ds, null)[0] ?? eventsOf(ds, null)[0]
  if (!record) return 'UNAVAILABLE'
  const deviceId = record.provenance.deviceId
  const link: LinkState = (deviceId && links[deviceId]) || 'NOT_PAIRED'
  return recordSourceMode(record, link)
}

// ---------------------------------------------------------------------------
// Body regions

export type Region = BodyRegionT
export type RegionState = 'neutral' | 'data' | 'caution' | 'symptom'

export interface RegionItem {
  kind: 'symptom' | 'reading' | 'device' | 'external'
  title: string
  detail: string
  tone: Tone
}

export interface RegionInfo {
  region: Region
  name: string
  state: RegionState
  callout: string | null
  items: RegionItem[]
  note: string | null
}

const REGION_NAME: Record<Region, string> = { HEAD: 'Head', CHEST: 'Chest', ARMS: 'Arms and wrist', LEGS: 'Legs' }

/** Where a symptom goes on the figure: the reported location, or the head for dizziness. Otherwise nowhere. */
export function symptomRegion(s: Symptom): Region | null {
  return s.bodyRegion ?? (s.code === 'DIZZY' ? 'HEAD' : null)
}

export function regionsFor(
  session: StoredSession | null,
  readings: StoredMeasurement[],
): Record<Region, RegionInfo> & { unplaced: Symptom[] } {
  const make = (region: Region): RegionInfo => ({ region, name: REGION_NAME[region], state: 'neutral', callout: null, items: [], note: null })
  const r = { HEAD: make('HEAD'), CHEST: make('CHEST'), ARMS: make('ARMS'), LEGS: make('LEGS') }
  const unplaced: Symptom[] = []
  if (!session) return { ...r, unplaced }

  for (const s of session.symptoms) {
    const region = symptomRegion(s)
    if (!region) {
      unplaced.push(s)
      continue
    }
    const who = s.reportedBy === 'SELF_REPORTED' ? 'SELF-REPORTED' : 'CREW-OBSERVED'
    const title = `${SYMPTOM_LABEL[s.code]} — ${who}`
    const target = r[region]
    target.state = 'symptom'
    target.callout ??= title
    target.items.push({ kind: 'symptom', title, detail: `Reported ${utcTime(s.reportedAt)}${s.note ? ` · ${s.note}` : ''}`, tone: 'coral' })
    if (!s.bodyRegion) target.note = 'The watch did not record a location. Dizziness is shown at the head because that is where it is felt.'
  }

  const c = comparePhases(session)
  const validCount = c.rest.valid.length + c.recovery.valid.length
  if (validCount > 0) {
    const summary =
      c.status === 'CALCULATED'
        ? `Rest median ${c.restMedian} bpm, recovery median ${c.recoveryMedian} bpm`
        : 'Too few valid readings for a phase comparison'
    r.CHEST.items.push({ kind: 'reading', title: `HEART RATE · ${plural(validCount, 'VALID READING')}`, detail: summary, tone: 'cyan' })
    if (r.CHEST.state === 'neutral') {
      r.CHEST.state = 'data'
      r.CHEST.callout = `HEART RATE · ${plural(validCount, 'VALID READING')}`
    }
    r.CHEST.note ??= 'Heart rate is measured by the optical sensor at the wrist. It is shown here because it describes the heart’s response.'
  }
  for (const b of readings.filter((x) => x.indicator !== 'HEART_RATE')) {
    const flagged = b.quality !== 'VALID'
    r.CHEST.items.push({
      kind: 'external',
      title: `${b.indicator === 'BLOOD_PRESSURE_SYSTOLIC' ? 'SYSTOLIC' : 'DIASTOLIC'} ${b.value ?? '--'} mmHg · EXTERNAL`,
      detail: `${b.source.device ?? 'External instrument'}, ${utcTime(b.measuredAt)}${flagged ? ` · marked ${b.quality.toLowerCase()}` : ''}. Not measured by the watch.`,
      tone: flagged ? 'amber' : 'cyan',
    })
    if (flagged && r.CHEST.state !== 'symptom') {
      r.CHEST.state = 'caution'
      r.CHEST.callout = 'BP READING · CHECK SOURCE'
    }
  }

  const hr = session.measurements.filter((m) => m.indicator === 'HEART_RATE')
  if (hr.length > 0) {
    const excluded = [...c.rest.excluded, ...c.recovery.excluded]
    const device = hr[0].source.device ?? 'Wrist device'
    const why = [...new Set(excluded.map((x) => EXCLUSION_LABEL[x.reason].toLowerCase()))].join('; ')
    r.ARMS.items.push({
      kind: 'device',
      title: `WRIST SENSOR · ${device.toUpperCase()}`,
      detail: `${plural(hr.length, 'reading')} recorded${excluded.length ? `, ${excluded.length} left out (${why})` : ', none left out'}.`,
      tone: excluded.length ? 'amber' : 'cyan',
    })
    if (r.ARMS.state === 'neutral') {
      r.ARMS.state = excluded.length ? 'caution' : 'data'
      r.ARMS.callout = excluded.length ? `WRIST SENSOR · ${excluded.length} LEFT OUT` : `WRIST SENSOR · ${plural(hr.length, 'READING')}`
    }
  }
  return { ...r, unplaced }
}
