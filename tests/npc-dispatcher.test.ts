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
  addMessage,
  addNpcMessage,
  exportSnapshot,
  importSnapshot,
  listMessages,
  listMessagesSince,
  resetChatStore,
} from '../server/utils/chat-store'
import { NPC_REPLY_MAX_LENGTH } from '../shared/utils/limits'
import { loadPersonas, personaById } from './npc-helpers'

const T0 = Date.UTC(2026, 9, 23, 14, 0, 0)
const CHANNEL = 'incident-en-cours'
const RELEASE = personaById('release-manager')
const CFO = personaById('cfo')

/** Planificateur simulé : advance() exécute les tâches échues, puis laisse les promesses se régler */
function fakeClock() {
  let time = T0
  let nextId = 1
  const tasks = new Map<number, { due: number, fn: () => void }>()
  return {
    now: () => time,
    schedule: (fn: () => void, delayMs: number) => {
      const id = nextId++
      tasks.set(id, { due: time + delayMs, fn })
      return id
    },
    cancel: (id: number) => {
      tasks.delete(id)
    },
    async advance(ms: number) {
      const target = time + ms
      for (;;) {
        const next = [...tasks.entries()].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        tasks.delete(next[0])
        time = next[1].due
        next[1].fn()
        await flush()
      }
      time = target
      await flush()
    },
  }
}

async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

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
    expect(dispatcher.list().map(npc => npc.id)).toEqual(['ceo', 'cfo', 'release-manager', 'support-n1'])
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

  it('au plus 20 réponses par minute tous PNJ confondus', () => {
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
