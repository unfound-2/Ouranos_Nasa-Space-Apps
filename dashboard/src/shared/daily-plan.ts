import { z } from 'zod'

export const TaskSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().trim().min(1).max(100),
  start: z.number().int().min(0).max(1439), duration: z.number().int().min(5).max(720),
  kind: z.enum(['fixed', 'health', 'flexible']), done: z.boolean().default(false),
  deferred: z.boolean().default(false), note: z.string().max(400).default(''),
}).refine(t => t.start + t.duration <= 1440, 'Activity must end within this UTC day')
export const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), revision: z.number().int().nonnegative(),
  tasks: z.array(TaskSchema).max(64), sleepStart: z.number().int().min(1).max(1440),
  fatigue: z.enum(['rested', 'somewhat', 'very']).nullable(),
  fatigueReviewed: z.boolean().default(false),
  simulated: z.boolean(), updatedAt: z.string(),
}).refine(d => new Set(d.tasks.map(t => t.id)).size === d.tasks.length, 'Duplicate activity')
export type DayPlan = z.infer<typeof DaySchema>
export type PlanTask = z.infer<typeof TaskSchema>
export const PlanActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('checkin'), fatigue: z.enum(['rested', 'somewhat', 'very']) }),
  z.object({ type: z.literal('delay'), taskId: z.string(), minutes: z.number().int().min(5).max(120) }),
  z.object({ type: z.literal('done'), taskId: z.string() }),
])
export type PlanAction = z.infer<typeof PlanActionSchema>
export const utcDay = () => new Date().toISOString().slice(0, 10)
export const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export function emptyDay(date = utcDay()): DayPlan {
  return { date, revision: 0, tasks: [], sleepStart: 1320, fatigue: null, fatigueReviewed: false, simulated: false, updatedAt: new Date().toISOString() }
}
export function demoDay(date = utcDay()): DayPlan {
  const task = (id: string, title: string, start: number, duration: number, kind: PlanTask['kind'], note: string): PlanTask => ({ id, title, start, duration, kind, note, done: false, deferred: false })
  return { ...emptyDay(date), simulated: true, tasks: [
    task('brief', 'Crew briefing', 480, 30, 'fixed', 'Fixed mission commitment.'),
    task('research', 'Research session', 540, 90, 'fixed', 'Fixed mission commitment. Changes need operational review.'),
    task('exercise', 'Prescribed exercise', 660, 60, 'health', 'Follow the exercise plan assigned by your health team. This demo duration is illustrative.'),
    task('meal', 'Meal break', 720, 45, 'health', 'Time reserved for your existing nutrition routine.'),
    task('inventory', 'Inventory review', 780, 60, 'flexible', 'Can move to another available slot or be proposed for tomorrow.'),
    task('samples', 'Sample processing', 900, 60, 'fixed', 'Fixed mission commitment.'),
    task('measure', 'Routine measurements', 975, 15, 'health', 'Use your mission checklist and the instrument instructions. Record the measurement time and context.'),
    task('records', 'Update research notes', 1260, 45, 'flexible', 'Optional timing; can be deferred if no slot remains before sleep.'),
  ] }
}
export function actOnPlan(plan: DayPlan, action: PlanAction): DayPlan {
  const next = structuredClone(plan)
  if (action.type === 'checkin') { next.fatigue = action.fatigue; next.fatigueReviewed = false }
  else {
    const task = next.tasks.find(t => t.id === action.taskId && !t.done && !t.deferred)
    if (!task) throw new Error('This activity is no longer available. Refresh the plan.')
    if (action.type === 'done') task.done = true
    else {
      if (task.start + task.duration + action.minutes > 1440) throw new Error('This delay crosses the UTC day. Review it with the crew.')
      task.duration += action.minutes
    }
  }
  next.revision++
  next.updatedAt = new Date().toISOString()
  return next
}
const overlaps = (a: PlanTask, b: PlanTask) => a.start < b.start + b.duration && b.start < a.start + a.duration
export interface PlanProposal { tasks: PlanTask[]; changes: { id: string; title: string; before: string; after: string; reason: string }[]; conflicts: string[] }
/** Deterministic scheduling only. Never moves fixed or health activities, changes a prescription, or scores fitness for duty. */
export function proposePlan(plan: DayPlan): PlanProposal {
  const active = plan.tasks.filter(t => !t.done && !t.deferred)
  const protectedTasks = active.filter(t => t.kind !== 'flexible')
  const conflicts: string[] = []
  for (let i = 0; i < protectedTasks.length; i++) {
    const a = protectedTasks[i]
    if (a.start + a.duration > plan.sleepStart) conflicts.push(`${a.title} extends into protected sleep. Crew review needed.`)
    for (const b of protectedTasks.slice(i + 1)) if (overlaps(a, b)) conflicts.push(`${a.title} overlaps ${b.title}. Crew review needed.`)
  }
  const placed = [...protectedTasks]
  const changes: PlanProposal['changes'] = []
  const replacements = new Map<string, PlanTask>()
  let fatigueSpace = !plan.fatigueReviewed && plan.fatigue !== null && plan.fatigue !== 'rested'
  for (const original of active.filter(t => t.kind === 'flexible').sort((a, b) => a.start - b.start)) {
    const t = { ...original }
    if (fatigueSpace) {
      t.deferred = true
      fatigueSpace = false
      changes.push({ id: t.id, title: t.title, before: clock(t.start), after: 'Tomorrow · pending', reason: `You reported fatigue. Deferring this flexible activity frees ${t.duration} minutes for your existing fatigue-management routine. Tomorrow still needs scheduling.` })
    } else {
      while (t.start + t.duration <= plan.sleepStart) {
        const collision = placed.filter(p => overlaps(t, p)).sort((a, b) => a.start - b.start)[0]
        if (!collision) break
        t.start = collision.start + collision.duration
      }
      if (t.start + t.duration > plan.sleepStart) {
        t.deferred = true
        t.start = original.start
      }
      if (t.deferred || t.start !== original.start) changes.push({ id: t.id, title: t.title, before: clock(original.start), after: t.deferred ? 'Tomorrow · pending' : clock(t.start), reason: t.deferred ? 'No available slot remains before protected sleep. Tomorrow still needs scheduling.' : 'Moved to the next available slot, preserving fixed activities and your health routine.' })
    }
    replacements.set(t.id, t)
    if (!t.deferred) placed.push(t)
  }
  return { tasks: plan.tasks.map(t => replacements.get(t.id) ?? t), changes, conflicts }
}
