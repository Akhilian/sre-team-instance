import { describe, expect, it } from 'vitest'
import { createFaultState } from '../server/utils/fault-state'

describe('fault-state', () => {
  it('suit les pannes, leur activité et se vide', () => {
    const state = createFaultState()
    expect(state.isActive('a')).toBe(false)
    expect(state.get('a')).toBeUndefined()
    state.set('a', 3)
    state.set('b', 0)
    expect(state.get('a')).toBe(3)
    expect(state.isActive('a')).toBe(true)
    expect(state.isActive('b')).toBe(false)
    expect(state.activeNames()).toEqual(['a'])
    state.clear()
    expect(state.activeNames()).toEqual([])
    expect(state.get('b')).toBeUndefined()
  })
})
