// 019 CA3 : orchestrateur des PNJ, avec horloge et planificateur simulés et le vrai store
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcRequest, NpcResponder } from '../shared/types/npc'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import {
  addAlert,
  addAnnouncement,
  addChannel,
  addMessage,
  addNpcMessage,
  exportSnapshot,
  importSnapshot,
  listMessages,
  listMessagesSince,
  resetChatStore,
} from '../server/utils/chat-store'
import { NPC_REPLY_MAX_LENGTH } from '../shared/utils/limits'
import { fakeClock, loadPersonas, personaById } from './npc-helpers'

const CHANNEL = 'incident-en-cours'
const RELEASE = personaById('release-manager')
const CFO = personaById('cfo')

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
    publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
  })
  return { clock, dispatcher, onError }
}

function npcReplies(): Message[] {
  return listMessages(CHANNEL).filter(message => message.npc !== undefined)
}

function post(text: string, parentId?: string): Message {
  return addMessage(CHANNEL, { author: 'Alice', text, ...(parentId ? { parentId } : {}) })
}

describe('createNpcDispatcher', () => {
  beforeEach(() => resetChatStore())

  it('inactifs par défaut ; le scénario panne-checkout les active', () => {
    const { dispatcher } = setup()
    expect(dispatcher.isEnabled()).toBe(false)
    expect(dispatcher.activateScenario('demo-express')).toBe(false)
    expect(dispatcher.isEnabled()).toBe(false)
    expect(dispatcher.activateScenario('panne-checkout')).toBe(true)
    expect(dispatcher.isEnabled()).toBe(true)
    expect(dispatcher.list().map(npc => npc.id)).toEqual(['ceo', 'cfo', 'communication', 'psp', 'release-manager', 'support-n1'])
  })

  it('message racine : réponse dans son fil, signée du PNJ, après le délai', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    const question = post(`@${RELEASE.name} quel déploiement récent ?`)
    expect(dispatcher.handle(question)).toEqual(['release-manager'])

    await clock.advance(1499)
    expect(npcReplies()).toEqual([])
    await clock.advance(1)
    const [reply] = npcReplies()
    expect(reply).toMatchObject({
      author: RELEASE.name,
      parentId: question.id,
      npc: { id: 'release-manager', role: RELEASE.role },
    })
    expect(reply!.text).toContain('v2.41.0')
    // Publiée par le store : elle apparaît dans les deltas du polling
    expect(listMessagesSince(CHANNEL, question.rev).messages.map(message => message.id)).toEqual([reply!.id])
  })

  it('message en fil : réponse dans le même fil', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    const root = post('Le checkout est en panne')
    const inThread = post(`@${RELEASE.name.toLowerCase()} un rollback est possible ?`, root.id)
    expect(dispatcher.handle(inThread)).toEqual(['release-manager'])
    await clock.advance(1500)
    expect(npcReplies()).toHaveLength(1)
    expect(npcReplies()[0]!.parentId).toBe(root.id)
    expect(npcReplies()[0]!.text).toContain('v2.40.3')
  })

  it('plusieurs PNJ mentionnés : chacun répond une fois, au plus 3', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    const names = loadPersonas().map(persona => `@${persona.name}`)
    const question = post(`${names.join(' ')} ${names[0]} on fait le point ?`)
    expect(dispatcher.handle(question)).toHaveLength(3)
    await clock.advance(10_000)
    expect(npcReplies()).toHaveLength(3)
  })

  it('aucune réponse : PNJ inactifs, message de PNJ, annonce, alerte, sans mention', async () => {
    const { clock, dispatcher } = setup()
    expect(dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))).toEqual([])

    dispatcher.setEnabled(true)
    const fromNpc = addNpcMessage(CHANNEL, { npc: CFO, text: `@${RELEASE.name} quel déploiement ?` })
    expect(dispatcher.handle(fromNpc)).toEqual([])
    expect(dispatcher.handle(addAnnouncement(CHANNEL, { text: `@${RELEASE.name} quel déploiement ?` }))).toEqual([])
    const alert = addAlert(CHANNEL, { severity: 'SEV1', title: 't', service: 's', text: `@${RELEASE.name} quel déploiement ?` })
    expect(dispatcher.handle(alert)).toEqual([])
    expect(dispatcher.handle(post('Julien Moreau, quel déploiement ?'))).toEqual([])

    await clock.advance(10_000)
    expect(npcReplies().map(message => message.id)).toEqual([fromNpc.id])
  })

  it('la coupure annule les réponses en attente', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))
    dispatcher.setEnabled(false)
    dispatcher.setEnabled(true)
    await clock.advance(10_000)
    expect(npcReplies()).toEqual([])
  })

  it('la 7e mention du même PNJ dans la minute reste sans réponse', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    for (let index = 1; index <= 6; index++) {
      expect(dispatcher.handle(post(`@${RELEASE.name} question ${index}`))).toEqual(['release-manager'])
      await clock.advance(5000)
    }
    expect(dispatcher.handle(post(`@${RELEASE.name} question 7`))).toEqual([])
    // Un autre PNJ répond toujours
    expect(dispatcher.handle(post(`@${CFO.name} combien ça coûte ?`))).toEqual(['cfo'])
    await clock.advance(5000)
    expect(npcReplies().filter(message => message.npc?.id === 'release-manager')).toHaveLength(6)
    // Une minute après la première réponse planifiée, le PNJ peut répondre de nouveau
    await clock.advance(30_000)
    expect(dispatcher.handle(post(`@${RELEASE.name} question 8`))).toEqual(['release-manager'])
  })

  it('020 CA4 : 20 réponses dans le canal A n\'empêchent pas une réponse dans le canal B', async () => {
    const { clock, dispatcher } = setup()
    dispatcher.setEnabled(true)
    const names = loadPersonas().map(persona => `@${persona.name}`)
    let scheduled = 0
    for (let index = 0; index < 5; index++) {
      scheduled += dispatcher.handle(post(`${names.join(' ')} ?`)).length
    }
    // 3 PNJ au plus par message : 5 × 3 = 15, puis 5 de plus
    for (let index = 0; index < 5; index++) scheduled += dispatcher.handle(post(`${names[3]} ?`)).length
    expect(scheduled).toBe(20)
    expect(dispatcher.handle(post(`${names[3]} encore ?`))).toEqual([])
    const inB = addMessage('general', { author: 'Alice', text: `${names[0]} et ici ?` })
    expect(dispatcher.handle(inB)).toHaveLength(1)
    await clock.advance(30_000)
    expect(listMessages('general').filter(message => message.npc)).toHaveLength(1)
  })

  it('020 CA4 : au plus 60 réponses par minute tous canaux confondus', () => {
    const { dispatcher } = setup()
    dispatcher.setEnabled(true)
    const names = loadPersonas().map(persona => `@${persona.name}`)
    let scheduled = 0
    for (let channel = 0; channel < 4; channel++) {
      const channelId = addChannel({ name: `Canal ${channel}` }).id
      for (let index = 0; index < 8; index++) {
        const text = `${names[index % 4]} ${names[(index + 1) % 4]} ${names[(index + 2) % 4]} ?`
        scheduled += dispatcher.handle(addMessage(channelId, { author: 'Alice', text })).length
      }
    }
    expect(scheduled).toBe(60)
  })

  it('020 CA4 : cancelPending (reset messages) : ni publication ni onError', async () => {
    let release: (text: string) => void = () => {}
    const responder: NpcResponder = { respond: () => new Promise((done) => { release = done }) }
    const { clock, dispatcher, onError } = setup({ responder })
    dispatcher.setEnabled(true)
    // Une réponse en cours de formulation et une encore planifiée
    dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))
    await clock.advance(1500)
    dispatcher.handle(post(`@${CFO.name} combien ?`))
    dispatcher.cancelPending()
    resetChatStore()
    release('trop tard')
    await clock.advance(60_000)
    expect(npcReplies()).toEqual([])
    expect(onError).not.toHaveBeenCalled()
    expect(dispatcher.isEnabled()).toBe(true)
  })

  it('020 CA4 : le onError par défaut écrit une seule ligne, sans trace de pile', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const clock = fakeClock()
      const dispatcher = createNpcDispatcher({
        ...clock,
        retriever: createLexicalRetriever(),
        responder: { respond: () => Promise.reject(new Error('moteur\nen panne')) },
        personas: loadPersonas(),
        publish: () => {},
      })
      dispatcher.setEnabled(true)
      dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))
      await clock.advance(10_000)
      expect(error).toHaveBeenCalledOnce()
      expect(error.mock.calls[0]).toEqual(['[npc] réponse abandonnée : moteur en panne'])
    }
    finally {
      error.mockRestore()
    }
  })

  it('au plus 20 réponses par minute tous PNJ confondus dans un canal', () => {
    const { dispatcher } = setup()
    dispatcher.setEnabled(true)
    const names = loadPersonas().map(persona => `@${persona.name}`)
    let scheduled = 0
    for (let index = 0; index < 10; index++) {
      scheduled += dispatcher.handle(post(`${names[index % 4]} ${names[(index + 1) % 4]} ${names[(index + 2) % 4]} ?`)).length
    }
    expect(scheduled).toBe(20)
  })

  it('transmet au moteur l\'historique récent (au plus 10, question exclue) et tronque à 600 caractères', async () => {
    const requests: NpcRequest[] = []
    const responder: NpcResponder = {
      respond: (request) => {
        requests.push(request)
        return Promise.resolve('x'.repeat(2000))
      },
    }
    const { clock, dispatcher } = setup({ responder })
    dispatcher.setEnabled(true)
    for (let index = 0; index < 12; index++) post(`message ${index}`)
    const question = post(`@${RELEASE.name} quel déploiement récent ?`)
    dispatcher.handle(question)
    await clock.advance(1500)

    expect(requests).toHaveLength(1)
    expect(requests[0]!.question).toBe(question.text)
    expect(requests[0]!.history.map(message => message.text)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message ${index + 2}`),
    )
    expect(requests[0]!.excerpts.length).toBeGreaterThan(0)
    expect(npcReplies()[0]!.text).toHaveLength(NPC_REPLY_MAX_LENGTH)
    expect(npcReplies()[0]!.text.endsWith('…')).toBe(true)
  })

  it('retriever trop lent : réponse abandonnée sans exception', async () => {
    const clock = fakeClock()
    const onError = vi.fn()
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever: { retrieve: () => new Promise(() => {}) },
      responder: createKeywordsResponder(),
      personas: loadPersonas(),
      onError,
      publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
    })
    dispatcher.setEnabled(true)
    dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))
    await clock.advance(60_000)
    expect(npcReplies()).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
  })

  it('moteur trop lent ou en échec : réponse abandonnée sans exception', async () => {
    const slow: NpcResponder = { respond: () => new Promise(() => {}) }
    const { clock, dispatcher, onError } = setup({ responder: slow })
    dispatcher.setEnabled(true)
    dispatcher.handle(post(`@${RELEASE.name} quel déploiement ?`))
    await clock.advance(60_000)
    expect(npcReplies()).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
  })

  it('findByName ignore la casse et couvre les PNJ inactifs', () => {
    const { dispatcher } = setup()
    expect(dispatcher.findByName('  julien moreau ')?.id).toBe('release-manager')
    expect(dispatcher.findByName('Alice')).toBeUndefined()
    expect(dispatcher.findByName('')).toBeUndefined()
  })
})

describe('second scénario fuite-donnees (027 CA5)', () => {
  beforeEach(() => resetChatStore())

  /** Toutes les fiches, triées par chemin comme au chargement : fuite-donnees passe avant panne-checkout */
  function allPersonas() {
    return [...loadPersonas('fuite-donnees'), ...loadPersonas('panne-checkout')]
  }

  function setupAll(initialScenarioId?: string) {
    const clock = fakeClock()
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever: createLexicalRetriever(),
      responder: createKeywordsResponder(),
      personas: allPersonas(),
      ...(initialScenarioId === undefined ? {} : { initialScenarioId }),
      delayMs: () => 1000,
      publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
    })
    return { clock, dispatcher }
  }

  const PANNE_IDS = ['ceo', 'cfo', 'communication', 'psp', 'release-manager', 'support-n1']
  const FUITE_IDS = ['dev-data', 'dpo', 'porte-parole', 'soc', 'support-clients']

  it('initialScenarioId : panne-checkout avant tout lancement, malgré le tri par chemin', () => {
    expect(setupAll().dispatcher.scenarioId()).toBe('fuite-donnees')
    expect(setupAll('inconnu').dispatcher.scenarioId()).toBe('fuite-donnees')
    const { dispatcher } = setupAll('panne-checkout')
    expect(dispatcher.scenarioId()).toBe('panne-checkout')
    expect(dispatcher.isEnabled()).toBe(false)
    expect(dispatcher.list().map(npc => npc.id)).toEqual(PANNE_IDS)
  })

  it('lancer fuite-donnees n\'active que ses 5 PNJ ; @Sarah Benali sans réponse, @Yanis Belkacem répond', async () => {
    const { clock, dispatcher } = setupAll('panne-checkout')
    expect(dispatcher.activateScenario('fuite-donnees')).toBe(true)
    expect(dispatcher.isEnabled()).toBe(true)
    expect(dispatcher.list().map(npc => npc.id)).toEqual(FUITE_IDS)

    expect(dispatcher.handle(post('@Sarah Benali tu as des tickets ?'))).toEqual([])
    const question = post('@Yanis Belkacem quels téléchargements dans les journaux d\'accès ?')
    expect(dispatcher.handle(question)).toEqual(['soc'])
    await clock.advance(1000)
    const [reply] = npcReplies()
    expect(reply).toMatchObject({ author: 'Yanis Belkacem', parentId: question.id, npc: { id: 'soc' } })
    expect(reply!.text).toContain('23h14')

    // Retour à panne-checkout : ses 6 PNJ, Yanis ne répond plus
    expect(dispatcher.activateScenario('panne-checkout')).toBe(true)
    expect(dispatcher.list().map(npc => npc.id)).toEqual(PANNE_IDS)
    expect(dispatcher.handle(post('@Yanis Belkacem tu es là ?'))).toEqual([])
    expect(dispatcher.handle(post('@Sarah Benali tu as des tickets ?'))).toEqual(['support-n1'])
  })

  it('resetScenario : PNJ coupés, réponses annulées, retour au scénario initial', async () => {
    const { clock, dispatcher } = setupAll('panne-checkout')
    dispatcher.activateScenario('fuite-donnees')
    expect(dispatcher.handle(post('@Yanis Belkacem quels téléchargements dans les journaux d\'accès ?'))).toEqual(['soc'])
    dispatcher.resetScenario()
    await clock.advance(1000)
    expect(npcReplies()).toEqual([])
    expect(dispatcher.isEnabled()).toBe(false)
    expect(dispatcher.scenarioId()).toBe('panne-checkout')
    expect(dispatcher.list().map(npc => npc.id)).toEqual(PANNE_IDS)
    // Sans initialScenarioId : celui de la première fiche
    const fallback = setupAll().dispatcher
    fallback.activateScenario('panne-checkout')
    fallback.resetScenario()
    expect(fallback.scenarioId()).toBe('fuite-donnees')
  })
})

describe('addNpcMessage', () => {
  beforeEach(() => resetChatStore())

  it('refuse un parentId qui n\'est pas une racine du canal', () => {
    const root = post('racine')
    const reply = post('réponse', root.id)
    expect(() => addNpcMessage(CHANNEL, { npc: CFO, text: 'x', parentId: reply.id })).toThrow(/racine/)
    expect(() => addNpcMessage(CHANNEL, { npc: CFO, text: 'x', parentId: 'inconnu' })).toThrow()
  })

  it('l\'instantané conserve npc et en valide la forme', () => {
    const message = addNpcMessage(CHANNEL, { npc: CFO, text: 'Les chiffres' })
    const snapshot = exportSnapshot()
    resetChatStore()
    expect(importSnapshot(snapshot)).toBe(true)
    expect(listMessages(CHANNEL)[0]).toEqual(message)

    const broken = structuredClone(snapshot)
    broken.messages[CHANNEL]![0]!.npc = { id: 1 } as never
    expect(importSnapshot(broken)).toBe(false)
  })

  it('les messages copiés ne partagent pas npc avec le store', () => {
    addNpcMessage(CHANNEL, { npc: CFO, text: 'Les chiffres' })
    listMessages(CHANNEL)[0]!.npc!.id = 'modifié'
    expect(listMessages(CHANNEL)[0]!.npc!.id).toBe('cfo')
  })
})
