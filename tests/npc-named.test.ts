// 033 CA3 et 019 (bis) CA11 : PNJ interpellé par son prénom (@Claire) ou par son nom en clair (Claire, …)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNpcDispatcher, NPC_BUSY_REPLY } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { addMessage, addNpcMessage, listMessages, resetChatStore } from '../server/utils/chat-store'
import { fakeClock, loadPersonas } from './npc-helpers'

const CHANNEL = 'incident-en-cours'

function setup(enabled = true) {
  const clock = fakeClock()
  const dispatcher = createNpcDispatcher({
    ...clock,
    retriever: createLexicalRetriever(),
    responder: createKeywordsResponder(),
    personas: loadPersonas(),
    history: message => listMessages(message.channelId),
    onError: vi.fn(),
    publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
  })
  dispatcher.setEnabled(enabled)
  return { clock, dispatcher }
}

const post = (text: string, author = 'Alice', parentId?: string) =>
  addMessage(CHANNEL, { author, text, ...(parentId ? { parentId } : {}) })

describe('prénom avec @ (033)', () => {
  beforeEach(() => resetChatStore())

  it('@Claire planifie ceo ; ambiguïté avec Claire Martin ou PNJ coupés : rien', () => {
    expect(setup().dispatcher.handle(post('@Claire tu es là ?'))).toEqual(['ceo'])
    post('bonjour', 'Claire Martin')
    expect(setup().dispatcher.handle(post('@Claire tu es là ?'))).toEqual([])
    expect(setup().dispatcher.handle(post('@Claire Dumont tu es là ?'))).toEqual(['ceo'])
    resetChatStore()
    expect(setup(false).dispatcher.handle(post('@Claire tu es là ?'))).toEqual([])
  })
})

describe('nom en clair (019 bis)', () => {
  beforeEach(() => resetChatStore())

  it('racine et fil : réponse dans le fil du message', async () => {
    const { clock, dispatcher } = setup()
    const root = post('Claire, tu es là ?')
    expect(dispatcher.handle(root)).toEqual(['ceo'])
    await clock.advance(1500)
    expect(listMessages(CHANNEL).find(m => m.npc)?.parentId).toBe(root.id)
    const inThread = post('Claire, un point ?', 'Alice', root.id)
    expect(dispatcher.handle(inThread)).toEqual(['ceo'])
  })

  it('plusieurs noms : dans l\'ordre ; @mention présente : elle seule compte', () => {
    const { dispatcher } = setup()
    expect(dispatcher.handle(post('Claire et Julien, un point ?'))).toEqual(['ceo', 'release-manager'])
    expect(dispatcher.handle(post('@Julien Moreau tu as vu Claire ?'))).toEqual(['release-manager'])
    post('salut', 'Bob')
    expect(dispatcher.handle(post('@Bob demande à Claire'))).toEqual([])
  })

  it('aucune réponse : message de PNJ, PNJ coupés, mot collé', () => {
    const { dispatcher } = setup()
    const npcMessage = addNpcMessage(CHANNEL, { npc: loadPersonas()[0]!, text: 'Claire va répondre' })
    expect(dispatcher.handle(npcMessage)).toEqual([])
    expect(dispatcher.handle(post('Claireval est en panne'))).toEqual([])
    expect(setup(false).dispatcher.handle(post('Claire, tu es là ?'))).toEqual([])
  })

  it('plafond atteint : réponse « sollicité »', () => {
    const { dispatcher } = setup()
    for (let i = 0; i < 6; i++) dispatcher.handle(post('Claire, tu es là ?'))
    dispatcher.handle(post('Claire, tu es là ?'))
    expect(listMessages(CHANNEL).some(m => m.text === NPC_BUSY_REPLY)).toBe(true)
  })
})
