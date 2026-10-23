import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorage } from 'unstorage'
import {
  ChannelLimitError,
  ReactionLimitError,
  addAlert,
  addChannel,
  addMessage,
  exportSnapshot,
  importSnapshot,
  listChannels,
  listMessages,
  onChatChange,
  resetChatStore,
  toggleReaction,
} from '../server/utils/chat-store'
import {
  PRESENCE_TTL_MS,
  PresenceLimitError,
  channelPresence,
  recordPresence,
  resetPresenceStore,
} from '../server/utils/presence-store'
import { SNAPSHOT_KEY, createChatPersistence } from '../server/utils/chat-persistence'
import {
  CHANNELS_MAX,
  CHANNEL_MESSAGES_MAX,
  PRESENCE_ENTRIES_MAX,
  REACTION_AUTHORS_MAX,
} from '../shared/utils/limits'
import { groupThreads } from '../app/utils/threads'

const T0 = 1_000_000

function state() {
  const channels = listChannels()
  return { channels, messages: channels.map(channel => listMessages(channel.id)) }
}

describe('plafonds du chat-store', () => {
  beforeEach(() => resetChatStore())

  it('garde les 2000 derniers messages d\'un canal (FIFO)', () => {
    for (let index = 1; index <= CHANNEL_MESSAGES_MAX + 5; index++) {
      addMessage('general', { author: 'Alice', text: `message ${index}` })
    }
    const messages = listMessages('general')
    expect(messages).toHaveLength(CHANNEL_MESSAGES_MAX)
    expect(messages[0]!.text).toBe('message 6')
    expect(messages.at(-1)!.text).toBe(`message ${CHANNEL_MESSAGES_MAX + 5}`)
  })

  it('une réponse dont la racine a été évincée ne fait pas planter groupThreads', () => {
    const root = addMessage('general', { author: 'Alice', text: 'racine' })
    addMessage('general', { author: 'Bob', text: 'réponse', parentId: root.id })
    for (let index = 0; index < CHANNEL_MESSAGES_MAX - 1; index++) {
      addMessage('general', { author: 'Alice', text: `bruit ${index}` })
    }
    const messages = listMessages('general')
    expect(messages.some(message => message.id === root.id)).toBe(false)
    expect(messages[0]!.parentId).toBe(root.id)
    const threads = groupThreads(messages)
    expect(threads).toHaveLength(CHANNEL_MESSAGES_MAX - 1)
  })

  it('refuse le 31e canal avec ChannelLimitError', () => {
    const initial = listChannels().length
    for (let index = initial; index < CHANNELS_MAX; index++) addChannel({ name: `Canal ${index}` })
    expect(listChannels()).toHaveLength(CHANNELS_MAX)
    expect(() => addChannel({ name: 'Canal de trop' })).toThrow(ChannelLimitError)
    expect(listChannels()).toHaveLength(CHANNELS_MAX)
  })

  it('refuse le 101e auteur d\'une réaction, mais un auteur déjà présent peut la retirer', () => {
    const message = addMessage('general', { author: 'Alice', text: 'réagissez' })
    for (let index = 1; index <= REACTION_AUTHORS_MAX; index++) {
      toggleReaction('general', message.id, { emoji: '👍', author: `Auteur ${index}` })
    }
    expect(() => toggleReaction('general', message.id, { emoji: '👍', author: 'Auteur 101' })).toThrow(ReactionLimitError)
    expect(listMessages('general')[0]!.reactions![0]!.authors).toHaveLength(REACTION_AUTHORS_MAX)
    // Autre emoji : plafond indépendant
    expect(() => toggleReaction('general', message.id, { emoji: '❤️', author: 'Auteur 101' })).not.toThrow()
    toggleReaction('general', message.id, { emoji: '👍', author: 'Auteur 1' })
    expect(listMessages('general')[0]!.reactions![0]!.authors).toHaveLength(REACTION_AUTHORS_MAX - 1)
  })
})

describe('plafond de présence', () => {
  beforeEach(() => resetPresenceStore())

  it('purge les noms expirés puis refuse le 201e nom distinct encore actif', () => {
    // 200 anciens noms, expirés au moment des suivants : purgés, ils ne bloquent rien
    for (let index = 1; index <= PRESENCE_ENTRIES_MAX; index++) {
      recordPresence({ name: `Ancien ${index}`, channelId: 'general' }, T0)
    }
    const later = T0 + PRESENCE_TTL_MS
    for (let index = 1; index <= PRESENCE_ENTRIES_MAX; index++) {
      recordPresence({ name: `Actif ${index}`, channelId: 'general' }, later)
    }
    const present = channelPresence('general', later).present
    expect(present).toHaveLength(PRESENCE_ENTRIES_MAX)
    expect(present.some(name => name.startsWith('Ancien'))).toBe(false)

    expect(() => recordPresence({ name: 'Actif 201', channelId: 'general' }, later + 1)).toThrow(PresenceLimitError)
    // Un nom déjà suivi continue de battre
    expect(() => recordPresence({ name: 'Actif 1', channelId: 'general', typing: true }, later + 1)).not.toThrow()
  })
})

const validMessage = { id: 'm1', channelId: 'a', author: 'Alice', text: 'salut', createdAt: '2026-10-23T10:00:00.000Z' }

function snapshotWith(message: Record<string, unknown>) {
  return { version: 1, savedAt: '', channels: [{ id: 'a', name: 'A' }], messages: { a: [{ ...validMessage, ...message }] } }
}

const corrupted: [string, unknown][] = [
  ['réaction sans authors', snapshotWith({ reactions: [{ emoji: '👍' }] })],
  ['authors non-chaînes', snapshotWith({ reactions: [{ emoji: '👍', authors: [42] }] })],
  ['emoji inconnu', snapshotWith({ reactions: [{ emoji: '🦄', authors: ['Bob'] }] })],
  ['sévérité inconnue', snapshotWith({ kind: 'alert', alert: { severity: 'SEV9', title: 't', service: 's', status: 'triggered' } })],
  ['statut inconnu', snapshotWith({ kind: 'alert', alert: { severity: 'SEV1', title: 't', service: 's', status: 'oublié' } })],
  ['accesseur qui lève', { version: 1, get channels() { throw new Error('corrompu') } }],
]

describe('importSnapshot (M3)', () => {
  beforeEach(() => resetChatStore())

  it('accepte des réactions et une alerte valides', () => {
    expect(importSnapshot(snapshotWith({
      reactions: [{ emoji: '❤️', authors: ['Bob'] }],
      kind: 'alert',
      alert: { severity: 'SEV2', title: 't', service: 's', status: 'acknowledged' },
    }))).toBe(true)
    expect(listMessages('a')[0]!.reactions).toEqual([{ emoji: '❤️', authors: ['Bob'] }])
  })

  it.each(corrupted)('refuse sans exception ni modification (%s)', (_label, raw) => {
    addMessage('general', { author: 'Alice', text: 'local' })
    const before = state()
    expect(() => importSnapshot(raw)).not.toThrow()
    expect(importSnapshot(raw)).toBe(false)
    expect(state()).toEqual(before)
  })

  it('n\'importe pas plus de 2000 messages par canal', () => {
    const messages = Array.from({ length: CHANNEL_MESSAGES_MAX + 3 }, (_, index) => ({ ...validMessage, id: `m${index}` }))
    expect(importSnapshot({ version: 1, channels: [{ id: 'a', name: 'A' }], messages: { a: messages } })).toBe(true)
    expect(listMessages('a')).toHaveLength(CHANNEL_MESSAGES_MAX)
    expect(listMessages('a')[0]!.id).toBe('m3')
  })

  describe('persistance après un instantané rejeté', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it.each(corrupted)('une mutation déclenche toujours une sauvegarde (%s)', async (label, raw) => {
      const silent = { warn: vi.fn(), error: vi.fn() }
      const storage = createStorage()
      // Un accesseur qui lève ne se sérialise pas : la première lecture le renvoie tel quel
      if (label === 'accesseur qui lève') {
        const getItem = storage.getItem
        storage.getItem = vi.fn().mockResolvedValueOnce(raw).mockImplementation(getItem) as typeof storage.getItem
      }
      else {
        await storage.setItem(SNAPSHOT_KEY, raw)
      }
      const persistence = createChatPersistence(storage, { saveDelayMs: 300, logger: silent })
      await expect(persistence.hydrate()).resolves.toBe(false)
      expect(persistence.canWrite()).toBe(true)
      const unsubscribe = onChatChange(persistence.scheduleSave)
      try {
        addAlert('general', { severity: 'SEV1', title: 'KO', service: 'api', text: 'panne' })
        await vi.advanceTimersByTimeAsync(300)
        const saved = await storage.getItem<ReturnType<typeof exportSnapshot>>(SNAPSHOT_KEY)
        expect(saved?.messages.general).toHaveLength(1)
      }
      finally {
        unsubscribe()
        persistence.stop()
      }
    })
  })
})
