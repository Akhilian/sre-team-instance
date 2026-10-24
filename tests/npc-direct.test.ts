// 022 CA1, CA2, CA3, CA5 : conversations directes avec les PNJ (store, orchestrateur, frappe) ;
// 029 CA4 : réponse fixe quand le plafond est atteint
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcResponder } from '../shared/types/npc'
import { createNpcDispatcher, NPC_BUSY_REPLY } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import {
  ChannelLimitError,
  ChannelValidationError,
  DirectChannelLimitError,
  addAnnouncement,
  addChannel,
  addDirectChannel,
  addMessage,
  addNpcMessage,
  clearMessages,
  exportSnapshot,
  getChannel,
  hasChannel,
  importSnapshot,
  isDirectOwner,
  listChannelSummaries,
  listChannels,
  listMessages,
  resetAll,
  resetChatStore,
} from '../server/utils/chat-store'
import {
  NPC_TYPING_TTL_MS,
  channelPresence,
  resetPresenceStore,
  setNpcTyping,
} from '../server/utils/presence-store'
import { CHANNELS_MAX, DIRECT_CHANNELS_MAX, NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE } from '../shared/utils/limits'
import { fakeClock, loadPersonas, personaById } from './npc-helpers'

const RELEASE = personaById('release-manager')
const CFO = personaById('cfo')
const DM = 'dm-alice--release-manager'

function openDm(participant = 'Alice', npc = RELEASE) {
  return addDirectChannel({ participant, npc })
}

describe('conversations directes (store, CA1)', () => {
  beforeEach(() => resetChatStore())

  it('création idempotente, id dm-<slug>--<npcId>, nom « participant ↔ PNJ »', () => {
    const first = openDm()
    expect(first.created).toBe(true)
    expect(first.channel).toEqual({ id: DM, name: `Alice ↔ ${RELEASE.name}`, direct: { participant: 'Alice', npcId: 'release-manager', npcName: RELEASE.name } })
    const second = openDm(' alice ')
    expect(second.created).toBe(false)
    expect(second.channel).toEqual(first.channel)
    // « Zoé » et « zoe » partagent la conversation
    expect(openDm('Zoé').channel.id).toBe(openDm('zoe').channel.id)
  })

  it('participant invalide : vide, trop long ou sans lettre ni chiffre', () => {
    for (const participant of ['', '   ', 'x'.repeat(51), '!!!', 42]) {
      expect(() => addDirectChannel({ participant, npc: RELEASE })).toThrow(ChannelValidationError)
    }
  })

  it('listée seulement pour son propriétaire, comparé par slug', () => {
    openDm()
    expect(listChannelSummaries().map(summary => summary.id)).not.toContain(DM)
    expect(listChannelSummaries('Bob').map(summary => summary.id)).not.toContain(DM)
    const mine = listChannelSummaries('ALICE').find(summary => summary.id === DM)
    expect(mine).toMatchObject({ direct: { participant: 'Alice', npcId: 'release-manager' }, messageCount: 0, totalCount: 0 })
    // Les canaux d'équipe n'ont pas de champ direct
    expect(listChannelSummaries('Alice').find(summary => summary.id === 'general')).not.toHaveProperty('direct')
    expect(isDirectOwner(getChannel(DM)!.direct!, 'alice')).toBe(true)
    expect(isDirectOwner(getChannel(DM)!.direct!, 'Bob')).toBe(false)
    // La chronologie (listChannels) voit toutes les conversations
    expect(listChannels().map(channel => channel.id)).toContain(DM)
  })

  it('CHANNELS_MAX ne compte que les canaux d\'équipe ; DIRECT_CHANNELS_MAX borne les conversations', () => {
    for (let index = 0; index < DIRECT_CHANNELS_MAX; index++) openDm(`Participant ${index}`)
    expect(() => openDm('Participant de trop')).toThrow(DirectChannelLimitError)
    // Une conversation existante se retrouve encore
    expect(openDm('Participant 0').created).toBe(false)

    for (let index = listChannelSummaries().length; index < CHANNELS_MAX; index++) addChannel({ name: `Canal ${index}` })
    expect(listChannelSummaries()).toHaveLength(CHANNELS_MAX)
    expect(() => addChannel({ name: 'Canal de trop' })).toThrow(ChannelLimitError)
  })

  it('resetAll et clearMessages (030) les suppriment', () => {
    openDm()
    addMessage(DM, { author: 'Alice', text: 'Bonjour' })
    clearMessages()
    expect(hasChannel(DM)).toBe(false)
    openDm()
    resetAll()
    expect(hasChannel(DM)).toBe(false)
    expect(listChannelSummaries('Alice').map(summary => summary.id)).toEqual(['general', 'incident-en-cours'])
  })

  it('un instantané exporté puis importé conserve direct ; un direct invalide est refusé', () => {
    openDm()
    addMessage(DM, { author: 'Alice', text: 'Bonjour' })
    const snapshot = JSON.parse(JSON.stringify(exportSnapshot()))
    resetChatStore()
    expect(importSnapshot(snapshot)).toBe(true)
    expect(getChannel(DM)).toEqual({ id: DM, name: `Alice ↔ ${RELEASE.name}`, direct: { participant: 'Alice', npcId: 'release-manager', npcName: RELEASE.name } })
    expect(listMessages(DM).map(message => message.text)).toEqual(['Bonjour'])
    expect(listChannelSummaries().map(summary => summary.id)).not.toContain(DM)

    // 030 CA3 : instantané v2 antérieur, direct sans npcName → id du PNJ
    const legacy = JSON.parse(JSON.stringify(snapshot))
    delete legacy.channels.find((channel: { id: string }) => channel.id === DM).direct.npcName
    resetChatStore()
    expect(importSnapshot(legacy)).toBe(true)
    expect(getChannel(DM)!.direct).toEqual({ participant: 'Alice', npcId: 'release-manager', npcName: 'release-manager' })

    const broken = JSON.parse(JSON.stringify(snapshot))
    broken.channels.find((channel: { id: string }) => channel.id === DM).direct = { participant: '', npcId: 'cfo' }
    expect(importSnapshot(broken)).toBe(false)
  })
})

function setup(options: { responder?: NpcResponder, delayMs?: number } = {}) {
  const clock = fakeClock()
  const onError = vi.fn()
  const dispatcher = createNpcDispatcher({
    ...clock,
    retriever: createLexicalRetriever(),
    responder: options.responder ?? createKeywordsResponder(),
    personas: loadPersonas(),
    delayMs: () => options.delayMs ?? 1500,
    history: message => listMessages(message.channelId),
    onError,
    directNpcId: channelId => getChannel(channelId)?.direct?.npcId,
    onTyping: (persona, channelId, typing) => setNpcTyping({ channelId, name: persona.name, typing }, clock.now()),
    publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
  })
  dispatcher.setEnabled(true)
  return { clock, dispatcher, onError }
}

function npcReplies(channelId = DM): Message[] {
  return listMessages(channelId).filter(message => message.npc !== undefined)
}

function ask(text: string, parentId?: string): Message {
  return addMessage(DM, { author: 'Alice', text, ...(parentId ? { parentId } : {}) })
}

describe('orchestrateur en conversation directe (CA2)', () => {
  beforeEach(() => {
    resetChatStore()
    resetPresenceStore()
    openDm()
  })

  it('message racine sans mention : réponse racine du PNJ de la conversation', async () => {
    const { clock, dispatcher } = setup()
    const question = ask('Quel déploiement récent ?')
    expect(dispatcher.handle(question)).toEqual(['release-manager'])
    await clock.advance(1500)
    const [reply] = npcReplies()
    expect(reply).toMatchObject({ author: RELEASE.name, npc: { id: 'release-manager' } })
    expect(reply).not.toHaveProperty('parentId')
    expect(reply!.text).toContain('v2.41.0')
  })

  it('message en fil : réponse dans ce fil', async () => {
    const { clock, dispatcher } = setup()
    const root = ask('Bonjour')
    const inThread = ask('Un rollback est possible ?', root.id)
    expect(dispatcher.handle(inThread)).toEqual(['release-manager'])
    await clock.advance(1500)
    expect(npcReplies()[0]!.parentId).toBe(root.id)
  })

  it('une mention d\'un autre PNJ n\'y déclenche que le PNJ de la conversation', async () => {
    const { clock, dispatcher } = setup()
    expect(dispatcher.handle(ask(`@${CFO.name} combien coûte la panne ?`))).toEqual(['release-manager'])
    await clock.advance(10_000)
    expect(npcReplies().map(message => message.npc!.id)).toEqual(['release-manager'])
  })

  it('rien pour un message de PNJ, une annonce ou si les PNJ sont coupés', () => {
    const { dispatcher } = setup()
    const npcMessage = addNpcMessage(DM, { npc: RELEASE, text: 'Je regarde.' })
    expect(dispatcher.handle(npcMessage)).toEqual([])
    expect(dispatcher.handle(addAnnouncement(DM, { text: 'Point dans 5 min' }))).toEqual([])
    dispatcher.setEnabled(false)
    expect(dispatcher.handle(ask('Quel déploiement récent ?'))).toEqual([])
  })

  it('budget séparé : les conversations directes ne consomment pas celui des canaux d\'équipe', () => {
    const { dispatcher } = setup()
    // Une conversation par participant (plafond par PNJ et par canal : 6 par minute)
    for (let index = 0; index < NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE; index++) {
      const id = addDirectChannel({ participant: `P${index}`, npc: RELEASE }).channel.id
      dispatcher.handle(addMessage(id, { author: `P${index}`, text: 'Quel déploiement ?' }))
    }
    const extra = addDirectChannel({ participant: 'Encore', npc: RELEASE }).channel.id
    expect(dispatcher.handle(addMessage(extra, { author: 'Encore', text: 'Quel déploiement ?' }))).toEqual([])
    // Canal d'équipe : toujours servi
    const team = addMessage('incident-en-cours', { author: 'Alice', text: `@${RELEASE.name} quel déploiement ?` })
    expect(dispatcher.handle(team)).toEqual(['release-manager'])
  })
})

describe('029 CA4 : plafond atteint en conversation directe', () => {
  beforeEach(() => {
    resetChatStore()
    resetPresenceStore()
    openDm()
  })

  it('7e message : réponse fixe à la racine sans moteur ; 8e : rien ; après 60 s : réponse normale', async () => {
    const respond = vi.fn(async () => 'réponse du moteur')
    const { clock, dispatcher } = setup({ responder: { respond } })
    for (let index = 1; index <= 6; index++) {
      expect(dispatcher.handle(ask(`Question ${index}`))).toEqual(['release-manager'])
      await clock.advance(2000)
    }
    expect(dispatcher.handle(ask('Question 7'))).toEqual([])
    const busy = npcReplies().filter(message => message.text === NPC_BUSY_REPLY)
    expect(busy).toHaveLength(1)
    expect(busy[0]).not.toHaveProperty('parentId')
    expect(dispatcher.handle(ask('Question 8'))).toEqual([])
    await clock.advance(5000)
    expect(npcReplies()).toHaveLength(7)
    expect(respond).toHaveBeenCalledTimes(6)
    await clock.advance(60_000)
    expect(dispatcher.handle(ask('Question 9'))).toEqual(['release-manager'])
    await clock.advance(2000)
    expect(respond).toHaveBeenCalledTimes(7)
    expect(npcReplies().at(-1)!.text).toBe('réponse du moteur')
  })
})

describe('frappe des PNJ (CA3, CA5)', () => {
  beforeEach(() => {
    resetChatStore()
    resetPresenceStore()
    openDm()
  })

  it('le PNJ écrit de la planification à la publication', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.handle(ask('Quel déploiement récent ?'))
    expect(channelPresence(DM, clock.now()).typing).toEqual([RELEASE.name])
    // Jamais compté parmi les présents
    expect(channelPresence(DM, clock.now()).present).toEqual([])
    await clock.advance(1499)
    expect(channelPresence(DM, clock.now()).typing).toEqual([RELEASE.name])
    await clock.advance(1)
    expect(npcReplies()).toHaveLength(1)
    expect(channelPresence(DM, clock.now()).typing).toEqual([])
  })

  it('fin de frappe après un échec du moteur', async () => {
    const failing: NpcResponder = { respond: () => Promise.reject(new Error('moteur en panne')) }
    const { clock, dispatcher, onError } = setup({ responder: failing })
    dispatcher.handle(ask('Quel déploiement récent ?'))
    expect(channelPresence(DM, clock.now()).typing).toEqual([RELEASE.name])
    await clock.advance(1500)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(channelPresence(DM, clock.now()).typing).toEqual([])
  })

  it('fin de frappe après cancelPending, avant ou pendant la formulation', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.handle(ask('Quel déploiement récent ?'))
    dispatcher.cancelPending()
    expect(channelPresence(DM, clock.now()).typing).toEqual([])

    // Moteur qui ne répond jamais : annulé pendant la formulation
    const stuck: NpcResponder = { respond: () => new Promise(() => {}) }
    const second = setup({ responder: stuck })
    second.dispatcher.handle(ask('Et maintenant ?'))
    await second.clock.advance(1500)
    expect(channelPresence(DM, second.clock.now()).typing).toEqual([RELEASE.name])
    second.dispatcher.cancelPending()
    expect(channelPresence(DM, second.clock.now()).typing).toEqual([])
  })

  it('sans fin signalée, la frappe expire après 20 s', () => {
    const now = 1_000_000
    setNpcTyping({ channelId: DM, name: RELEASE.name, typing: true }, now)
    expect(channelPresence(DM, now + NPC_TYPING_TTL_MS - 1).typing).toEqual([RELEASE.name])
    expect(channelPresence(DM, now + NPC_TYPING_TTL_MS).typing).toEqual([])
  })

  it('deux réponses du même PNJ : il écrit jusqu\'à la fin de la seconde', () => {
    const now = 1_000_000
    setNpcTyping({ channelId: DM, name: RELEASE.name, typing: true }, now)
    setNpcTyping({ channelId: DM, name: RELEASE.name, typing: true }, now)
    setNpcTyping({ channelId: DM, name: RELEASE.name, typing: false }, now)
    expect(channelPresence(DM, now).typing).toEqual([RELEASE.name])
    setNpcTyping({ channelId: DM, name: RELEASE.name, typing: false }, now)
    expect(channelPresence(DM, now).typing).toEqual([])
  })

  it('CA5 : un PNJ mentionné dans #incident-en-cours y apparaît dans typing pendant sa préparation', async () => {
    const { clock, dispatcher } = setup()
    const question = addMessage('incident-en-cours', { author: 'Alice', text: `@${RELEASE.name} quel déploiement récent ?` })
    dispatcher.handle(question)
    expect(channelPresence('incident-en-cours', clock.now()).typing).toEqual([RELEASE.name])
    expect(channelPresence(DM, clock.now()).typing).toEqual([])
    await clock.advance(1500)
    expect(channelPresence('incident-en-cours', clock.now()).typing).toEqual([])
  })
})
