import type { AssistantRequest } from '../../shared/crew-assistant'
import { comparePhases } from '../../shared/analysis'
import type { StoredEvent, StoredSession } from '../../shared/contract'
import type { Dataset } from '../../shared/dataset'
import { buildEventContext, eventTitle, reasonLine } from '../../shared/explain'
import { crewSystems, useCrewProfile } from '../lib/crew-profile'
import { useData } from '../lib/data'
import { href } from '../lib/router'
import type { useSimulatorSamples } from './WatchCharts'

export function useAttentionSummary({ event, session, dataset, serverTime, deviceId, simulated, historical = false }: {
  event: StoredEvent | null
  session: StoredSession | null
  dataset: Dataset
  serverTime: string
  deviceId?: string | null
  historical?: boolean
  simulated: ReturnType<typeof useSimulatorSamples>
}) {
  const { watchLinks, workspace, watchHistory } = useData()
  const profile = useCrewProfile()
  const scopedDevices = new Set(crewSystems(profile).map((system) => system.deviceId))
  if (deviceId) scopedDevices.add(deviceId)
  const now = Date.parse(serverTime) / 1000
  const frames = (historical ? [] : watchLinks ?? [])
    .filter((link) => workspace !== 'demo' && (scopedDevices.size > 0 ? scopedDevices.has(link.deviceId) : !profile && deviceId === undefined))
    .flatMap((link) => {
      const testFeed = workspace === 'demo' || link.watch?.simulated === true
      return [...(link.watch ? [link.watch] : []), ...link.telemetry].filter((frame) => frame.simulated === testFeed).map((frame) => ({ frame, deviceId: link.deviceId }))
    })
    .filter(({ frame }) => now - frame.observedAt <= (frame.freshnessSeconds ?? 60)
      && frame.observedAt <= now + 5)
  const signals = new Map<string, { simulated: boolean; deviceId: string; frameSource: string; label: string; status: string; time: number; value: number; unit: string; source: string }>()
  for (const { frame, deviceId } of frames) {
    for (const reading of frame.readings) {
      const time = reading.measuredAt ?? frame.observedAt
      if (reading.quality !== 'valid' || now - time > (frame.freshnessSeconds ?? 60) || time > now + 5) continue
      const key = reading.metric.trim().toLowerCase()
      if ((signals.get(key)?.time ?? -Infinity) >= time) continue
      signals.set(key, { deviceId, frameSource: frame.source, simulated: frame.simulated, label: reading.metric, status: reading.status, time, value: reading.value, unit: reading.unit, source: frame.simulated && workspace === 'mission' ? 'Watch test feed' : frame.source })
    }
  }
  const observed = [...signals.values()]
  const flagged = observed.filter(({ status }) => status === 'priority' || status === 'review')
  const priority = flagged.find(({ status }) => status === 'priority') ?? flagged[0]
  const latest = simulated[simulated.length - 1]
  const sampleChanges = latest && [
    { label: 'Heart rate', value: latest.heartRate - 69, tolerance: 3, unit: 'bpm' },
    { label: 'Breathing rate', value: latest.respiration - 14, tolerance: 1, unit: 'breaths/min' },
    { label: 'Systolic pressure', value: latest.systolic - 116, tolerance: 2, unit: 'mmHg' },
    { label: 'Diastolic pressure', value: latest.diastolic - 73, tolerance: 2, unit: 'mmHg' },
    { label: 'Oxygen saturation', value: latest.oxygen - 98, tolerance: .3, unit: 'points' },
    { label: 'Skin temperature', value: latest.temperature - 33.2, tolerance: .1, unit: '°C' },
  ]
  const ctx = event ? buildEventContext(event, dataset, serverTime) : null
  const demoChanges = workspace === 'demo' && !historical
    ? sampleChanges?.filter(({ label }) => !observed.some((item) => item.label.toLowerCase() === label.toLowerCase()))
    : null
  const shifted = demoChanges?.filter(({ value, tolerance }) => Math.abs(value) > tolerance + 1e-6) ?? []
  const warning = Boolean(event || priority)
  const watchEvent = event?.reasonCodes.includes('WATCH_TELEMETRY_FLAG') ?? false
  const recordedFlags = watchEvent ? event?.evidence.flatMap(({ kind, note }) => kind === 'DEVICE' && note ? [note] : []) ?? [] : []
  const hasLiveFlag = (pattern: RegExp) => flagged.some(({ label }) => pattern.test(label))
  const change = (name: string) => shifted.find(({ label }) => label === name)?.value ?? 0
  const earlier = simulated[simulated.length - 5]
  const pulseUp = change('Heart rate') > 0
  const breathingUp = change('Breathing rate') > 0
  const pressureUp = change('Systolic pressure') > 0
  const oxygenDown = change('Oxygen saturation') < 0
  const warming = change('Skin temperature') > 0
  const title = ctx ? eventTitle(ctx) : priority ? `${priority.label} flagged`
    : demoChanges ? shifted.length ? 'Change from simulated rest' : 'Near simulated rest'
    : observed.length ? 'No readings flagged' : 'Waiting for readings'
  const details = ctx ? reasonLine(ctx) : priority
    ? flagged.map(({ label, value, unit }) => `${label} ${value} ${unit}`.trim()).join(', ')
    : demoChanges && shifted.length ? `${shifted.map(({ label }) => label).join(', ')} changed from simulated rest.` : ''
  const dizziness = (session ?? ctx?.session)?.symptoms.some((symptom) => symptom.code === 'DIZZY')
  const nextStep = dizziness
    ? 'If the dizziness began after standing, the crew medical officer can assess for orthostatic intolerance. Record when it started and the crew member’s posture, then follow the mission’s approved procedure.'
    : warning ? 'Open the source record and check the reading, timestamp and any reported symptoms. Share the findings with the crew medical officer using the mission’s approved procedure.'
    : 'Keep the readings with their source and timestamp so the crew can compare them with the next assessment.'

  let interpretation = title
  let explanation = ''
  if (dizziness) {
    interpretation = 'Lightheadedness during recovery'
    explanation = 'Check when the dizziness started and whether it followed a change in posture.'
  } else if (priority) {
    if (hasLiveFlag(/oxygen saturation|spo2/i) && hasLiveFlag(/respirat|breath/i)) {
      interpretation = 'Oxygen and breathing changed together'
      explanation = 'Two readings were flagged. Check whether they were taken at the same time and whether the pattern persists on repeat readings.'
    } else if (hasLiveFlag(/heart rate|pulse/i) && hasLiveFlag(/respirat|breath/i)) {
      interpretation = 'Pulse and breathing both flagged'
      explanation = 'Check whether both readings settle during recovery or remain flagged at rest. The readings alone cannot show what caused the change.'
    } else {
      interpretation = `${priority.label} needs a recheck`
      explanation = flagged.length > 1
        ? 'Compare the flagged readings and their timestamps to see whether the changes occurred together.'
        : 'Check the source and compare this reading with the next one to see if the change persists.'
    }
  } else if (watchEvent && !demoChanges) {
    interpretation = historical ? 'Readings flagged by the watch' : 'Earlier readings were flagged'
    explanation = historical
      ? 'These are the readings recorded with the warning. Look for a comparable repeat before drawing conclusions about a trend.'
      : 'There is no current flagged reading to confirm whether the change is still present.'
  } else if (event && !watchEvent) {
    explanation = details
  } else if (demoChanges) {
    if (earlier && latest && (pulseUp || breathingUp) && latest.heartRate <= earlier.heartRate - 3 && latest.respiration < earlier.respiration) {
      interpretation = 'Pulse and breathing are settling'
      explanation = 'Both are lower than the previous readings but at least one is still above simulated rest.'
    } else if (pulseUp && breathingUp && pressureUp) {
      interpretation = 'Pulse, breathing and pressure are elevated'
      explanation = 'All three are above simulated rest. The next readings will show whether they come back down together.'
    } else if (oxygenDown) {
      interpretation = 'Oxygen is below the simulated resting level'
      explanation = breathingUp ? 'Breathing is also above rest. Check whether both return toward baseline.' : 'Track whether oxygen returns toward its resting level on the next readings.'
    } else if (warming && !pulseUp && !breathingUp) {
      interpretation = 'Skin temperature is still above rest'
      explanation = 'Neither pulse nor breathing is currently elevated in the simulated feed.'
    } else if (shifted.length) {
      interpretation = `${shifted[0].label} is ${shifted[0].value > 0 ? 'above' : 'below'} simulated rest`
      explanation = 'Compare the next reading with the resting level to see whether the change continues.'
    } else {
      interpretation = 'Readings are near simulated rest'
    }
  }
  const triggerReadings = [...new Set([
    ...recordedFlags,
    ...flagged.map(({ source, label, value, unit }) => `${source}  ${label} ${value} ${unit}`.trim()),
    ...(warning || shifted.length ? shifted.map(({ label, value, unit }) => {
      const source = /heart|breathing/i.test(label) ? 'Simulated watch' : 'Simulated ISS Bio-Monitor'
      return `${source}  ${label} ${value > 0 ? '+' : ''}${Number(value.toFixed(1))} ${unit} from rest`
    }) : []),
  ])]

  const deltas: AssistantRequest['readings'] = observed.map((item) => {
    const previous = (watchHistory[item.deviceId] ?? []).flatMap((frame) =>
      frame.source === item.frameSource && frame.simulated === item.simulated
        ? frame.readings.filter((reading) => reading.metric === item.label && reading.unit === item.unit && reading.quality === 'valid')
          .map((reading) => ({ time: reading.measuredAt ?? frame.observedAt, value: reading.value })) : [],
    ).filter((reading) => reading.time < item.time && item.time - reading.time <= 900).sort((a, b) => b.time - a.time)[0]
    return { label: item.label, value: item.value, unit: item.unit, status: item.status,
      ...(previous ? { delta: item.value - previous.value, comparison: 'Previous valid reading' } : {}) }
  })
  const comparison = session ? comparePhases(session) : null
  if ((historical || !observed.length) && comparison?.status === 'CALCULATED') {
    deltas.push({ label: 'Heart rate', value: comparison.recoveryMedian, delta: comparison.observedDelta, unit: 'bpm', comparison: 'Recovery median vs rest median' })
  }
  for (const { label, value, unit } of demoChanges ?? []) {
    deltas.push({ label, delta: value, unit, comparison: 'Simulated rest reference' })
  }
  if (historical) for (const note of recordedFlags) {
    const fields = note.split(/\s+·\s+| {2,}/)
    const match = /^(.*) (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?) (\S.*)$/i.exec(fields[1] ?? '')
    if (!match || !['review', 'priority'].includes(fields[2]) || !Number.isFinite(Number(match[2]))) continue
    deltas.push({ label: match[1].slice(0, 80), value: Number(match[2]), unit: match[3].slice(0, 24), status: fields[2] })
  }
  const evidenceText = [...recordedFlags, details].join(' ')
  const topic = dizziness ? 'dizziness'
    : hasLiveFlag(/oxygen|spo2/i) || oxygenDown || /oxygen saturation|spo2/i.test(evidenceText) ? 'oxygen-breathing'
    : hasLiveFlag(/pulse|heart|breath|respirat/i) || pulseUp || breathingUp || /heart rate|breathing rate|respiration/i.test(evidenceText) ? 'pulse-recovery'
    : hasLiveFlag(/pressure/i) ? 'pressure'
    : hasLiveFlag(/temperature/i) || warming ? 'temperature'
    : 'reading-check'

  return {
    guideTopic: topic,
    eventId: event?.eventId,
    deltas: deltas.slice(0, 12),
    feed: (workspace === 'demo' || event?.isSimulated ? 'demo' : observed.some((reading) => reading.simulated) ? 'test'
      : deltas.length || event ? 'recorded' : 'unavailable') as AssistantRequest['feed'],
    warning, title, details, nextStep, interpretation, explanation, triggerReadings,
    readings: observed,
    simulatedReadings: demoChanges?.map(({ label, value, unit, tolerance }) => ({ label, value, unit, tolerance })) ?? [],
    link: event ? href.event(event.eventId) : session ? href.session(session.sessionId) : href.system,
    linkLabel: event ? 'See evidence' : session ? 'See assessment' : 'Watch connection',
  }
}

export function AttentionSummary({ summary }: { summary: ReturnType<typeof useAttentionSummary> }) {
  return (
    <section className="panel attention-card">
      <h2 className="faded-label text-sm font-semibold">What needs attention</h2>
      <div className="mt-2">
        <h3 className="font-semibold">{summary.interpretation}</h3>
        {summary.explanation && <details className="flag-reading-dropdown mt-1">
          <summary>Why this stands out</summary>
          <p className="attention-popover text-sm">{summary.explanation}</p>
        </details>}
      </div>
      <a className="mt-2 inline-block text-sm underline" href={href.attention}>What to do next</a>
    </section>
  )
}
