// 038 CA2 : store en mémoire des rôles d'incident
import { beforeEach, describe, expect, it } from 'vitest'
import { PRESENCE_ENTRIES_MAX } from '../shared/utils/limits'
import { getRole, hasIncidentCommander, resetRoleStore, RoleValidationError, rolesOf, setRole } from '../server/utils/role-store'
import { channelPresence, presentParticipants, recordPresence, resetPresenceStore } from '../server/utils/presence-store'

describe('role-store', () => {
  beforeEach(() => {
    resetRoleStore()
    resetPresenceStore()
  })

  it('affecte puis réaffecte un rôle', () => {
    setRole({ name: 'Alice', role: 'scribe' })
    expect(getRole('Alice')).toBe('scribe')
    setRole({ name: ' Alice ', role: 'investigation' })
    expect(getRole('Alice')).toBe('investigation')
  })

  it('refuse un rôle ou un nom invalide sans rien modifier', () => {
    setRole({ name: 'Alice', role: 'scribe' })
    expect(() => setRole({ name: 'Alice', role: 'chef' })).toThrow(RoleValidationError)
    expect(() => setRole({ name: 'Alice', role: undefined })).toThrow(RoleValidationError)
    expect(() => setRole({ name: '  ', role: 'scribe' })).toThrow(RoleValidationError)
    expect(() => setRole({ name: 'x'.repeat(51), role: 'scribe' })).toThrow(RoleValidationError)
    expect(getRole('Alice')).toBe('scribe')
  })

  it('écarte l\'affectation la plus ancienne au-delà du plafond', () => {
    for (let i = 0; i < PRESENCE_ENTRIES_MAX; i++) setRole({ name: `p${i}`, role: 'equipier' })
    setRole({ name: 'p0', role: 'scribe' }) // réaffecté : devient le plus récent
    setRole({ name: 'nouveau', role: 'equipier' })
    expect(getRole('p1')).toBeUndefined()
    expect(getRole('p0')).toBe('scribe')
    expect(getRole('nouveau')).toBe('equipier')
  })

  it('calcule hasIncidentCommander sur les seuls présents', () => {
    setRole({ name: 'Alice', role: 'incident-commander' })
    setRole({ name: 'Bob', role: 'scribe' })
    recordPresence({ name: 'Bob', channelId: 'general' }, 1000)
    const present = presentParticipants(1000).map(p => p.name)
    expect(present).toEqual(['Bob'])
    expect(hasIncidentCommander(present)).toBe(false)
    recordPresence({ name: 'Alice', channelId: 'incident-en-cours' }, 1000)
    expect(hasIncidentCommander(presentParticipants(1000).map(p => p.name))).toBe(true)
    // Alice expire : plus de responsable
    recordPresence({ name: 'Bob', channelId: 'general' }, 30_000)
    expect(hasIncidentCommander(presentParticipants(30_000).map(p => p.name))).toBe(false)
    expect(channelPresence('general', 30_000).present).toEqual(['Bob'])
  })

  it('accepte deux participants avec le même rôle', () => {
    setRole({ name: 'Alice', role: 'scribe' })
    setRole({ name: 'Bob', role: 'scribe' })
    expect(rolesOf(['Alice', 'Bob', 'Inconnu'])).toEqual({ Alice: 'scribe', Bob: 'scribe' })
  })
})
