import { beforeEach, describe, expect, it } from 'vitest'
import {
  ChannelConflictError,
  ChannelNotFoundError,
  ChannelValidationError,
  MessageValidationError,
  addAnnouncement,
  addChannel,
  addMessage,
  clearMessages,
  listChannelSummaries,
  listChannels,
  listMessages,
  resetChatStore,
  slugifyChannelName,
} from '../server/utils/chat-store'

describe('chat-store', () => {
  beforeEach(() => resetChatStore())

  it('pré-crée general et un canal incident-', () => {
    const ids = listChannels().map(channel => channel.id)
    expect(ids).toContain('general')
    expect(ids.some(id => id.startsWith('incident-'))).toBe(true)
    for (const channel of listChannels()) {
      expect(Object.keys(channel).sort()).toEqual(['id', 'name'])
    }
  })

  it('ajoute un message et le relit', () => {
    const message = addMessage('general', { author: ' Alice ', text: ' Bonjour ' })
    expect(message).toMatchObject({ channelId: 'general', author: 'Alice', text: 'Bonjour' })
    expect(message.id).toBeTruthy()
    expect(new Date(message.createdAt).toISOString()).toBe(message.createdAt)
    expect(listMessages('general')).toEqual([message])
  })

  it('liste les messages par ordre chronologique croissant', () => {
    addMessage('general', { author: 'Alice', text: 'Bonjour' })
    addMessage('general', { author: 'Bob', text: 'Salut' })
    addMessage('general', { author: 'Carol', text: 'Hello' })
    const messages = listMessages('general')
    expect(messages.map(m => m.author)).toEqual(['Alice', 'Bob', 'Carol'])
    const dates = messages.map(m => m.createdAt)
    expect([...dates].sort()).toEqual(dates)
  })

  it('isole les messages par canal', () => {
    const incident = listChannels().find(c => c.id.startsWith('incident-'))!
    addMessage(incident.id, { author: 'Alice', text: 'Alerte' })
    expect(listMessages('general')).toEqual([])
    expect(listMessages(incident.id)).toHaveLength(1)
  })

  it.each([
    [{ text: 'Bonjour' }],
    [{ author: '', text: 'Bonjour' }],
    [{ author: '   ', text: 'Bonjour' }],
    [{ author: 'Alice' }],
    [{ author: 'Alice', text: '' }],
    [{ author: 'Alice', text: ' \n\t ' }],
    [{ author: 42, text: 'Bonjour' }],
    [{ author: 'a'.repeat(51), text: 'Bonjour' }],
    [{ author: 'Alice', text: 'x'.repeat(2001) }],
  ])('refuse une entrée invalide sans rien ajouter (%j)', (input) => {
    expect(() => addMessage('general', input)).toThrow(MessageValidationError)
    expect(listMessages('general')).toEqual([])
  })

  it('accepte les longueurs maximales', () => {
    const message = addMessage('general', { author: 'a'.repeat(50), text: 'x'.repeat(2000) })
    expect(message.author).toHaveLength(50)
    expect(message.text).toHaveLength(2000)
  })

  it('ignore un kind fourni dans l\'entrée', () => {
    const input = { author: 'Eve', text: 'faux', kind: 'announcement' } as Parameters<typeof addMessage>[1]
    const message = addMessage('general', input)
    expect(message).not.toHaveProperty('kind')
    expect(listMessages('general')[0]).not.toHaveProperty('kind')
  })

  it('lève ChannelNotFoundError sur un canal inconnu', () => {
    expect(() => listMessages('inconnu')).toThrow(ChannelNotFoundError)
    expect(() => addMessage('inconnu', { author: 'Alice', text: 'Bonjour' })).toThrow(ChannelNotFoundError)
  })

  it('renvoie des copies qui ne modifient pas le store', () => {
    addMessage('general', { author: 'Alice', text: 'Bonjour' })
    listMessages('general')[0]!.text = 'modifié'
    listChannels()[0]!.name = 'modifié'
    expect(listMessages('general')[0]!.text).toBe('Bonjour')
    expect(listChannels()[0]!.name).not.toBe('modifié')
  })
})

describe('addAnnouncement', () => {
  beforeEach(() => resetChatStore())

  it('crée un message racine signé Animateur avec kind announcement', () => {
    const announcement = addAnnouncement('incident-en-cours', { text: ' Le checkout renvoie 30 % de 500 ' })
    expect(announcement).toMatchObject({
      channelId: 'incident-en-cours',
      author: 'Animateur',
      text: 'Le checkout renvoie 30 % de 500',
      kind: 'announcement',
    })
    expect(announcement).not.toHaveProperty('parentId')
    expect(listMessages('incident-en-cours')).toEqual([announcement])
  })

  it('accepte une réponse sur une annonce', () => {
    const announcement = addAnnouncement('general', { text: 'Annonce' })
    const reply = addMessage('general', { author: 'Alice', text: 'Vu', parentId: announcement.id })
    expect(reply.parentId).toBe(announcement.id)
    expect(reply).not.toHaveProperty('kind')
  })

  it.each([[{}], [{ text: '' }], [{ text: '   ' }], [{ text: 42 }], [{ text: 'x'.repeat(2001) }]])(
    'refuse un texte invalide sans rien ajouter (%j)',
    (input) => {
      expect(() => addAnnouncement('general', input)).toThrow(MessageValidationError)
      expect(listMessages('general')).toEqual([])
    },
  )

  it('lève ChannelNotFoundError sur un canal inconnu', () => {
    expect(() => addAnnouncement('inconnu', { text: 'x' })).toThrow(ChannelNotFoundError)
  })
})

describe('clearMessages', () => {
  beforeEach(() => resetChatStore())

  it('vide les messages de tous les canaux en conservant les canaux', () => {
    const channel = addChannel({ name: 'Exercice 2' })
    addMessage('general', { author: 'Alice', text: 'Bonjour' })
    addAnnouncement('incident-en-cours', { text: 'Annonce' })
    addMessage(channel.id, { author: 'Bob', text: 'hello' })
    const channelsBefore = listChannels()

    clearMessages()

    expect(listChannels()).toEqual(channelsBefore)
    expect(listChannels().map(c => c.id)).toContain('exercice-2')
    for (const { id } of channelsBefore) expect(listMessages(id)).toEqual([])
    // Le canal reste utilisable après la réinitialisation
    expect(addMessage(channel.id, { author: 'Bob', text: 'encore' }).channelId).toBe('exercice-2')
  })
})

describe('addMessage avec parentId', () => {
  beforeEach(() => resetChatStore())

  it('ajoute une réponse à un message racine du même canal', () => {
    const root = addMessage('general', { author: 'Alice', text: 'Latence API en hausse' })
    expect(root).not.toHaveProperty('parentId')
    const reply = addMessage('general', { author: 'Bob', text: 'Je regarde', parentId: root.id })
    expect(reply).toMatchObject({ channelId: 'general', author: 'Bob', text: 'Je regarde', parentId: root.id })
    expect(listMessages('general')).toEqual([root, reply])
  })

  it.each([
    ['un parentId inconnu', () => 'inconnu'],
    ['un parentId non-chaîne', () => 123],
    ['le parentId d\'une réponse', (rootId: string) =>
      addMessage('general', { author: 'Bob', text: 'Réponse', parentId: rootId }).id],
    ['le parentId d\'une racine d\'un autre canal', () =>
      addMessage('incident-en-cours', { author: 'Alice', text: 'Ailleurs' }).id],
  ])('refuse %s sans rien ajouter', (_, makeParentId: (rootId: string) => unknown) => {
    const root = addMessage('general', { author: 'Alice', text: 'Racine' })
    const parentId = makeParentId(root.id)
    const before = listMessages('general')
    expect(() => addMessage('general', { author: 'Bob', text: 'x', parentId })).toThrow(MessageValidationError)
    expect(listMessages('general')).toEqual(before)
  })
})

describe('slugifyChannelName', () => {
  it.each([
    ['Incident Base de Données', 'incident-base-de-donnees'],
    ['  Général  ', 'general'],
    ['Panne : API / paiement !!', 'panne-api-paiement'],
    ['Été -- 2026', 'ete-2026'],
    ['ÇA_MARCHE', 'ca-marche'],
    ['!!!', ''],
  ])('%j donne %j', (name, id) => {
    expect(slugifyChannelName(name)).toBe(id)
  })
})

describe('addChannel', () => {
  beforeEach(() => resetChatStore())

  it('crée un canal en fin de liste, sans message', () => {
    const channel = addChannel({ name: '  Incident Base de Données ' })
    expect(channel).toEqual({ id: 'incident-base-de-donnees', name: 'Incident Base de Données' })
    expect(listChannels().at(-1)).toEqual(channel)
    expect(listMessages(channel.id)).toEqual([])
  })

  it('le canal créé peut recevoir un message', () => {
    const channel = addChannel({ name: 'Incident DNS' })
    const message = addMessage(channel.id, { author: 'Alice', text: 'On regarde' })
    expect(listMessages(channel.id)).toEqual([message])
  })

  it('accepte un nom de 50 caractères', () => {
    expect(addChannel({ name: 'a'.repeat(50) }).name).toHaveLength(50)
  })

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 42 }],
    [{ name: '!!!' }],
    [{ name: 'a'.repeat(51) }],
  ])('refuse un nom invalide sans rien créer (%j)', (input) => {
    const before = listChannels()
    expect(() => addChannel(input)).toThrow(ChannelValidationError)
    expect(listChannels()).toEqual(before)
  })

  it('refuse un doublon d\'id sans rien créer', () => {
    expect(() => addChannel({ name: 'general' })).toThrow(ChannelConflictError)
    addChannel({ name: 'Incident Base de Données' })
    const before = listChannels()
    expect(() => addChannel({ name: 'Incident base de donnees' })).toThrow(ChannelConflictError)
    expect(listChannels()).toEqual(before)
  })
})

describe('listChannelSummaries', () => {
  beforeEach(() => resetChatStore())

  it('suit l\'ordre de listChannels avec les clés id, name, messageCount, lastMessageAt', () => {
    addChannel({ name: 'Base de données' })
    const summaries = listChannelSummaries()
    expect(summaries.map(summary => summary.id)).toEqual(listChannels().map(channel => channel.id))
    for (const summary of summaries) {
      expect(Object.keys(summary)).toEqual(['id', 'name', 'messageCount', 'lastMessageAt'])
    }
  })

  it('renvoie 0 et null pour un canal vide', () => {
    const general = listChannelSummaries().find(summary => summary.id === 'general')
    expect(general).toEqual({ id: 'general', name: 'Général', messageCount: 0, lastMessageAt: null })
  })

  it('compte racines et réponses, et date le plus récent', () => {
    const root = addMessage('general', { author: 'Alice', text: 'Alerte' })
    const reply = addMessage('general', { author: 'Bob', text: 'Je regarde', parentId: root.id })
    const general = listChannelSummaries().find(summary => summary.id === 'general')!
    expect(general.messageCount).toBe(2)
    expect(general.lastMessageAt).toBe(reply.createdAt)
    const incident = listChannelSummaries().find(summary => summary.id === 'incident-en-cours')!
    expect(incident).toMatchObject({ messageCount: 0, lastMessageAt: null })
  })

  it('compte aussi les annonces', () => {
    const announcement = addAnnouncement('incident-en-cours', { text: 'Début de l\'exercice' })
    const incident = listChannelSummaries().find(summary => summary.id === 'incident-en-cours')!
    expect(incident).toMatchObject({ messageCount: 1, lastMessageAt: announcement.createdAt })
  })

  it('revient à 0 et null après clearMessages', () => {
    addMessage('general', { author: 'Alice', text: 'Alerte' })
    clearMessages()
    const general = listChannelSummaries().find(summary => summary.id === 'general')!
    expect(general).toMatchObject({ messageCount: 0, lastMessageAt: null })
  })
})
