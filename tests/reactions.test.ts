import { beforeEach, describe, expect, it } from 'vitest'
import {
  ChannelNotFoundError,
  MessageNotFoundError,
  MessageValidationError,
  addMessage,
  listMessages,
  resetChatStore,
  toggleReaction,
} from '../server/utils/chat-store'
import { REACTION_EMOJIS } from '../shared/utils/reactions'

describe('toggleReaction', () => {
  beforeEach(() => resetChatStore())

  it('expose le jeu fixe de 6 réactions dans l\'ordre de la palette', () => {
    expect(REACTION_EMOJIS).toEqual(['👍', '❤️', '😆', '😮', '😢', '😡'])
  })

  it('crée le champ reactions à la première réaction', () => {
    const message = addMessage('general', { author: 'Carol', text: 'je redémarre le service' })
    expect(message.reactions).toBeUndefined()
    const updated = toggleReaction('general', message.id, { emoji: '👍', author: ' Alice ' })
    expect(updated.reactions).toEqual([{ emoji: '👍', authors: ['Alice'] }])
    expect(listMessages('general')[0]!.reactions).toEqual([{ emoji: '👍', authors: ['Alice'] }])
  })

  it('ajoute un deuxième auteur dans l\'ordre d\'arrivée', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    toggleReaction('general', message.id, { emoji: '👍', author: 'Bob' })
    const updated = toggleReaction('general', message.id, { emoji: '👍', author: 'Alice' })
    expect(updated.reactions).toEqual([{ emoji: '👍', authors: ['Bob', 'Alice'] }])
  })

  it('retire la réaction à la bascule, puis l\'entrée et le champ devenus vides', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    toggleReaction('general', message.id, { emoji: '👍', author: 'Alice' })
    toggleReaction('general', message.id, { emoji: '❤️', author: 'Alice' })
    toggleReaction('general', message.id, { emoji: '❤️', author: 'Bob' })

    expect(toggleReaction('general', message.id, { emoji: '❤️', author: 'Alice' }).reactions)
      .toEqual([{ emoji: '👍', authors: ['Alice'] }, { emoji: '❤️', authors: ['Bob'] }])
    expect(toggleReaction('general', message.id, { emoji: '👍', author: 'Alice' }).reactions)
      .toEqual([{ emoji: '❤️', authors: ['Bob'] }])

    const cleared = toggleReaction('general', message.id, { emoji: '❤️', author: 'Bob' })
    expect('reactions' in cleared).toBe(false)
    expect('reactions' in listMessages('general')[0]!).toBe(false)
  })

  it('compare le nom exactement après trim', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    toggleReaction('general', message.id, { emoji: '👍', author: 'Alice' })
    const updated = toggleReaction('general', message.id, { emoji: '👍', author: 'alice' })
    expect(updated.reactions).toEqual([{ emoji: '👍', authors: ['Alice', 'alice'] }])
  })

  it('ordonne les emojis selon la première réaction, pas selon la palette', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    toggleReaction('general', message.id, { emoji: '😡', author: 'Alice' })
    toggleReaction('general', message.id, { emoji: '👍', author: 'Bob' })
    const updated = toggleReaction('general', message.id, { emoji: '😮', author: 'Alice' })
    expect(updated.reactions!.map(reaction => reaction.emoji)).toEqual(['😡', '👍', '😮'])
  })

  it('réagit sur une réponse', () => {
    const root = addMessage('general', { author: 'Carol', text: 'Go' })
    const reply = addMessage('general', { author: 'Bob', text: 'OK', parentId: root.id })
    const updated = toggleReaction('general', reply.id, { emoji: '❤️', author: 'Alice' })
    expect(updated).toMatchObject({ id: reply.id, parentId: root.id, reactions: [{ emoji: '❤️', authors: ['Alice'] }] })
    const [storedRoot, storedReply] = listMessages('general')
    expect(storedRoot!.reactions).toBeUndefined()
    expect(storedReply!.reactions).toEqual([{ emoji: '❤️', authors: ['Alice'] }])
  })

  it.each([
    [{ emoji: '🍕', author: 'Alice' }],
    [{ emoji: '❤', author: 'Alice' }],
    [{ author: 'Alice' }],
    [{ emoji: '👍', author: '' }],
    [{ emoji: '👍', author: '   ' }],
    [{ emoji: '👍' }],
    [{ emoji: '👍', author: 'a'.repeat(51) }],
  ])('refuse une entrée invalide sans rien modifier (%j)', (input) => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    toggleReaction('general', message.id, { emoji: '👍', author: 'Bob' })
    const before = listMessages('general')
    expect(() => toggleReaction('general', message.id, input)).toThrow(MessageValidationError)
    expect(listMessages('general')).toEqual(before)
  })

  it('refuse un message ou un canal inconnu', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    expect(() => toggleReaction('general', 'nope', { emoji: '👍', author: 'Alice' })).toThrow(MessageNotFoundError)
    expect(() => toggleReaction('nope', message.id, { emoji: '👍', author: 'Alice' })).toThrow(ChannelNotFoundError)
    expect(listMessages('general')[0]!.reactions).toBeUndefined()
  })

  it('renvoie des copies profondes des réactions', () => {
    const message = addMessage('general', { author: 'Carol', text: 'Go' })
    const updated = toggleReaction('general', message.id, { emoji: '👍', author: 'Alice' })
    updated.reactions![0]!.authors.push('Mallory')

    const listed = listMessages('general')
    listed[0]!.reactions![0]!.authors.push('Mallory')
    listed[0]!.reactions!.push({ emoji: '😡', authors: ['Mallory'] })

    expect(listMessages('general')[0]!.reactions).toEqual([{ emoji: '👍', authors: ['Alice'] }])
  })
})
