// 040 : qualité des réponses des PNJ (prompt, anti-répétition, cas de référence, mentions, spontanées)
import { beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcRequest, NpcResponder } from '../shared/types/npc'
import { isNearDuplicate, normalizeReply, recentOwnReplies, withoutRepeats } from '../server/npc/anti-repeat'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { NPC_ACK_TEXTS, NPC_BUSY_REPLY } from '../server/npc/generic-phrases'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { buildNpcPrompt } from '../server/npc/prompt'
import { createSpontaneousEngine } from '../server/npc/spontaneous'
import { addMessage, addNpcMessage, listMessages, resetChatStore } from '../server/utils/chat-store'
import { fakeClock, loadPersonas, personaById } from './npc-helpers'

const CHANNEL = 'incident-en-cours'
const RELEASE = personaById('release-manager')
const retriever = createLexicalRetriever()
const keywords = createKeywordsResponder()

async function request(persona = RELEASE, question: string, extra: Partial<NpcRequest> = {}): Promise<NpcRequest> {
  return { persona, excerpts: await retriever.retrieve(persona, question), history: [], question, ...extra }
}

function npcMessage(text: string, rev: number, persona = RELEASE): Message {
  return {
    id: `n${rev}`, channelId: CHANNEL, author: persona.name, text, createdAt: new Date(rev * 1000).toISOString(), rev,
    npc: { id: persona.id, role: persona.role },
  }
}

describe('prompt (CA2, CA3)', () => {
  it('CA2 : l\'extrait de fiche est aussi dans le tour utilisateur, « Fait à utiliser : … »', async () => {
    const prompt = buildNpcPrompt(await request(RELEASE, 'Quelle version a été déployée ?', { questionAuthor: 'Alice' }))
    const last = prompt.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content.startsWith('Alice : Quelle version a été déployée ?')).toBe(true)
    expect(last.content).toContain('Fait à utiliser : ')
    expect(last.content).toContain('v2.41.0')
    // et toujours dans le system
    expect(prompt[0]!.content).toContain('Extraits de ta fiche pertinents')
  })

  it('CA2 : sans extrait, pas de « Fait à utiliser »', async () => {
    const last = buildNpcPrompt(await request(RELEASE, 'Bonjour, tu as des nouvelles ?')).at(-1)!
    expect(last.content).toBe('Bonjour, tu as des nouvelles ?')
  })

  it('CA3 : aucune phrase d\'exemple dans les prompts', async () => {
    const old = [
      'Ok, je regarde côté facturation et je reviens vers vous dans 5 min.',
      'Ça fait 20 minutes, il me faut un point clair : qui pilote ?',
      'Aucune idée, c\'est pas mon périmètre. Voyez avec l\'équipe release.',
    ]
    for (const persona of loadPersonas()) {
      const prompts = [
        buildNpcPrompt(await request(persona, 'Quel est le point ?')),
        buildNpcPrompt({ ...await request(persona, ''), excerpts: [], spontaneous: { base: 'On en est où ?' } }),
      ]
      for (const prompt of prompts) {
        const all = prompt.map(entry => entry.content).join('\n')
        for (const phrase of old) expect(all).not.toContain(phrase)
        expect(all).not.toContain('Exemples de ton')
      }
    }
  })
})

describe('anti-répétition (CA4)', () => {
  const echo = (text: string): NpcResponder => ({ respond: () => Promise.resolve(text) })

  it('normalisation : casse, accents et ponctuation', () => {
    expect(normalizeReply('Ça  marche, HEIN !')).toBe(normalizeReply('ca marche hein'))
  })

  it('une réponse identique à l\'une des 3 dernières est rejetée au profit de l\'extrait du retriever', async () => {
    const history = [npcMessage('Je regarde ça.', 1), npcMessage('Pas de nouvelles.', 2), npcMessage('On attend.', 3)]
    const req = await request(RELEASE, 'Quelle version a été déployée ?', { history })
    const text = await withoutRepeats(echo('je regarde ça !'), keywords).respond(req)
    expect(text).toBe(req.excerpts[0]!.text)
    expect(text).toContain('v2.41.0')
  })

  it('seules les 3 dernières comptent', async () => {
    const history = [npcMessage('Vieille phrase.', 1), npcMessage('a', 2), npcMessage('b', 3), npcMessage('c', 4)]
    const req = await request(RELEASE, 'Quelle version a été déployée ?', { history })
    expect(await withoutRepeats(echo('Vieille phrase.'), keywords).respond(req)).toBe('Vieille phrase.')
  })

  it('extrait lui-même déjà dit : extrait suivant, puis repli keywords', async () => {
    const req = await request(RELEASE, 'Quelle version a été déployée ?')
    const [first, second] = req.excerpts
    const said = [npcMessage(first!.text, 1), npcMessage('Phrase.', 2)]
    expect(await withoutRepeats(echo('Phrase.'), keywords).respond({ ...req, history: said })).toBe(second!.text)
    const all = req.excerpts.map((excerpt, index) => npcMessage(excerpt.text, index + 1))
    all.push(npcMessage('Phrase.', 9))
    const fallback = await withoutRepeats(echo('Phrase.'), keywords).respond({ ...req, history: all.slice(-3) })
    expect(fallback).toBe(await keywords.respond(req))
  })

  it('accusés et réponse « sollicité » ne comptent pas comme réponses à répéter', async () => {
    const history = [npcMessage(NPC_BUSY_REPLY, 1), npcMessage(NPC_ACK_TEXTS[0]!, 2)]
    const req = await request(RELEASE, 'Quelle version a été déployée ?', { history })
    expect(recentOwnReplies(req)).toEqual([])
    expect(await withoutRepeats(echo(NPC_ACK_TEXTS[0]!), keywords).respond(req)).toBe(NPC_ACK_TEXTS[0]!)
  })

  it('les phrases génériques déjà dites ne sont plus injectées dans l\'historique du modèle', async () => {
    const history = [
      npcMessage(NPC_BUSY_REPLY, 1),
      npcMessage(NPC_ACK_TEXTS[1]!, 2),
      npcMessage(RELEASE.deflection, 3),
      npcMessage('Je suis sur le dossier.', 4),
      { ...npcMessage('Merci', 5), author: 'Alice', npc: undefined },
    ]
    const prompt = buildNpcPrompt(await request(RELEASE, 'Quelle version ?', { history }))
    const all = prompt.slice(1).map(entry => entry.content)
    expect(all.join('\n')).not.toContain(NPC_BUSY_REPLY)
    expect(all.join('\n')).not.toContain(NPC_ACK_TEXTS[1]!)
    expect(all.join('\n')).not.toContain(RELEASE.deflection)
    expect(all.join('\n')).toContain('Je suis sur le dossier.')
    expect(all.join('\n')).toContain('Alice : Merci')
  })

  it('les interventions spontanées ne sont pas filtrées ici', async () => {
    const req = { ...await request(RELEASE, ''), history: [npcMessage('Même texte.', 1)], spontaneous: { base: 'Même texte.' } }
    expect(await withoutRepeats(echo('Même texte.'), keywords).respond(req)).toBe('Même texte.')
  })
})

describe('cas de référence (CA5)', () => {
  const answer = async (id: string, question: string) => keywords.respond(await request(personaById(id), question))

  it('« quelle version a été déployée ? » à Julien : v2.41.0', async () => {
    expect(await answer('release-manager', 'quelle version a été déployée ?')).toContain('v2.41.0')
  })

  it('« Concerne tous les utilisateurs ou une partie ? » à Sarah : partout, ordinateur comme mobile', async () => {
    expect(await answer('support-n1', 'Concerne tous les utilisateurs ou une partie ?')).toContain('partout, ordinateur comme mobile')
  })

  it('« mise en prod récente ? » à Julien : v2.41.0 (question courte, expression)', async () => {
    expect(await answer('release-manager', 'mise en prod récente ?')).toContain('v2.41.0')
  })

  it('un mot isolé ne livre toujours pas une information précise', async () => {
    expect(await answer('release-manager', 'Et le rollback ?')).toContain('v2.40.3')
    expect(await answer('release-manager', 'des nouvelles ?')).toBe(RELEASE.deflection)
    expect(await answer('support-n1', 'Et la carte ?')).not.toContain('carte cadeau')
  })
})

function dispatcherSetup(personas = [...loadPersonas(), ...loadPersonas('fuite-donnees')]) {
  const clock = fakeClock()
  const notices: { channelId: string, parentId?: string, text: string }[] = []
  const dispatcher = createNpcDispatcher({
    ...clock,
    retriever,
    responder: keywords,
    personas,
    delayMs: () => 0,
    history: message => listMessages(message.channelId),
    channelContext: message => listMessages(message.channelId),
    notice: (channelId, parentId, text) => { notices.push({ channelId, parentId, text }) },
    publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
  })
  dispatcher.activateScenario('panne-checkout')
  return { clock, dispatcher, notices }
}

const replies = (): Message[] => listMessages(CHANNEL).filter(message => message.npc !== undefined)

describe('dispatcher : mentions (CA6)', () => {
  beforeEach(() => resetChatStore())

  it('@PNJ d\'un autre scénario : message système court dans le fil, aucune réponse', async () => {
    const { clock, dispatcher, notices } = dispatcherSetup()
    const other = loadPersonas('fuite-donnees')[0]!
    const question = addMessage(CHANNEL, { author: 'Alice', text: `@${other.name} tu as des nouvelles ?` })
    expect(dispatcher.handle({ ...question })).toEqual([])
    await clock.advance(0)
    expect(replies()).toEqual([])
    expect(notices).toEqual([{ channelId: CHANNEL, parentId: question.id, text: `${other.name} n'est pas dans ce scénario.` }])
    // Pas de doublon immédiat pour le même nom
    dispatcher.handle(addMessage(CHANNEL, { author: 'Alice', text: `@${other.name} ?` }))
    expect(notices).toHaveLength(1)
  })

  it('@ d\'un inconnu quelconque ou d\'un participant : aucun avis', async () => {
    const { dispatcher, notices } = dispatcherSetup()
    dispatcher.handle(addMessage(CHANNEL, { author: 'Alice', text: '@Zorglub ça va ?' }))
    dispatcher.handle(addMessage(CHANNEL, { author: 'Alice', text: `@${RELEASE.name} quel déploiement ?` }))
    expect(notices).toEqual([])
  })

  it('« @Julien Moreau ? » reprend la dernière question du même auteur', async () => {
    const { clock, dispatcher } = dispatcherSetup()
    addMessage(CHANNEL, { author: 'Bob', text: 'Autre sujet ?' })
    addMessage(CHANNEL, { author: 'Alice', text: 'Quelle version a été déployée ?' })
    addMessage(CHANNEL, { author: 'Alice', text: 'ok je note' })
    const ping = addMessage(CHANNEL, { author: 'Alice', text: `@${RELEASE.name} ?` })
    expect(dispatcher.handle(ping)).toEqual(['release-manager'])
    await clock.advance(0)
    const [reply] = replies()
    expect(reply!.text).toContain('v2.41.0')
    expect(reply!.parentId).toBe(ping.id)
  })

  it('mention sans texte et sans question antérieure : comportement inchangé (esquive de la fiche)', async () => {
    const { clock, dispatcher } = dispatcherSetup()
    dispatcher.handle(addMessage(CHANNEL, { author: 'Alice', text: `@${RELEASE.name}` }))
    await clock.advance(0)
    expect(replies().map(message => message.text)).toEqual([RELEASE.deflection])
  })

  it('message sans mention dans un canal d\'incident : aucune réponse', async () => {
    const { clock, dispatcher } = dispatcherSetup()
    expect(dispatcher.handle(addMessage(CHANNEL, { author: 'Alice', text: 'Quelle version a été déployée ?' }))).toEqual([])
    await clock.advance(0)
    expect(replies()).toEqual([])
  })
})

describe('interventions spontanées sans doublon (CA7)', () => {
  beforeEach(() => resetChatStore())

  function setup(recent: string[]) {
    const clock = fakeClock()
    const ceo = personaById('ceo')
    const engine = createSpontaneousEngine<number>({
      ...clock,
      personas: () => [{ ...ceo, spontaneous: [{ trigger: { type: 'after', minutes: 1 }, text: 'Il me faut un point de situation maintenant.' }] }],
      recentTexts: () => recent,
      formulate: () => Promise.resolve('Il me faut un point de situation maintenant, vite.'),
      publish: (persona, channelId, text) => addNpcMessage(channelId, { npc: persona, text }),
      onError: (error) => { throw error },
    })
    engine.start(CHANNEL)
    return { clock }
  }

  it('reformulation quasi identique à un message récent du PNJ : non publiée', async () => {
    const { clock } = setup(['Il me faut un point de situation maintenant, vite !'])
    await clock.advance(60_000)
    expect(replies()).toEqual([])
  })

  it('texte différent : publié', async () => {
    const { clock } = setup(['Le CFO demande les pertes.'])
    await clock.advance(60_000)
    expect(replies()).toHaveLength(1)
  })

  it('quasi-doublon : mêmes mots à quelques détails près, mais pas deux phrases courtes différentes', () => {
    expect(isNearDuplicate('Il me faut un point de situation maintenant', ['Il me faut un point de situation maintenant, vite'])).toBe(true)
    expect(isNearDuplicate('On en est où ?', ['On en est où ?'])).toBe(true)
    expect(isNearDuplicate('On attend.', ['On voit.'])).toBe(false)
    expect(isNearDuplicate('Rien de neuf côté clients.', ['Je veux un point sur le coût.'])).toBe(false)
  })
})


describe('051 CA4 : anti-redite inter-PNJ', () => {
  it('B quasi identique à A : repli, issue rejected_repeat', async () => {
    const cfo = personaById('cfo')
    const same = 'Le rollback vers la version précédente est prêt, on attend seulement votre feu vert pour lancer.'
    const seen: NpcRequest[] = []
    const model: NpcResponder = { respond: async (req) => { seen.push(req); return same } }
    const responder = withoutRepeats(model, keywords)
    const clock = fakeClock()
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever,
      responder,
      personas: loadPersonas(),
      delayMs: () => 1000,
      history: message => listMessages(message.channelId),
      publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
    })
    dispatcher.setEnabled(true)
    resetChatStore()
    const question = addMessage(CHANNEL, { author: 'Alice', text: `@${RELEASE.name} @${cfo.name} on fait le point ?` })
    dispatcher.handle(question)
    await clock.advance(5000)
    const replies = listMessages(CHANNEL).filter(message => message.npc)
    expect(replies).toHaveLength(2)
    expect(replies[0]!.text).toBe(same)
    expect(replies[1]!.text).not.toBe(same)
    const { takeReplyOutcome } = await import('../server/utils/war-room-metrics')
    expect(takeReplyOutcome(seen[0]!)).toBe('ok')
    expect(takeReplyOutcome(seen[1]!)).toBe('rejected_repeat')
  })
})
