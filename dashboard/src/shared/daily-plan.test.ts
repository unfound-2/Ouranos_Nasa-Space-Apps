import { describe, expect, it } from 'vitest'
import { actOnPlan, DaySchema, demoDay, proposePlan } from './daily-plan'

describe('daily plan constraints', () => {
  it('defers a flexible activity on fatigue, preserves health and fixed activities, and does not repeat after acceptance', () => {
    const p = actOnPlan(demoDay(), { type: 'checkin', fatigue: 'very' })
    const suggestion = proposePlan(p)
    expect(suggestion.changes).toHaveLength(1)
    expect(suggestion.changes[0].id).toBe('inventory')
    for (const t of p.tasks.filter(t => t.kind !== 'flexible')) expect(suggestion.tasks.find(x => x.id === t.id)).toEqual(t)
    expect(proposePlan({ ...p, tasks: suggestion.tasks, fatigueReviewed: true }).changes).toEqual([])
  })
  it('moves flexible work out of a delay without touching protected sleep', () => {
    const day = demoDay()
    day.tasks.push({ id: 'flex', title: 'Flexible note', start: 990, duration: 30, kind: 'flexible', note: '', done: false, deferred: false })
    const p = actOnPlan(day, { type: 'delay', taskId: 'measure', minutes: 30 })
    const s = proposePlan(p)
    expect(s.tasks.find(t => t.id === 'flex')?.start).toBe(1020)
    expect(s.tasks.filter(t => !t.deferred).every(t => t.start + t.duration <= p.sleepStart)).toBe(true)
  })
  it('exposes unsolvable fixed-health collisions rather than moving either', () => {
    const p = actOnPlan(demoDay(), { type: 'delay', taskId: 'research', minutes: 60 })
    const s = proposePlan(p)
    expect(s.conflicts.join(' ')).toMatch(/Research session overlaps Prescribed exercise/)
    expect(s.tasks.find(t => t.id === 'exercise')?.start).toBe(660)
  })
  it('defers work that would intrude on sleep and keeps it pending tomorrow', () => {
    const p = actOnPlan(demoDay(), { type: 'delay', taskId: 'records', minutes: 30 })
    expect(proposePlan(p).tasks.find(t => t.id === 'records')?.deferred).toBe(true)
  })
  it('rejects duplicate tasks, invalid times and delay actions on completed tasks', () => {
    const p = demoDay()
    expect(DaySchema.safeParse({ ...p, tasks: [p.tasks[0], p.tasks[0]] }).success).toBe(false)
    expect(DaySchema.safeParse({ ...p, tasks: [{ ...p.tasks[0], start: 1430 }] }).success).toBe(false)
    const done = actOnPlan(p, { type: 'done', taskId: 'brief' })
    expect(() => actOnPlan(done, { type: 'delay', taskId: 'brief', minutes: 15 })).toThrow()
  })
})
