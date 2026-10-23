import { describe, expect, it } from 'vitest'
import type { ChannelSummary } from '../shared/types/chat'
import { computeUnread, parseSeen, totalUnread, unreadBadgeLabel } from '../app/utils/unread'

function summary(id: string, messageCount: number): ChannelSummary {
  return { id, name: id, messageCount, lastMessageAt: messageCount > 0 ? '2026-10-23T08:00:00.000Z' : null }
}

describe('computeUnread', () => {
  it('ne compte pas l\'historique à la première observation', () => {
    const { counts, nextSeen } = computeUnread([summary('general', 5), summary('incident', 2)], {}, 'general')
    expect(counts).toEqual({ general: 0, incident: 0 })
    expect(nextSeen).toEqual({ general: 5, incident: 2 })
  })

  it('compte les nouveaux messages d\'un autre canal sans avancer le vu', () => {
    const { counts, nextSeen } = computeUnread([summary('general', 1), summary('incident', 5)], { general: 1, incident: 2 }, 'general')
    expect(counts.incident).toBe(3)
    expect(nextSeen.incident).toBe(2)
  })

  it('marque le canal courant comme vu en entier', () => {
    const { counts, nextSeen } = computeUnread([summary('general', 7)], { general: 2 }, 'general')
    expect(counts.general).toBe(0)
    expect(nextSeen.general).toBe(7)
  })

  it('ramène le vu au compteur après une réinitialisation', () => {
    const { counts, nextSeen } = computeUnread([summary('general', 0), summary('incident', 1)], { general: 0, incident: 4 }, 'general')
    expect(counts.incident).toBe(0)
    expect(nextSeen.incident).toBe(1)
    // 1 nouveau message après la réinitialisation : 1 non lu
    expect(computeUnread([summary('general', 0), summary('incident', 2)], nextSeen, 'general').counts.incident).toBe(1)
  })

  it('ignore les canaux disparus', () => {
    const { counts, nextSeen } = computeUnread([summary('general', 1)], { general: 1, ancien: 3 }, 'general')
    expect(counts).toEqual({ general: 0 })
    expect(nextSeen).toEqual({ general: 1 })
  })
})

describe('totalUnread', () => {
  it('additionne les non-lus hors canal courant', () => {
    expect(totalUnread({ general: 2, incident: 3, db: 1 }, 'general')).toBe(4)
    expect(totalUnread({}, 'general')).toBe(0)
  })
})

describe('parseSeen', () => {
  it('relit un état valide et ignore le reste', () => {
    expect(parseSeen('{"general":2,"incident":"x","db":-1,"ops":1.5}')).toEqual({ general: 2 })
    expect(parseSeen(null)).toEqual({})
    expect(parseSeen('pas du json')).toEqual({})
    expect(parseSeen('[1,2]')).toEqual({})
  })
})

describe('unreadBadgeLabel', () => {
  it('plafonne l\'affichage à 99+', () => {
    expect(unreadBadgeLabel(3)).toBe('3')
    expect(unreadBadgeLabel(99)).toBe('99')
    expect(unreadBadgeLabel(100)).toBe('99+')
  })
})
