import { describe, expect, it } from 'vitest'
import { crewSystems, parseCrewState, withoutSystem, withSystem, withWatch, type CrewProfile } from './crew-profile'

const old: CrewProfile = { id: 'p1', name: 'Ada', deviceId: 'watch-1' }

describe('crew profile migration', () => {
  it('reads a profile saved before systems existed and treats its watch as its one system', () => {
    const state = parseCrewState(JSON.stringify({ activeId: 'p1', profiles: [old] }))
    expect(state.activeId).toBe('p1')
    expect(state.profiles).toEqual([old])
    expect(crewSystems(state.profiles[0])).toEqual([{ deviceId: 'watch-1' }])
  })

  it('keeps a profile without a watch, and drops malformed systems and profiles', () => {
    const state = parseCrewState(JSON.stringify({
      activeId: 'p2',
      profiles: [
        { id: 'p2', name: 'Bo', deviceId: null, systems: [{ deviceId: 'watch-9', kind: 'chest-strap' }, { kind: 'bp-cuff' }, null, { deviceId: '' }] },
        { name: 'no id' },
        'junk',
      ],
    }))
    expect(state.profiles).toHaveLength(1)
    expect(state.profiles[0].deviceId).toBeNull()
    expect(state.profiles[0].systems).toEqual([{ deviceId: 'watch-9', kind: 'chest-strap' }])
  })

  it('reads empty or unreadable storage as no crew', () => {
    expect(parseCrewState('')).toEqual({ activeId: '', profiles: [] })
    expect(parseCrewState('{not json')).toEqual({ activeId: '', profiles: [] })
    expect(parseCrewState('{"profiles":"nope"}')).toEqual({ activeId: '', profiles: [] })
  })
})

describe('crew systems', () => {
  it('adding a system keeps the watch first and the watch deviceId unchanged', () => {
    const next = withSystem(old, { deviceId: 'watch-2' })
    expect(next.deviceId).toBe('watch-1')
    expect(crewSystems(next)).toEqual([{ deviceId: 'watch-1' }, { deviceId: 'watch-2' }])
    expect(crewSystems(withSystem(next, { deviceId: 'watch-3', kind: 'bp-cuff' })).map((s) => s.deviceId)).toEqual(['watch-1', 'watch-2', 'watch-3'])
  })

  it('pairing the same system twice does not list it twice', () => {
    const twice = withSystem(withSystem(old, { deviceId: 'watch-2' }), { deviceId: 'watch-2', kind: 'chest-strap' })
    expect(crewSystems(twice)).toEqual([{ deviceId: 'watch-1' }, { deviceId: 'watch-2', kind: 'chest-strap' }])
  })

  it('a crew member without a watch can still own systems', () => {
    const none: CrewProfile = { id: 'p3', name: 'Cy', deviceId: null }
    expect(crewSystems(none)).toEqual([])
    expect(crewSystems(withSystem(none, { deviceId: 'watch-5' }))).toEqual([{ deviceId: 'watch-5' }])
  })

  it('removing a system, and replacing the watch after a new sync', () => {
    const two = withSystem(old, { deviceId: 'watch-2' })
    expect(crewSystems(withoutSystem(two, 'watch-2'))).toEqual([{ deviceId: 'watch-1' }])
    const noWatch = withoutSystem(two, 'watch-1')
    expect(noWatch.deviceId).toBeNull()
    expect(crewSystems(noWatch)).toEqual([{ deviceId: 'watch-2' }])
    const synced = withWatch(two, 'watch-7')
    expect(synced.deviceId).toBe('watch-7')
    expect(crewSystems(synced).map((s) => s.deviceId)).toEqual(['watch-7', 'watch-2'])
    expect(withWatch(old, 'watch-8')).toEqual({ ...old, deviceId: 'watch-8' })
  })
})
