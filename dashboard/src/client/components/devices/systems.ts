/**
 * Monitoring systems: what kind of device a paired link is, whether its link is live, and its
 * latest readings. Pure functions, no React. Every reading keeps its unit, time, source,
 * simulated flag and quality, and a missing value stays null.
 */
import { LINK_FRESH_SECONDS, type LinkState, type Workspace } from '../../../shared/dataset'
import type { WatchFrame } from '../../../shared/watch-link'
import { LINK_META, type Tone } from '../../lib/view'

export type SystemKind = 'ouranos-watch' | 'chest-strap' | 'bp-cuff' | 'suit-biomonitor' | 'generic'

export const SYSTEM_KIND_META: Record<SystemKind, { name: string; measures: string }> = {
  'ouranos-watch': { name: 'Ouranos watch', measures: 'Wrist heart rate, respiration, oxygen and motion' },
  'chest-strap': { name: 'Chest strap', measures: 'ECG heart rate, respiration and heart rate variability' },
  'bp-cuff': { name: 'Blood pressure cuff', measures: 'Systolic and diastolic pressure and pulse' },
  'suit-biomonitor': { name: 'Suit biomonitor', measures: 'Heart rate, respiration, suit pressure, CO2 and skin temperature' },
  generic: { name: 'Monitoring system', measures: 'Readings from a paired monitoring system' },
}

/** Source labels each kind is known to send, real and simulated. Matched without case. */
const KNOWN_SOURCES: Record<Exclude<SystemKind, 'generic'>, string[]> = {
  'ouranos-watch': ['Watch sensors', 'Mock watch simulation', 'ISS EMU / Bio-Monitor simulation'],
  'chest-strap': ['Chest strap', 'Chest strap simulation'],
  'bp-cuff': ['Blood pressure cuff', 'Blood pressure cuff simulation'],
  'suit-biomonitor': ['Suit biomonitor', 'Suit biomonitor simulation'],
}

const normalise = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()
const SOURCE_KIND = new Map<string, SystemKind>(
  Object.entries(KNOWN_SOURCES).flatMap(([kind, labels]) => labels.map((label) => [normalise(label), kind as SystemKind] as const)),
)

export function isSystemKind(value: unknown): value is SystemKind {
  return typeof value === 'string' && Object.hasOwn(SYSTEM_KIND_META, value)
}

/** The kind a frame's source label names. Anything not known is a generic monitoring system. */
export function systemKindFromSource(source: string | null | undefined): SystemKind {
  return (source && SOURCE_KIND.get(normalise(source))) || 'generic'
}

/** The latest frame decides the kind. Before the first frame, a kind saved at pairing is used. */
export function resolveSystemKind(frame: Pick<WatchFrame, 'source'> | null | undefined, savedKind?: string): SystemKind {
  if (frame) return systemKindFromSource(frame.source)
  return isSystemKind(savedKind) ? savedKind : 'generic'
}

/**
 * The link state of one system, with the app's thresholds: verified means authenticated contact
 * (a heartbeat the server recorded, or a frame the system posted with its token) within the last
 * LINK_FRESH_SECONDS. A system the server no longer lists is not paired.
 */
export function systemLinkState({ listed, serverLink, lastFrameAt, nowMs }: {
  listed: boolean
  serverLink?: LinkState | null
  /** observedAt of the latest frame, in seconds. */
  lastFrameAt?: number | null
  nowMs: number
}): LinkState {
  if (!listed) return 'NOT_PAIRED'
  if (serverLink === 'SIMULATED' || serverLink === 'VERIFIED') return serverLink
  if (lastFrameAt != null && nowMs / 1000 - lastFrameAt <= LINK_FRESH_SECONDS) return 'VERIFIED'
  return 'WATCH_UNREACHABLE'
}

const OTHER_LINK: Record<LinkState, { label: string; hint: string }> = {
  VERIFIED: { label: 'Link verified', hint: LINK_META.VERIFIED.hint },
  WATCH_UNREACHABLE: { label: 'System unreachable', hint: LINK_META.WATCH_UNREACHABLE.hint },
  NOT_PAIRED: { label: 'Not paired', hint: 'This computer has no pairing for this system now. Pair it again to see new readings.' },
  SIMULATED: { label: 'Simulated system', hint: LINK_META.SIMULATED.hint },
}

/** The watch keeps the app's own wording; other systems get the same states without "watch". */
export function linkMeta(state: LinkState, kind: SystemKind): { label: string; tone: Tone; hint: string } {
  return kind === 'ouranos-watch' ? LINK_META[state] : { ...OTHER_LINK[state], tone: LINK_META[state].tone }
}

export const QUALITY_LABEL: Record<WatchFrame['readings'][number]['quality'], string> = {
  valid: 'Valid',
  suspect: 'Suspect',
  missing: 'Missing',
}

export interface SystemReading {
  metric: string
  /** null when the system reported the reading as missing. */
  value: number | null
  unit: string
  quality: WatchFrame['readings'][number]['quality']
  flagged: boolean
  /** When it was measured, in seconds. Falls back to when the frame was sent. */
  time: number
  source: string
  simulated: boolean
}

export function latestReadings(frame: WatchFrame | null | undefined): SystemReading[] {
  if (!frame) return []
  return frame.readings.map((r) => ({
    metric: r.metric,
    value: r.quality === 'missing' ? null : r.value,
    unit: r.unit,
    quality: r.quality,
    flagged: r.status !== 'nominal',
    time: r.measuredAt ?? frame.observedAt,
    source: frame.source,
    simulated: frame.simulated,
  }))
}

/** A frame is current while it is younger than the freshness it declares (15 s by default). */
export function frameIsCurrent(frame: WatchFrame, nowMs: number): boolean {
  const age = nowMs / 1000 - frame.observedAt
  return age >= -5 && age <= (frame.freshnessSeconds ?? 15)
}

/** The metric the sparkline follows: heart rate when the system has it, else its first reading. */
export function sparkMetric(frame: WatchFrame | null | undefined): { metric: string; unit: string } | null {
  const pick = frame?.readings.find((r) => /heart rate$/i.test(r.metric)) ?? frame?.readings[0]
  return pick ? { metric: pick.metric, unit: pick.unit } : null
}

/** One point per frame that carried the metric; invalid readings are gaps (null), never zero. */
export function sparkPoints(frames: readonly WatchFrame[], metric: string, unit: string): { t: number; v: number | null }[] {
  const points = new Map<number, number | null>()
  for (const frame of frames) {
    const r = frame.readings.find((x) => x.metric === metric && x.unit === unit)
    if (!r) continue
    points.set((r.measuredAt ?? frame.observedAt) * 1000, r.quality === 'valid' ? r.value : null)
  }
  return [...points].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
}

/**
 * Simulated readings show only in the simulated demo and real readings only with mission records,
 * like the watch charts, so neither is ever shown under the other's label.
 */
export function readingsBelongIn(frame: Pick<WatchFrame, 'simulated'>, workspace: Workspace) {
  return frame.simulated === (workspace === 'demo')
}

/** "12 s ago", "4 min ago": how long since a time, for contact and reading times. */
export function ago(seconds: number, nowMs: number): string {
  const s = Math.max(0, Math.round(nowMs / 1000 - seconds))
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return `${Math.floor(s / 3600)} h ago`
}
