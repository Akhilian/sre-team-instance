// 035 CA3 à CA5 : interventions spontanées (moteur pur, horloge simulée, vrai store)
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcPersona, NpcSpontaneousRule } from '../shared/types/npc'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createOpenAiCompatibleResponder } from '../server/npc/engines/openai-compatible'
import { createSpontaneousEngine, isStatusRequest, matchesKeywords, type SpontaneousDeps } from '../server/npc/spontaneous'
import { addAlert, addAnnouncement, addDirectChannel, addMessage, addNpcMessage, listMessages, resetChatStore } from '../server/utils/chat-store'
import { fakeClock, personaById } from './npc-helpers'

const CHANNEL = 'incident-en-cours'
const MINUTE = 60_000
const CFO = personaById('cfo')
const CEO = personaById('ceo')
const PSP = personaById('psp')

const keywords = (...words: string[]): NpcSpontaneousRule['trigger'] => ({ type: 'keywords', words })
const after = (minutes: number): NpcSpontaneousRule['trigger'] => ({ type: 'after', minutes })
const noStatus = (minutes: number): NpcSpontaneousRule['trigger'] => ({ type: 'no-status', minutes })

function withRules(persona: NpcPersona, ...rules: [NpcSpontaneousRule['trigger'], string][]): NpcPersona {
  return { ...persona, spontaneous: rules.map(([trigger, text]) => ({ trigger, text })) }
}

function setup(personas: NpcPersona[], overrides: Partial<SpontaneousDeps<number>> = {}) {
  const clock = fakeClock()
  const state = { active: personas }
  const engine = createSpontaneousEngine<number>({
    ...clock,
    personas: () => state.active,
    publish: (persona, channelId, text) => addNpcMessage(channelId, { npc: persona, text }),
    onError: (error) => { throw error },
    ...overrides,
  })
  const published = () => listMessages(CHANNEL).filter(message => message.npc !== undefined)
  return { clock, engine, state, published }
}

function human(text: string, extra: Partial<Parameters<typeof addMessage>[1]> = {}, channelId = CHANNEL): Message {
  return addMessage(channelId, { author: 'Alice', text, ...extra })
}

describe('règles `mots` (CA3)', () => {
  beforeEach(() => resetChatStore())

  it('se déclenche sur un message humain du canal d\'incident, publié en message racine signé du PNJ', async () => {
    const { clock, engine, published } = setup([withRules(CFO, [keywords('newsletter', 'black friday'), 'Ça nous coûte combien ?'])])
    engine.start(CHANNEL)
    engine.onMessage(human('On a un souci avec la newsletter du Black Friday'))
    await clock.advance(0)
    expect(published()).toHaveLength(1)
    expect(published()[0]).toMatchObject({ author: CFO.name, text: 'Ça nous coûte combien ?', npc: { id: 'cfo' }, channelId: CHANNEL })
    expect(published()[0]!.parentId).toBeUndefined()
  })

  it('même normalisation que le retriever : accents, pluriel, expression', async () => {
    expect(matchesKeywords('Les CLIENTS sont bloqués', ['client'])).toBe(true)
    expect(matchesKeywords('un black   friday de plus', ['black friday'])).toBe(true)
    expect(matchesKeywords('une campagne', ['newsletter'])).toBe(false)
    expect(matchesKeywords('le paiement', ['paiement'])).toBe(true)
    expect(matchesKeywords('Mise à jour du statut', ['mise a jour'])).toBe(true)
  })

  it('ni message de PNJ, ni alerte, ni annonce, ni conversation directe, ni message qui mentionne ce PNJ', async () => {
    const { clock, engine, published } = setup([withRules(CFO, [keywords('newsletter'), 'texte'])])
    engine.start(CHANNEL)
    const dm = addDirectChannel({ participant: 'Alice', npc: PSP }).channel
    engine.onMessage(addNpcMessage(CHANNEL, { npc: PSP, text: 'la newsletter' }))
    engine.onMessage(addAlert(CHANNEL, { severity: 'SEV2', title: 'newsletter', service: 'x', text: 'newsletter' }))
    engine.onMessage(addAnnouncement(CHANNEL, { text: 'la newsletter' }))
    engine.onMessage(human('la newsletter', {}, dm.id))
    engine.onMessage(human('la newsletter', {}, 'general'))
    engine.onMessage(human(`@${CFO.name} la newsletter ?`))
    engine.onMessage(human('Marc, la newsletter ?'))
    await clock.advance(0)
    expect(published().filter(message => message.text === 'texte')).toEqual([])

    // Un message qui mentionne un autre PNJ ne bloque pas la règle
    engine.onMessage(human(`@${PSP.name} la newsletter ?`))
    await clock.advance(0)
    expect(published().filter(message => message.text === 'texte')).toHaveLength(1)
  })

  it('une règle bloquée par les délais reste en attente et part à l\'échéance', async () => {
    const { clock, engine, published } = setup([withRules(CFO, [after(1), 'premier'], [keywords('newsletter'), 'second'])])
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(published().map(message => message.text)).toEqual(['premier'])
    engine.onMessage(human('la newsletter'))
    await clock.advance(0)
    expect(published()).toHaveLength(1)
    await clock.advance(4 * MINUTE - 15_000)
    expect(published()).toHaveLength(1)
    await clock.advance(15_000)
    expect(published().map(message => message.text)).toEqual(['premier', 'second'])
  })
})

describe('règles `après` et `sans point` (CA3)', () => {
  beforeEach(() => resetChatStore())

  it('`après` se déclenche au tic qui suit l\'échéance', async () => {
    const { clock, engine, published } = setup([withRules(CEO, [after(8), 'Alors ?'])])
    engine.start(CHANNEL)
    await clock.advance(8 * MINUTE - 1)
    expect(published()).toEqual([])
    await clock.advance(1)
    expect(published().map(message => message.text)).toEqual(['Alors ?'])
  })

  it('`sans point` : 6 min sans point, repoussé par un message « point de situation »', async () => {
    const { clock, engine, published } = setup([withRules(CEO, [noStatus(6), 'J\'attends un point.'])])
    engine.start(CHANNEL)
    await clock.advance(5 * MINUTE)
    engine.onMessage(human('Petit point de situation : on regarde le pool'))
    await clock.advance(5 * MINUTE + 45_000)
    expect(published()).toEqual([])
    await clock.advance(15_000)
    expect(published().map(message => message.text)).toEqual(['J\'attends un point.'])
  })

  it('`sans point` : sans aucun point, 6 min après le lancement ; un message humain ordinaire ne compte pas', async () => {
    const { clock, engine, published } = setup([withRules(CEO, [noStatus(6), 'J\'attends un point.'])])
    engine.start(CHANNEL)
    await clock.advance(3 * MINUTE)
    engine.onMessage(human('on regarde'))
    await clock.advance(3 * MINUTE)
    expect(published()).toHaveLength(1)
  })

  it('isStatusRequest : mots entiers', () => {
    for (const text of ['un point ?', 'statut ?', 'status update', 'ETA ?', 'la situation', 'mise à jour svp']) expect(isStatusRequest(text)).toBe(true)
    for (const text of ['pointe du doigt', 'le checkout', 'on se met à jour demain'.replace('à jour', 'au jour')]) expect(isStatusRequest(text)).toBe(false)
  })

  it('une règle ne se déclenche qu\'une fois par lancement ; un nouveau lancement la réarme', async () => {
    const { clock, engine, published } = setup([withRules(CEO, [after(1), 'Alors ?'])])
    engine.start(CHANNEL)
    await clock.advance(20 * MINUTE)
    expect(published()).toHaveLength(1)
    engine.start(CHANNEL)
    await clock.advance(2 * MINUTE)
    expect(published()).toHaveLength(2)
  })
})

describe('garde-fous (CA4)', () => {
  beforeEach(() => resetChatStore())

  it('deux règles d\'un même PNJ à 1 min d\'écart : une publication, la seconde 4 min après la première', async () => {
    const { clock, engine, published } = setup([withRules(CFO, [after(1), 'A'], [after(2), 'B'])])
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(published().map(message => message.text)).toEqual(['A'])
    await clock.advance(4 * MINUTE - 1)
    expect(published().map(message => message.text)).toEqual(['A'])
    await clock.advance(1)
    expect(published().map(message => message.text)).toEqual(['A', 'B'])
  })

  it('trois PNJ déclenchés dans la même minute : deux publications cette minute-là, la troisième une minute après', async () => {
    const { clock, engine, published } = setup([
      withRules(CFO, [after(1), 'cfo']),
      withRules(CEO, [after(1), 'ceo']),
      withRules(PSP, [after(1), 'psp']),
    ])
    engine.start(CHANNEL)
    await clock.advance(MINUTE + 45_000)
    expect(published().map(message => message.text)).toEqual(['cfo', 'ceo'])
    await clock.advance(15_000)
    expect(published().map(message => message.text)).toEqual(['cfo', 'ceo', 'psp'])
  })

  it('PNJ coupés, interrupteur coupé ou scénario arrêté : aucune publication', async () => {
    const off = setup([withRules(CFO, [after(1), 'x'])])
    off.engine.start(CHANNEL)
    off.state.active = []
    await off.clock.advance(3 * MINUTE)
    expect(off.published()).toEqual([])
    resetChatStore()

    const switched = setup([withRules(CFO, [after(1), 'x'])])
    switched.engine.setEnabled(false)
    switched.engine.start(CHANNEL)
    await switched.clock.advance(3 * MINUTE)
    expect(switched.published()).toEqual([])
    // Réactivé : la règle échue part au tic suivant
    switched.engine.setEnabled(true)
    await switched.clock.advance(15_000)
    expect(switched.published()).toHaveLength(1)
    resetChatStore()

    const stopped = setup([withRules(CFO, [after(1), 'x'])])
    stopped.engine.start(CHANNEL)
    await stopped.clock.advance(30_000)
    stopped.engine.stop()
    expect(stopped.engine.isRunning()).toBe(false)
    await stopped.clock.advance(10 * MINUTE)
    stopped.engine.onMessage(human('texte'))
    expect(stopped.published()).toEqual([])
  })

  it('arrêt ou coupure pendant la formulation : rien n\'est publié, la frappe est terminée', async () => {
    const typing: boolean[] = []
    let release: (text: string) => void = () => {}
    const { clock, engine, published } = setup([withRules(CFO, [after(1), 'base'])], {
      formulate: () => new Promise<string>((resolve) => { release = resolve }),
      onTyping: (_persona, _channel, on) => typing.push(on),
    })
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(typing).toEqual([true])
    engine.stop()
    release('reformulé')
    await clock.advance(0)
    expect(published()).toEqual([])
    expect(typing).toEqual([true, false])
  })

  it('plafond global d\'appels au modèle : la règle attend', async () => {
    let allowed = false
    const { clock, engine, published } = setup([withRules(CFO, [after(1), 'x'])], { takeSlot: () => allowed })
    engine.start(CHANNEL)
    await clock.advance(2 * MINUTE)
    expect(published()).toEqual([])
    allowed = true
    await clock.advance(15_000)
    expect(published()).toHaveLength(1)
  })

  it('délai simulé : la frappe précède la publication', async () => {
    const typing: boolean[] = []
    const { clock, engine, published } = setup([withRules(CFO, [after(1), 'x'])], { delayMs: () => 1500, onTyping: (_p, _c, on) => typing.push(on) })
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(typing).toEqual([true])
    expect(published()).toEqual([])
    await clock.advance(1500)
    expect(published()).toHaveLength(1)
    expect(typing).toEqual([true, false])
  })
})

describe('formulation (CA5)', () => {
  beforeEach(() => resetChatStore())
  const rule: [NpcSpontaneousRule['trigger'], string] = [after(1), 'On en est où ?']

  it('keywords : le texte de base, tel quel', async () => {
    const keywordsEngine = createKeywordsResponder()
    const { clock, engine, published } = setup([withRules(CFO, rule)], {
      formulate: (persona, base) => keywordsEngine.respond({ persona, excerpts: [], history: [], question: '', spontaneous: { base } }),
    })
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(published().map(message => message.text)).toEqual(['On en est où ?'])
  })

  it('moteur simulé : sa reformulation ; son prompt contient le texte de base et aucun extrait précis', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'On en est où, au juste ?' } }] }), { status: 200 }))
    const model = createOpenAiCompatibleResponder({
      baseUrl: 'http://modele.test/v1',
      model: 'm',
      timeoutMs: 1000,
      fetch: fetchMock as unknown as typeof fetch,
      fallback: createKeywordsResponder(),
      logger: { warn: vi.fn() },
    })
    const { clock, engine, published } = setup([withRules(CFO, rule)], {
      formulate: (persona, base) => model.respond({ persona, excerpts: [], history: [], question: '', spontaneous: { base } }),
    })
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(published().map(message => message.text)).toEqual(['On en est où, au juste ?'])
    const sent = JSON.stringify(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).messages)
    expect(sent).toContain('On en est où ?')
    for (const entry of CFO.onPreciseQuestion) expect(sent).not.toContain(entry.text)
  })

  it('moteur en erreur, délai dépassé ou texte vide : texte de base', async () => {
    for (const formulate of [
      () => Promise.reject(new Error('panne')),
      () => new Promise<string>(() => {}),
      () => Promise.resolve('   '),
    ]) {
      resetChatStore()
      const { clock, engine, published } = setup([withRules(CFO, rule)], { formulate, formulateTimeoutMs: 5000 })
      engine.start(CHANNEL)
      await clock.advance(MINUTE + 5000)
      expect(published().map(message => message.text)).toEqual(['On en est où ?'])
    }
  })

  it('moteur à modèle réduit à une excuse : texte de base (repli keywords de l\'adaptateur)', async () => {
    const model = createOpenAiCompatibleResponder({
      baseUrl: 'http://modele.test/v1',
      model: 'm',
      timeoutMs: 1000,
      fetch: (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Je suis désolé pour les perturbations.' } }] }), { status: 200 })) as typeof fetch,
      fallback: createKeywordsResponder(),
      logger: { warn: vi.fn() },
    })
    const { clock, engine, published } = setup([withRules(CFO, rule)], {
      formulate: (persona, base) => model.respond({ persona, excerpts: [], history: [], question: '', spontaneous: { base } }),
    })
    engine.start(CHANNEL)
    await clock.advance(MINUTE)
    expect(published().map(message => message.text)).toEqual(['On en est où ?'])
  })
})
