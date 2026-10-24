// 019 CA14 à CA17 : rythme de réponse des PNJ (tirage par mode, fiche, frappe, accusé), horloge simulée
import { beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcPersona, NpcResponder } from '../shared/types/npc'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { parsePersona, PersonaParseError } from '../server/npc/persona-parser'
import { delayScaleFromEnv, PACE_RANGES, parsePaceMode, pickAcknowledgement, pickDelayMs } from '../server/npc/pace'
import { createSpontaneousEngine } from '../server/npc/spontaneous'
import { addMessage, addNpcMessage, listMessages, resetChatStore } from '../server/utils/chat-store'
import { fakeClock, loadPersonas, personaById, readPersonaSource } from './npc-helpers'

const CHANNEL = 'incident-en-cours'
const RELEASE = personaById('release-manager')
const CEO = personaById('ceo')

describe('tirage des délais (CA15, CA17)', () => {
  it('instantané : 1 à 2 s, ou délai fixe ; la fiche est ignorée', () => {
    expect(pickDelayMs(RELEASE, { mode: 'instant', random: () => 0 })).toBe(1000)
    expect(pickDelayMs(CEO, { mode: 'instant', random: () => 0.5 })).toBe(1500)
    expect(pickDelayMs(CEO, { mode: 'instant', fixedInstantMs: 200 })).toBe(200)
  })

  it('réaliste : 5 à 40 s ; occupé : 30 s à 3 min', () => {
    const plain = { availability: undefined }
    expect(pickDelayMs(plain, { mode: 'realistic', random: () => 0 })).toBe(5000)
    expect(pickDelayMs(plain, { mode: 'realistic', random: () => 0.999999 })).toBeLessThanOrEqual(40_000)
    expect(pickDelayMs(plain, { mode: 'realistic', random: () => 0.5 })).toBe(22_500)
    expect(pickDelayMs(plain, { mode: 'busy', random: () => 0 })).toBe(30_000)
    expect(pickDelayMs(plain, { mode: 'busy', random: () => 1 })).toBe(180_000)
    expect(PACE_RANGES.realistic).toEqual([5000, 40_000])
  })

  it('NPC_DELAY_SCALE = 0 : aucun délai quel que soit le mode', () => {
    for (const mode of ['instant', 'realistic', 'busy'] as const) {
      expect(pickDelayMs(CEO, { mode, scale: 0, random: () => 0.7 })).toBe(0)
    }
    expect(delayScaleFromEnv('0')).toBe(0)
    expect(delayScaleFromEnv(undefined)).toBe(1)
    expect(delayScaleFromEnv('abc')).toBe(1)
    expect(delayScaleFromEnv('0.5')).toBe(0.5)
  })

  it('surcharge de fiche : rythme (facteur) et délai (plage absolue), sauf en instantané', () => {
    const slow = { availability: { factor: 2 } }
    const range = { availability: { rangeSeconds: [10, 20] as [number, number] } }
    expect(pickDelayMs(slow, { mode: 'realistic', random: () => 0 })).toBe(10_000)
    expect(pickDelayMs(range, { mode: 'busy', random: () => 0 })).toBe(10_000)
    expect(pickDelayMs(range, { mode: 'busy', random: () => 1 })).toBe(20_000)
    expect(pickDelayMs({ availability: { factor: 0.5, rangeSeconds: [10, 20] } }, { mode: 'realistic', random: () => 0 })).toBe(5000)
    expect(pickDelayMs(slow, { mode: 'instant', random: () => 0 })).toBe(1000)
  })

  it('Claire (CEO) est plus lente que Sarah dans la même fiche réelle', () => {
    const sarah = personaById('support-n1')
    const at = (persona: NpcPersona) => pickDelayMs(persona, { mode: 'realistic', random: () => 0.5 })
    expect(at(CEO)).toBeGreaterThan(at(sarah))
    expect(at(RELEASE)).toBe(22_500)
  })

  it('noms de mode français et anglais', () => {
    expect(parsePaceMode('instantané')).toBe('instant')
    expect(parsePaceMode('Réaliste')).toBe('realistic')
    expect(parsePaceMode('occupé')).toBe('busy')
    expect(parsePaceMode('busy')).toBe('busy')
    expect(parsePaceMode('rapide')).toBeUndefined()
    expect(parsePaceMode(undefined)).toBeUndefined()
  })
})

describe('section « ## Disponibilité » (CA15)', () => {
  const base = readPersonaSource('release-manager.md')

  it('les fiches sans section se chargent comme avant', () => {
    expect(parsePersona(base, 'x').availability).toBeUndefined()
    expect(loadPersonas()).toHaveLength(6)
  })

  it('rythme et délai sont lus', () => {
    const persona = parsePersona(`${base}\n## Disponibilité\n- rythme: lent\n- délai: 10-60 s\n`, 'x')
    expect(persona.availability).toEqual({ factor: 2, rangeSeconds: [10, 60] })
    expect(CEO.availability).toEqual({ factor: 2 })
  })

  it('valeur invalide ou puce inconnue : erreur explicite avec la ligne', () => {
    expect(() => parsePersona(`${base}\n## Disponibilité\n- rythme: tortue\n`, 'x')).toThrow(PersonaParseError)
    expect(() => parsePersona(`${base}\n## Disponibilité\n- délai: 60-10 s\n`, 'x')).toThrow(/délai invalide/)
    expect(() => parsePersona(`${base}\n## Disponibilité\n- sieste: oui\n`, 'x')).toThrow(/puce inconnue/)
  })
})

describe('accusé du PNJ occupé (CA16)', () => {
  it('seulement en mode occupé et pour une réponse lointaine', () => {
    expect(pickAcknowledgement('realistic', 100_000, [], { random: () => 0 })).toBeUndefined()
    expect(pickAcknowledgement('instant', 100_000, [])).toBeUndefined()
    expect(pickAcknowledgement('busy', 5000, [])).toBeUndefined()
    expect(pickAcknowledgement('busy', 100_000, [], { scale: 0 })).toBeUndefined()
    const ack = pickAcknowledgement('busy', 100_000, [], { random: () => 0 })!
    expect(ack.atMs).toBe(2000)
    expect(ack.text).not.toBe('')
  })

  it('jamais deux fois la même formule', () => {
    const used: string[] = []
    for (let index = 0; index < 3; index++) {
      const ack = pickAcknowledgement('busy', 100_000, used, { random: () => 0 })!
      expect(used).not.toContain(ack.text)
      used.push(ack.text)
    }
    expect(pickAcknowledgement('busy', 100_000, used)).toBeUndefined()
  })
})

function setup(options: { responder?: NpcResponder, delay?: number, mode?: 'busy' | 'realistic' } = {}) {
  const clock = fakeClock()
  const typing: string[] = []
  const dispatcher = createNpcDispatcher({
    ...clock,
    retriever: createLexicalRetriever(),
    responder: options.responder ?? createKeywordsResponder(),
    personas: loadPersonas(),
    delayMs: () => options.delay ?? 30_000,
    ack: (_persona, delayMs, already) => pickAcknowledgement(options.mode ?? 'busy', delayMs, already, { random: () => 0 }),
    history: message => listMessages(message.channelId),
    onTyping: (persona, _channel, on) => typing.push(`${persona.id}:${on ? 'start' : 'stop'}`),
    publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
  })
  dispatcher.setEnabled(true)
  return { clock, dispatcher, typing }
}

const replies = (): Message[] => listMessages(CHANNEL).filter(message => message.npc !== undefined)
const ask = (text: string): Message => addMessage(CHANNEL, { author: 'Alice', text })

describe('frappe et publication différée (CA14)', () => {
  beforeEach(() => resetChatStore())

  it('frappe tout de suite, réponse après le délai tiré', async () => {
    const { clock, dispatcher, typing } = setup({ mode: 'realistic', delay: 12_000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    expect(typing).toEqual(['release-manager:start'])
    await clock.advance(11_999)
    expect(replies()).toEqual([])
    expect(typing).toEqual(['release-manager:start'])
    await clock.advance(1)
    expect(replies()).toHaveLength(1)
    expect(typing).toEqual(['release-manager:start', 'release-manager:stop'])
  })

  it('le délai court pendant la génération : on n\'attend pas deux fois', async () => {
    let resolve!: (text: string) => void
    const responder: NpcResponder = { respond: () => new Promise<string>((done) => { resolve = done }) }
    const { clock, dispatcher } = setup({ responder, mode: 'realistic', delay: 10_000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    // Génération de 4 s : la réponse part à 10 s, pas à 14 s
    await clock.advance(4000)
    resolve('Voilà.')
    await clock.advance(5999)
    expect(replies()).toEqual([])
    await clock.advance(1)
    expect(replies().map(message => message.text)).toEqual(['Voilà.'])
  })

  it('génération plus longue que le délai : la réponse part dès qu\'elle est prête', async () => {
    let resolve!: (text: string) => void
    const responder: NpcResponder = { respond: () => new Promise<string>((done) => { resolve = done }) }
    const { clock, dispatcher, typing } = setup({ responder, mode: 'realistic', delay: 2000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    await clock.advance(9000)
    expect(replies()).toEqual([])
    expect(typing).toEqual(['release-manager:start'])
    resolve('Enfin.')
    await clock.advance(0)
    expect(replies().map(message => message.text)).toEqual(['Enfin.'])
    expect(typing.at(-1)).toBe('release-manager:stop')
  })

  it('la coupure annule la réponse et termine la frappe', async () => {
    const { clock, dispatcher, typing } = setup({ mode: 'realistic', delay: 12_000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    dispatcher.setEnabled(false)
    await clock.advance(20_000)
    expect(replies()).toEqual([])
    expect(typing).toEqual(['release-manager:start', 'release-manager:stop'])
  })
})

describe('accusé dans le dispatcher (CA16)', () => {
  beforeEach(() => resetChatStore())

  it('occupé : accusé bref, puis la vraie réponse plus tard, jamais deux textes identiques', async () => {
    const { clock, dispatcher, typing } = setup({ delay: 90_000 })
    const question = ask(`@${RELEASE.name} quel déploiement récent ?`)
    dispatcher.handle(question)
    await clock.advance(2000)
    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatchObject({ parentId: question.id })
    expect(replies()[0]!.text).not.toContain('v2.41.0')
    // La frappe est suspendue après l'accusé, puis reprend avant la réponse
    expect(typing).toEqual(['release-manager:start', 'release-manager:stop'])
    await clock.advance(80_000)
    expect(typing).toEqual(['release-manager:start', 'release-manager:stop', 'release-manager:start'])
    await clock.advance(8000)
    expect(replies()).toHaveLength(2)
    expect(replies()[1]!.text).toContain('v2.41.0')
    expect(new Set(replies().map(message => message.text)).size).toBe(2)
    expect(typing.at(-1)).toBe('release-manager:stop')

    // Deuxième sollicitation : une autre formule d'accusé
    dispatcher.handle(ask(`@${RELEASE.name} et le rollback ?`))
    await clock.advance(2000)
    const acks = replies().filter(message => !message.text.includes('v2.4'))
    expect(acks).toHaveLength(2)
    expect(acks[0]!.text).not.toBe(acks[1]!.text)
  })

  it('réaliste : pas d\'accusé', async () => {
    const { clock, dispatcher } = setup({ mode: 'realistic', delay: 30_000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    await clock.advance(29_999)
    expect(replies()).toEqual([])
  })

  it('réponse prête avant l\'accusé : pas d\'accusé inutile', async () => {
    const { clock, dispatcher } = setup({ delay: 1000 })
    dispatcher.handle(ask(`@${RELEASE.name} quel déploiement récent ?`))
    await clock.advance(3000)
    expect(replies()).toHaveLength(1)
    expect(replies()[0]!.text).toContain('v2.41.0')
  })
})

describe('intervention spontanée différée (CA14)', () => {
  beforeEach(() => resetChatStore())

  it('frappe immédiate, publication au délai de la fiche', async () => {
    const clock = fakeClock()
    const typing: boolean[] = []
    const seen: string[] = []
    const engine = createSpontaneousEngine<number>({
      ...clock,
      personas: () => [{ ...CEO, spontaneous: [{ trigger: { type: 'after', minutes: 1 }, text: 'On en est où ?' }] }],
      delayMs: (persona) => { seen.push(persona.id); return 15_000 },
      onTyping: (_p, _c, on) => typing.push(on),
      publish: (persona, channelId, text) => addNpcMessage(channelId, { npc: persona, text }),
      onError: (error) => { throw error },
    })
    engine.start(CHANNEL)
    await clock.advance(60_000)
    expect(typing).toEqual([true])
    await clock.advance(14_999)
    expect(replies()).toEqual([])
    await clock.advance(1)
    expect(replies()).toHaveLength(1)
    expect(seen).toEqual(['ceo'])
    expect(typing).toEqual([true, false])
  })
})
