import { useSyncExternalStore } from 'react'

export interface CrewProfile {
  id: string
  name: string
  deviceId: string | null
  history?: string
  limitations?: string
  notes?: string
}

const storageKey = 'gg.crew-profiles'
const eventName = 'gg:crew-change'
let saved = ''
try {
  saved = sessionStorage.getItem(storageKey) ?? ''
} catch {
  // Profiles can still be kept in memory for the current page.
}

function readCrew(): { activeId: string; profiles: CrewProfile[] } {
  try {
    if (saved) return JSON.parse(saved)
  } catch {
    // Ignore an unreadable session.
  }
  return { activeId: '', profiles: [] }
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
