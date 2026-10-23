import { beforeEach, describe, expect, it } from 'vitest'
import {
  PresenceValidationError,
  channelPresence,
  recordPresence,
  resetPresenceStore,
} from '../server/utils/presence-store'
import { typingLabel } from '../app/utils/presence'

const T0 = 1_000_000

describe('presence-store', () => {
  beforeEach(() => resetPresenceStore())

  it('garde un nom présent 15 s après son dernier battement', () => {
    recordPresence({ name: 'Alice', channelId: 'general' }, T0)
    expect(channelPresence('general', T0 + 14_000).present).toEqual(['Alice'])
    expect(channelPresence('general', T0 + 16_000).present).toEqual([])
  })

  it('affiche la frappe pendant 5 s après typing: true', () => {
    recordPresence({ name: 'Alice', channelId: 'general', typing: true }, T0)
    expect(channelPresence('general', T0 + 4_000).typing).toEqual(['Alice'])
    expect(channelPresence('general', T0 + 6_000).typing).toEqual([])
    expect(channelPresence('general', T0 + 6_000).present).toEqual(['Alice'])
  })

  it('efface la frappe immédiatement sur typing: false', () => {
    recordPresence({ name: 'Alice', channelId: 'general', typing: true }, T0)
    recordPresence({ name: 'Alice', channelId: 'general', typing: false }, T0 + 1_000)
    expect(channelPresence('general', T0 + 1_000).typing).toEqual([])
  })

  it('ne touche pas à la frappe en cours sur un battement sans typing', () => {
    recordPresence({ name: 'Alice', channelId: 'general', typing: true }, T0)
    recordPresence({ name: 'Alice', channelId: 'general' }, T0 + 1_000)
    expect(channelPresence('general', T0 + 2_000).typing).toEqual(['Alice'])
  })

  it('retire le nom de l\'ancien canal quand il change de canal', () => {
    recordPresence({ name: 'Alice', channelId: 'general', typing: true }, T0)
    recordPresence({ name: 'Alice', channelId: 'incident-en-cours' }, T0 + 1_000)
    expect(channelPresence('general', T0 + 1_000)).toEqual({ present: [], typing: [] })
    expect(channelPresence('incident-en-cours', T0 + 1_000)).toEqual({ present: ['Alice'], typing: [] })
  })

  it('trie les noms (ordre français) et rogne le nom', () => {
    recordPresence({ name: 'Zoé', channelId: 'general', typing: true }, T0)
    recordPresence({ name: '  émile ', channelId: 'general', typing: true }, T0)
    recordPresence({ name: 'Bob', channelId: 'general' }, T0)
    expect(channelPresence('general', T0)).toEqual({ present: ['Bob', 'émile', 'Zoé'], typing: ['émile', 'Zoé'] })
  })

  it('refuse un nom invalide ou un typing non booléen', () => {
    expect(() => recordPresence({ name: '   ', channelId: 'general' }, T0)).toThrow(PresenceValidationError)
    expect(() => recordPresence({ name: 'x'.repeat(51), channelId: 'general' }, T0)).toThrow(PresenceValidationError)
    expect(() => recordPresence({ name: 42, channelId: 'general' }, T0)).toThrow(PresenceValidationError)
    expect(() => recordPresence({ name: 'Bob', channelId: 'general', typing: 'oui' }, T0)).toThrow(PresenceValidationError)
    expect(channelPresence('general', T0).present).toEqual([])
  })
})

describe('typingLabel', () => {
  it('est vide sans personne', () => {
    expect(typingLabel([], 'Alice')).toBe('')
  })

  it('nomme une ou deux personnes', () => {
    expect(typingLabel(['Bob'], 'Alice')).toBe('Bob écrit…')
    expect(typingLabel(['Alice', 'Bob'], 'Zoé')).toBe('Alice et Bob écrivent…')
  })

  it('résume à partir de trois personnes', () => {
    expect(typingLabel(['Alice', 'Bob', 'Chloé'], 'Zoé')).toBe('Plusieurs personnes écrivent…')
  })

  it('exclut le participant courant', () => {
    expect(typingLabel(['Bob'], 'Bob')).toBe('')
    expect(typingLabel(['Alice', 'Bob'], 'Bob')).toBe('Alice écrit…')
    expect(typingLabel(['Alice', 'Bob', 'Chloé'], 'Bob')).toBe('Alice et Chloé écrivent…')
  })
})
