import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorage } from 'unstorage'
import {
  SNAPSHOT_KEY,
  createChatPersistence,
  resolveStorageConfig,
  watchRedisErrors,
} from '../server/utils/chat-persistence'
import {
  addAlert,
  addChannel,
  addMessage,
  clearMessages,
  exportSnapshot,
  importSnapshot,
  listChannels,
  listMessages,
  onChatChange,
  resetChatStore,
  toggleReaction,
} from '../server/utils/chat-store'

const silent = { warn: vi.fn(), error: vi.fn() }

/** Canal créé, messages, réponse, réaction et alerte acquittée */
function populate() {
  addChannel({ name: 'Persist test' })
  const root = addMessage('persist-test', { author: 'Alice', text: 'survit ?' })
  addMessage('persist-test', { author: 'Bob', text: 'oui', parentId: root.id })
  toggleReaction('persist-test', root.id, { emoji: '👍', author: 'Bob' })
  addAlert('incident-en-cours', { severity: 'SEV1', title: 'Checkout KO', service: 'checkout-api', text: '5xx' })
}

function state() {
  const channels = listChannels()
  return { channels, messages: channels.map(channel => listMessages(channel.id)) }
}

describe('chat-persistence', () => {
  beforeEach(() => {
    resetChatStore()
    silent.warn.mockClear()
    silent.error.mockClear()
  })

  it('un instantané exporté puis réimporté redonne les mêmes canaux et messages', () => {
    populate()
    const before = state()
    const snapshot = JSON.parse(JSON.stringify(exportSnapshot()))
    resetChatStore()
    expect(listChannels().map(channel => channel.id)).not.toContain('persist-test')
    expect(importSnapshot(snapshot)).toBe(true)
    expect(state()).toEqual(before)
    expect(listMessages('incident-en-cours')[0]!.alert).toMatchObject({ severity: 'SEV1', title: 'Checkout KO' })
  })

  it('aller-retour par le driver unstorage memory', async () => {
    const storage = createStorage()
    const persistence = createChatPersistence(storage, { logger: silent })
    await persistence.hydrate()
    populate()
    const before = state()
    await persistence.flush()
    resetChatStore()
    expect(await persistence.hydrate()).toBe(true)
    expect(state()).toEqual(before)
  })

  it.each([
    ['JSON non conforme', '{pas du json'],
    ['version inconnue', { version: 3, channels: [], messages: {}, rev: 0, totalCounts: {} }],
    ['canaux absents', { version: 1, messages: {} }],
    ['message mal formé', { version: 1, channels: [{ id: 'a', name: 'A' }], messages: { a: [{ id: 1 }] } }],
    ['messages d\'un canal inconnu', { version: 1, channels: [{ id: 'a', name: 'A' }], messages: { b: [] } }],
  ])('instantané invalide (%s) : état initial conservé, sans exception', async (_label, raw) => {
    const initial = state()
    const storage = createStorage()
    await storage.setItem(SNAPSHOT_KEY, raw)
    const persistence = createChatPersistence(storage, { logger: silent })
    await expect(persistence.hydrate()).resolves.toBe(false)
    expect(state()).toEqual(initial)
    expect(silent.warn).toHaveBeenCalled()
    expect(importSnapshot(raw)).toBe(false)
  })

  it('aucun instantané : état initial, pas d\'avertissement', async () => {
    const persistence = createChatPersistence(createStorage(), { logger: silent })
    await expect(persistence.hydrate()).resolves.toBe(false)
    expect(silent.warn).not.toHaveBeenCalled()
  })

  it('une erreur d\'écriture est journalisée sans lever', async () => {
    const storage = createStorage()
    storage.setItem = () => Promise.reject(new Error('disque plein'))
    const persistence = createChatPersistence(storage, { logger: silent })
    await persistence.hydrate()
    await expect(persistence.flush()).resolves.toBeUndefined()
    expect(silent.error).toHaveBeenCalled()
  })

  it('le reset persisté vide les messages et garde les canaux', async () => {
    const storage = createStorage()
    const persistence = createChatPersistence(storage, { logger: silent })
    await persistence.hydrate()
    populate()
    clearMessages()
    await persistence.flush()
    resetChatStore()
    await persistence.hydrate()
    expect(listChannels().map(channel => channel.id)).toContain('persist-test')
    expect(listMessages('persist-test')).toEqual([])
  })

  describe('sauvegarde différée', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('chaque mutation programme une seule écriture dans le délai', async () => {
      const storage = createStorage()
      const setItem = vi.spyOn(storage, 'setItem')
      const persistence = createChatPersistence(storage, { saveDelayMs: 300, logger: silent })
      await persistence.hydrate()
      const unsubscribe = onChatChange(persistence.scheduleSave)
      try {
        addMessage('general', { author: 'Alice', text: 'un' })
        addMessage('general', { author: 'Alice', text: 'deux' })
        expect(setItem).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(300)
        expect(setItem).toHaveBeenCalledTimes(1)
        const saved = await storage.getItem<{ messages: Record<string, unknown[]> }>(SNAPSHOT_KEY)
        expect(saved?.messages.general).toHaveLength(2)
      }
      finally {
        unsubscribe()
      }
    })

    it('notifie toutes les mutations, reset compris', () => {
      const listener = vi.fn()
      const unsubscribe = onChatChange(listener)
      try {
        populate()
        clearMessages()
        // addChannel, 2 addMessage, toggleReaction, addAlert, clearMessages
        expect(listener).toHaveBeenCalledTimes(6)
        resetChatStore()
        importSnapshot(exportSnapshot())
        expect(listener).toHaveBeenCalledTimes(6)
      }
      finally {
        unsubscribe()
      }
    })
  })
})

describe('lecture en échec au démarrage', () => {
  beforeEach(() => {
    resetChatStore()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  /** Stockage dont les failures premières lectures échouent, contenant éventuellement un instantané */
  async function flakyStorage(failures: number, snapshot?: unknown) {
    const storage = createStorage()
    if (snapshot !== undefined) await storage.setItem(SNAPSHOT_KEY, snapshot)
    const getItem = storage.getItem.bind(storage)
    let calls = 0
    storage.getItem = ((key: string) => {
      calls++
      return calls <= failures ? Promise.reject(new Error('ECONNREFUSED')) : getItem(key)
    }) as typeof storage.getItem
    return { storage, setItem: vi.spyOn(storage, 'setItem'), calls: () => calls }
  }

  /** Instantané distant : canal persist-test avec un message */
  function remoteSnapshot() {
    populate()
    const snapshot = JSON.parse(JSON.stringify(exportSnapshot()))
    resetChatStore()
    return snapshot
  }

  it('suspend les écritures, retente, puis importe l\'instantané si le store local est vierge', async () => {
    const snapshot = remoteSnapshot()
    const { storage, setItem, calls } = await flakyStorage(2, snapshot)
    setItem.mockClear()
    const persistence = createChatPersistence(storage, { retryMs: 5000, saveDelayMs: 300, logger: silent })

    await expect(persistence.hydrate()).resolves.toBe(false)
    expect(persistence.canWrite()).toBe(false)
    // Store vierge (canaux par défaut, aucun message) : une sauvegarde demandée reste en attente
    persistence.scheduleSave()
    await persistence.flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(setItem).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4000) // 2e lecture : échec
    expect(calls()).toBe(2)
    expect(persistence.canWrite()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000) // 3e lecture : réussie
    expect(calls()).toBe(3)
    expect(persistence.canWrite()).toBe(true)
    expect(listMessages('persist-test')).toHaveLength(2)
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('instantané importé'))
    // La mutation en attente est écrite une fois la lecture rétablie (état importé)
    await vi.advanceTimersByTimeAsync(0)
    expect(setItem).toHaveBeenCalledTimes(1)
    persistence.stop()
  })

  it('garde un canal créé pendant la panne (sans message) : instantané non importé, puis sauvegardé', async () => {
    const snapshot = remoteSnapshot()
    expect(snapshot.messages['persist-test']).toHaveLength(2)
    const { storage, setItem } = await flakyStorage(1, snapshot)
    setItem.mockClear()
    const persistence = createChatPersistence(storage, { retryMs: 5000, saveDelayMs: 300, logger: silent })
    await persistence.hydrate()
    addChannel({ name: 'Créé pendant la panne' })
    persistence.scheduleSave()
    silent.warn.mockClear()

    await vi.advanceTimersByTimeAsync(5000) // 2e lecture : réussie
    expect(persistence.canWrite()).toBe(true)
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('état local conservé'))
    const ids = listChannels().map(channel => channel.id)
    expect(ids).toContain('cree-pendant-la-panne')
    expect(ids).not.toContain('persist-test')
    await vi.advanceTimersByTimeAsync(0)
    expect(setItem).toHaveBeenCalledTimes(1)
    const saved = await storage.getItem<{ channels: { id: string }[] }>(SNAPSHOT_KEY)
    expect(saved?.channels.map(channel => channel.id)).toContain('cree-pendant-la-panne')
    expect(saved?.channels.map(channel => channel.id)).not.toContain('persist-test')
    persistence.stop()
  })

  it('garde l\'état local s\'il a déjà des messages, avertit et reprend les sauvegardes', async () => {
    const snapshot = remoteSnapshot()
    const { storage, setItem } = await flakyStorage(1, snapshot)
    setItem.mockClear()
    const persistence = createChatPersistence(storage, { retryMs: 5000, saveDelayMs: 300, logger: silent })
    await persistence.hydrate()
    addMessage('general', { author: 'Alice', text: 'local' })
    persistence.scheduleSave()
    silent.warn.mockClear()

    await vi.advanceTimersByTimeAsync(5000)
    expect(persistence.canWrite()).toBe(true)
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('état local conservé'))
    expect(listChannels().map(channel => channel.id)).not.toContain('persist-test')
    await vi.advanceTimersByTimeAsync(0)
    expect(setItem).toHaveBeenCalledTimes(1)
    const saved = await storage.getItem<{ messages: Record<string, { text: string }[]> }>(SNAPSHOT_KEY)
    expect(saved?.messages.general?.[0]?.text).toBe('local')

    // Sauvegardes reprises normalement
    addMessage('general', { author: 'Alice', text: 'encore' })
    persistence.scheduleSave()
    await vi.advanceTimersByTimeAsync(300)
    expect(setItem).toHaveBeenCalledTimes(2)
    persistence.stop()
  })

  it('n\'écrit rien à l\'arrêt si aucune lecture n\'a réussi, et stop annule les nouveaux essais', async () => {
    const { storage, setItem, calls } = await flakyStorage(Infinity)
    const persistence = createChatPersistence(storage, { retryMs: 5000, logger: silent })
    await persistence.hydrate()
    addMessage('general', { author: 'Alice', text: 'perdu' })
    persistence.scheduleSave()
    persistence.stop()
    await persistence.flush()
    await vi.advanceTimersByTimeAsync(20000)
    expect(setItem).not.toHaveBeenCalled()
    expect(calls()).toBe(1)
  })

  it('journalise une seule fois une série d\'échecs de lecture', async () => {
    const { storage } = await flakyStorage(Infinity)
    const persistence = createChatPersistence(storage, { retryMs: 1000, logger: silent })
    silent.warn.mockClear()
    await persistence.hydrate()
    await vi.advanceTimersByTimeAsync(5000)
    expect(silent.warn).toHaveBeenCalledTimes(1)
    persistence.stop()
  })
})

describe('watchRedisErrors', () => {
  it('journalise une fois par panne, puis au retour de la connexion', () => {
    const listeners: Record<string, (error?: unknown) => void> = {}
    const client = { on: (event: string, listener: (error?: unknown) => void) => (listeners[event] = listener) }
    const logger = { warn: vi.fn() }
    watchRedisErrors(client, logger)
    listeners.ready!()
    expect(logger.warn).not.toHaveBeenCalled()
    for (let i = 0; i < 5; i++) listeners.error!(new Error('ECONNREFUSED'))
    expect(logger.warn).toHaveBeenCalledTimes(1)
    listeners.ready!()
    expect(logger.warn).toHaveBeenCalledTimes(2)
    listeners.error!(new Error('ECONNREFUSED'))
    expect(logger.warn).toHaveBeenCalledTimes(3)
  })
})

describe('resolveStorageConfig', () => {
  it('REDIS_URL → redis', () => {
    expect(resolveStorageConfig({ REDIS_URL: 'redis://localhost:6379' }))
      .toEqual({ driver: 'redis', url: 'redis://localhost:6379' })
  })

  it('CHAT_DATA_DIR seul → fs', () => {
    expect(resolveStorageConfig({ CHAT_DATA_DIR: '/tmp/chat' })).toEqual({ driver: 'fs', base: '/tmp/chat' })
  })

  it('REDIS_URL prime sur CHAT_DATA_DIR', () => {
    expect(resolveStorageConfig({ REDIS_URL: 'redis://r:6379', CHAT_DATA_DIR: '/tmp/chat' }))
      .toEqual({ driver: 'redis', url: 'redis://r:6379' })
  })

  it('rien ou valeurs vides → memory', () => {
    expect(resolveStorageConfig({})).toEqual({ driver: 'memory' })
    expect(resolveStorageConfig({ REDIS_URL: '', CHAT_DATA_DIR: '' })).toEqual({ driver: 'memory' })
    expect(resolveStorageConfig({ REDIS_URL: '  ', CHAT_DATA_DIR: '' })).toEqual({ driver: 'memory' })
    expect(resolveStorageConfig({ REDIS_URL: '', CHAT_DATA_DIR: '/d' })).toEqual({ driver: 'fs', base: '/d' })
  })
})
