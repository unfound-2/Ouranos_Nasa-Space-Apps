import { useSyncExternalStore } from 'react'

/** One paired monitoring system. `kind` is a hint saved at pairing; the latest frame decides. */
export interface CrewSystem {
  deviceId: string
  kind?: string
}

export interface CrewProfile {
  id: string
  name: string
  /** The crew member's watch. Pages that show one device use this one. */
  deviceId: string | null
  /** Every monitoring system the crew member owns, the watch included. Older profiles lack it. */
  systems?: CrewSystem[]
  history?: string
  limitations?: string
  notes?: string
}

interface CrewState {
  activeId: string
  profiles: CrewProfile[]
}

const storageKey = 'gg.crew-profiles'
const eventName = 'gg:crew-change'
let saved = ''
try {
  saved = sessionStorage.getItem(storageKey) ?? ''
} catch {
  // Profiles can still be kept in memory for the current page.
}

function cleanSystems(value: unknown): CrewSystem[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((s) => {
    if (typeof s?.deviceId !== 'string' || !s.deviceId) return []
    return [typeof s.kind === 'string' ? { deviceId: s.deviceId, kind: s.kind } : { deviceId: s.deviceId }]
  })
}

/** Read saved crew state. Profiles saved before systems existed keep working unchanged. */
export function parseCrewState(raw: string): CrewState {
  try {
    const data = raw ? JSON.parse(raw) : null
    if (data && Array.isArray(data.profiles)) {
      const profiles = (data.profiles as unknown[]).flatMap((p): CrewProfile[] => {
        if (!p || typeof p !== 'object') return []
        const profile = p as Record<string, unknown>
        if (typeof profile.id !== 'string' || typeof profile.name !== 'string') return []
        const systems = cleanSystems(profile.systems)
        const next: CrewProfile = { ...(profile as unknown as CrewProfile), deviceId: typeof profile.deviceId === 'string' && profile.deviceId ? profile.deviceId : null }
        if (systems) next.systems = systems
        else delete next.systems
        return [next]
      })
      return { activeId: typeof data.activeId === 'string' ? data.activeId : '', profiles }
    }
  } catch {
    // Ignore an unreadable session.
  }
  return { activeId: '', profiles: [] }
}

function readCrew(): CrewState {
  return parseCrewState(saved)
}

/** Every system a crew member owns, the watch first, without duplicates. */
export function crewSystems(profile: Pick<CrewProfile, 'deviceId' | 'systems'> | null | undefined): CrewSystem[] {
  if (!profile) return []
  const listed = cleanSystems(profile.systems) ?? []
  const all = profile.deviceId ? [listed.find((s) => s.deviceId === profile.deviceId) ?? { deviceId: profile.deviceId }, ...listed] : listed
  const seen = new Set<string>()
  return all.filter((s) => !seen.has(s.deviceId) && Boolean(seen.add(s.deviceId)))
}

/** Add a system to a crew member. The watch (deviceId) stays as it was. */
export function withSystem(profile: CrewProfile, system: CrewSystem): CrewProfile {
  const others = crewSystems(profile).filter((s) => s.deviceId !== system.deviceId)
  return { ...profile, systems: [...others, system] }
}

/** Remove a system the crew member no longer uses. Removing the watch also clears deviceId. */
export function withoutSystem(profile: CrewProfile, deviceId: string): CrewProfile {
  return {
    ...profile,
    deviceId: profile.deviceId === deviceId ? null : profile.deviceId,
    systems: crewSystems(profile).filter((s) => s.deviceId !== deviceId),
  }
}

/** Replace the crew member's watch after a new pairing, dropping the old watch from the systems. */
export function withWatch(profile: CrewProfile, deviceId: string): CrewProfile {
  const others = crewSystems(profile).filter((s) => s.deviceId !== profile.deviceId && s.deviceId !== deviceId)
  return profile.systems ? { ...profile, deviceId, systems: [{ deviceId, kind: 'ouranos-watch' }, ...others] } : { ...profile, deviceId }
}

export function currentCrew() {
  const { activeId, profiles } = readCrew()
  return profiles.find((profile) => profile.id === activeId) ?? null
}

export function saveCrew(profile: CrewProfile) {
  const { profiles } = readCrew()
  saved = JSON.stringify({ activeId: profile.id, profiles: [...profiles.filter((existing) => existing.id !== profile.id), profile] })
  try {
    sessionStorage.setItem(storageKey, saved)
  } catch {
    // Keep the current page usable when storage is unavailable.
  }
  window.dispatchEvent(new Event(eventName))
}

function subscribe(listener: () => void) {
  const update = () => {
    try { saved = sessionStorage.getItem(storageKey) ?? saved } catch { /* use in-memory state */ }
    listener()
  }
  window.addEventListener(eventName, update)
  return () => window.removeEventListener(eventName, update)
}

export function useCrewProfile() {
  useSyncExternalStore(subscribe, () => saved)
  return currentCrew()
}
