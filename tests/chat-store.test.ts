import { beforeEach, describe, expect, it } from 'vitest'
import {
  ChannelConflictError,
  ChannelNotFoundError,
  ChannelValidationError,
  MessageValidationError,
  addChannel,
  addMessage,
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
