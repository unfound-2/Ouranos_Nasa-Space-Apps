/** Display formatting shared by explanations and the dashboard. All times are shown in UTC. */
import type { SymptomCodeT } from './contract'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

export function utcTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

export function utcClock(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export function utcDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function utcDateTime(iso: string): string {
  return `${utcDate(iso)} · ${utcTime(iso)}`
}

/** "2026-11-12 14:11:55Z" — compact, sortable, for tables. */
export function utcStamp(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
}

/** Signed number with a true minus sign: +23, −4, +11.5, 0. Whole numbers show no decimals. */
export function signed(n: number, digits?: number): string {
  if (digits === undefined) digits = Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1
  const v = Number(n.toFixed(digits))
  if (v > 0) return `+${v.toFixed(digits)}`
  if (v < 0) return `−${Math.abs(v).toFixed(digits)}`
  return (0).toFixed(digits)
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export const SYMPTOM_NOUN: Record<SymptomCodeT, string> = {
  DIZZY: 'dizziness',
  WEAK: 'weakness',
  NAUSEATED: 'nausea',
  OTHER: 'another symptom',
}

export const SYMPTOM_LABEL: Record<SymptomCodeT, string> = {
  DIZZY: 'DIZZINESS',
  WEAK: 'WEAKNESS',
  NAUSEATED: 'NAUSEA',
  OTHER: 'OTHER SYMPTOM',
}

/** "4 min ago", "3 h 12 min ago", "2 d ago" from two ISO times (or a millisecond clock). */
export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60} min ago`
  return `${Math.floor(h / 24)} d ago`
}
