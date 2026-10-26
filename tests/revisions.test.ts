// 017 — curseur de révision, compteurs monotones, reset complet et instantané v2 (CA1)
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addAlert,
  addChannel,
  addMessage,
  clearMessages,
  currentRev,
  exportSnapshot,
  importSnapshot,
  listChannelSummaries,
  listChannels,
  listMessages,
  listMessagesSince,
  resetAll,
  resetChatStore,
  toggleReaction,
} from '../server/utils/chat-store'
import { CHANNEL_MESSAGES_MAX } from '../shared/utils/limits'

function summaryOf(channelId: string) {
  return listChannelSummaries().find(summary => summary.id === channelId)!
}

const alertInput = { severity: 'SEV1', title: 'Checkout KO', service: 'checkout', text: '5xx' }

describe('rev (curseur de révision)', () => {
  beforeEach(() => resetChatStore())

  it('augmente strictement à chaque création, réaction et statut d\'alerte', () => {
    const revs: number[] = [currentRev()]
    const root = addMessage('general', { author: 'Alice', text: 'a' })
    revs.push(currentRev())
    expect(root.rev).toBe(currentRev())
    const reply = addMessage('general', { author: 'Bob', text: 'b', parentId: root.id })
    revs.push(currentRev())
    expect(reply.rev).toBe(currentRev())
    const reacted = toggleReaction('general', root.id, { emoji: '👍', author: 'Bob' })
    revs.push(currentRev())
    expect(reacted.rev).toBe(currentRev())
    toggleReaction('general', root.id, { emoji: '👍', author: 'Bob' })
    revs.push(currentRev())
    addAlert('incident-en-cours', alertInput)
    revs.push(currentRev())
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]!)
  })

  it('ne bouge pas sur une mutation refusée', () => {
    const before = currentRev()
    expect(() => addMessage('general', { author: '', text: 'x' })).toThrow()
    expect(currentRev()).toBe(before)
  })

  it('listMessagesSince : seulement les messages modifiés après since, triés par rev', () => {
    const first = addMessage('general', { author: 'Alice', text: '1' })
    addMessage('general', { author: 'Alice', text: '2' })
    const since = currentRev()
    expect(listMessagesSince('general', since)).toEqual({ rev: since, full: false, messages: [] })
    const third = addMessage('general', { author: 'Bob', text: '3' })
    toggleReaction('general', first.id, { emoji: '👍', author: 'Bob' })
    const delta = listMessagesSince('general', since)
    expect(delta.full).toBe(false)
    expect(delta.messages.map(message => message.id)).toEqual([third.id, first.id])
    expect(delta.rev).toBe(currentRev())
  })

  it('listMessagesSince : full après un reset, ou pour un curseur dans le futur', () => {
    addMessage('general', { author: 'Alice', text: '1' })
    const since = currentRev()
    clearMessages()
    expect(listMessagesSince('general', since)).toEqual({ rev: currentRev(), full: true, messages: [] })
    expect(listMessagesSince('general', currentRev()).full).toBe(false)
    expect(listMessagesSince('general', currentRev() + 1).full).toBe(true)
  })

  it('listMessagesSince : full pour un curseur antérieur à la dernière éviction', () => {
    for (let i = 0; i < CHANNEL_MESSAGES_MAX; i++) addMessage('general', { author: 'Alice', text: `m${i}` })
    const before = currentRev()
    addMessage('general', { author: 'Alice', text: 'évince m0' })
    // m0 (rev 1) évincé : un curseur qui ne l'a pas vu repart de la liste complète
    expect(listMessagesSince('general', 0).full).toBe(true)
    const steady = listMessagesSince('general', before)
    expect(steady.full).toBe(false)
    expect(steady.messages).toHaveLength(1)
  })
})

describe('totalCount (compteur monotone)', () => {
  beforeEach(() => resetChatStore())

  it('compte 2005 publications pour 2000 messages présents', () => {
    for (let i = 0; i < 2005; i++) addMessage('general', { author: 'Alice', text: `m${i}` })
    expect(summaryOf('general')).toMatchObject({ messageCount: 2000, totalCount: 2005 })
  })

  it('ne baisse pas après clearMessages puis resetAll, et rev ne recule pas', () => {
    addMessage('general', { author: 'Alice', text: '1' })
    addMessage('general', { author: 'Alice', text: '2' })
    addChannel({ name: 'Test' })
    addMessage('test', { author: 'Alice', text: 't' })
    const revBefore = currentRev()

    clearMessages()
    expect(summaryOf('general')).toMatchObject({ messageCount: 0, totalCount: 2 })
    expect(currentRev()).toBeGreaterThanOrEqual(revBefore)
    const revAfterClear = currentRev()

    resetAll()
    expect(listChannels().map(channel => channel.id)).toEqual(['general', 'incident-en-cours'])
    expect(summaryOf('general')).toMatchObject({ messageCount: 0, totalCount: 2 })
    expect(currentRev()).toBeGreaterThanOrEqual(revAfterClear)

    // Canal recréé avec le même slug : il reprend son compteur
    addChannel({ name: 'Test' })
    expect(summaryOf('test')).toMatchObject({ messageCount: 0, totalCount: 1 })
    addMessage('general', { author: 'Alice', text: '3' })
    expect(summaryOf('general').totalCount).toBe(3)
  })
})

describe('instantané v2', () => {
  beforeEach(() => resetChatStore())

  it('restitue rev, totalCounts et Message.rev', () => {
    const root = addMessage('general', { author: 'Alice', text: '1' })
    toggleReaction('general', root.id, { emoji: '👍', author: 'Bob' })
    addChannel({ name: 'Test' })
    addMessage('test', { author: 'Alice', text: 't' })
    resetAll() // supprime test, garde son compteur
    addMessage('general', { author: 'Alice', text: '2' })
    const snapshot = JSON.parse(JSON.stringify(exportSnapshot()))
    expect(snapshot).toMatchObject({ version: 2, rev: currentRev(), totalCounts: { general: 2, test: 1 } })
    const messages = listMessages('general')
    const rev = currentRev()

    resetChatStore()
    expect(importSnapshot(snapshot)).toBe(true)
    expect(currentRev()).toBe(rev)
    expect(listMessages('general')).toEqual(messages)
    expect(summaryOf('general').totalCount).toBe(2)
    addChannel({ name: 'Test' })
    expect(summaryOf('test').totalCount).toBe(1)
  })

  it('rejette un v2 sans rev, avec un Message.rev invalide ou postérieur au rev', () => {
    addMessage('general', { author: 'Alice', text: '1' })
    const snapshot = JSON.parse(JSON.stringify(exportSnapshot()))
    expect(importSnapshot({ ...snapshot, rev: undefined })).toBe(false)
    expect(importSnapshot({ ...snapshot, totalCounts: { general: -1 } })).toBe(false)
    const withoutRev = JSON.parse(JSON.stringify(snapshot))
    delete withoutRev.messages.general[0].rev
    expect(importSnapshot(withoutRev)).toBe(false)
    expect(importSnapshot({ ...snapshot, rev: 0 })).toBe(false)
  })

  it('accepte un instantané v1 : rev dans l\'ordre des messages, totalCounts = messages présents', () => {
    const message = (id: string, channelId: string) => ({ id, channelId, author: 'Alice', text: id, createdAt: '2026-10-23T08:00:00.000Z' })
    const v1 = {
      version: 1,
      savedAt: '2026-10-23T08:00:00.000Z',
      channels: [{ id: 'general', name: 'Général' }, { id: 'incident-en-cours', name: 'Incident en cours' }, { id: 'test', name: 'Test' }],
      messages: { 'general': [message('a', 'general'), message('b', 'general')], 'incident-en-cours': [], 'test': [message('c', 'test')] },
    }
    expect(importSnapshot(v1)).toBe(true)
    expect(listMessages('general').map(m => m.rev)).toEqual([1, 2])
    expect(listMessages('test').map(m => m.rev)).toEqual([3])
    expect(currentRev()).toBe(3)
    expect(summaryOf('general')).toMatchObject({ messageCount: 2, totalCount: 2 })
    expect(summaryOf('test')).toMatchObject({ messageCount: 1, totalCount: 1 })
    // Les curseurs antérieurs à l'import repartent d'une liste complète
    expect(listMessagesSince('general', 0).full).toBe(true)
    expect(listMessagesSince('general', 3)).toMatchObject({ full: false, messages: [] })
    // Réexporté en v2
    expect(exportSnapshot()).toMatchObject({ version: 2, rev: 3, totalCounts: { general: 2, test: 1 } })
  })
})
