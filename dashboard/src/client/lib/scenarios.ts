/**
 * The six SIMULATED demo scenarios, so a presenter can show each one as a coherent story.
 * Each points at records in fixtures/simulated/demo-bundle.json (the computer-created event for
 * D and E is created by the data check when the demo loads, so its id is deterministic).
 */
export interface DemoScenario {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
  title: string
  summary: string
  subjectId: string
  sessionId: string
  eventId: string | null
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'A',
    title: 'Normal recovery check',
    summary: 'A completed check with enough readings and no symptoms. No event was raised.',
    subjectId: 'sim-crew-a',
    sessionId: 'sim-a-20261111',
    eventId: null,
  },
  {
    id: 'B',
    title: 'Dizziness self-reported',
    summary: 'The watch rule suggested a review. Recovery heart rate was 23 bpm above rest, with a baseline from three earlier checks.',
    subjectId: 'sim-crew-a',
    sessionId: 'sim-a-20261112',
    eventId: 'sim-evt-20261112-a',
  },
  {
    id: 'C',
    title: 'Too few heart-rate readings',
    summary: 'One valid reading per phase, so no phase comparison is calculated.',
    subjectId: 'sim-crew-b',
    sessionId: 'sim-b-20261112',
    eventId: 'sim-evt-20261112-b',
  },
  {
    id: 'D',
    title: 'Questionable cuff reading',
    summary: 'An imported cuff reading is stale and marked questionable, so the computer asks for source verification.',
    subjectId: 'sim-crew-b',
    sessionId: 'sim-b-20261113b',
    eventId: 'dq-sim-b-20261113b',
  },
  {
    id: 'E',
    title: 'Watch unreachable',
    summary: 'The computer could not deliver its alert to the watch. The evidence stays readable on the computer.',
    subjectId: 'sim-crew-b',
    sessionId: 'sim-b-20261113b',
    eventId: 'dq-sim-b-20261113b',
  },
  {
    id: 'F',
    title: 'Acknowledged, not reviewed',
    summary: 'The wearer acknowledged the alert on the watch; no reviewer has gone through the evidence yet.',
    subjectId: 'sim-crew-b',
    sessionId: 'sim-b-20261113a',
    eventId: 'sim-evt-20261113-b',
  },
]

export const scenarioById = (id: string | null) => DEMO_SCENARIOS.find((s) => s.id === id) ?? null
