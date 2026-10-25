// 041 CA1, CA3, CA4 et métriques des moteurs à modèle : registre, normalisation de route, issues des
// réponses de PNJ, stockage factice en échec
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorage } from 'unstorage'
import {
  createRegistry,
  escapeLabelValue,
  normalizeMethod,
  normalizeRoute,
  statusClass,
} from '../server/utils/metrics'
import { LLM_MODELS_MAX, llmModelLabel, metricsEnabled, recordHttp, registry, resetLlmModels } from '../server/utils/war-room-metrics'
import { createChatPersistence } from '../server/utils/chat-persistence'
import { resetChatStore } from '../server/utils/chat-store'
import { resolveNpcEngine } from '../server/npc/engines'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { addMessage, addNpcMessage, listMessages } from '../server/utils/chat-store'
import type { Message } from '../shared/types/chat'
import type { NpcRequest } from '../shared/types/npc'
import { fakeClock, flush, loadPersonas, personaById } from './npc-helpers'

/** Valeur d'une série dans la sortie texte (ligne exacte avant la valeur) */
function sample(text: string, series: string): number | undefined {
  const line = text.split('\n').find(candidate => candidate.startsWith(`${series} `))
  return line === undefined ? undefined : Number(line.slice(series.length + 1))
}

describe('registre (CA1)', () => {
  it('compteur : séries par labels, cumul, valeurs négatives ignorées', () => {
    const r = createRegistry()
    const c = r.counter('t_total', 'Un compteur.', ['a'])
    c.inc({ a: 'x' })
    c.inc({ a: 'x' }, 2)
    c.inc({ a: 'y' })
    c.inc({ a: 'y' }, -5)
    expect(c.get({ a: 'x' })).toBe(3)
    const text = r.render()
    expect(sample(text, 't_total{a="x"}')).toBe(3)
    expect(sample(text, 't_total{a="y"}')).toBe(1)
  })

  it('jauge : set, et valeur calculée à la lecture', () => {
    const r = createRegistry()
    const g = r.gauge('g', 'Une jauge.')
    g.set(undefined, 4)
    g.set(undefined, 2)
    let live = 7
    r.gauge('live', 'Calculée.', [], () => live)
    live = 9
    const text = r.render()
    expect(sample(text, 'g')).toBe(2)
    expect(sample(text, 'live')).toBe(9)
  })

  it('histogramme : buckets cumulatifs, _sum, _count et +Inf', () => {
    const r = createRegistry()
    const h = r.histogram('h_seconds', 'Un histogramme.', ['r'], [0.1, 1])
    for (const value of [0.05, 0.1, 0.5, 3]) h.observe({ r: 'a' }, value)
    const text = r.render()
    expect(sample(text, 'h_seconds_bucket{r="a",le="0.1"}')).toBe(2)
    expect(sample(text, 'h_seconds_bucket{r="a",le="1"}')).toBe(3)
    expect(sample(text, 'h_seconds_bucket{r="a",le="+Inf"}')).toBe(4)
    expect(sample(text, 'h_seconds_count{r="a"}')).toBe(4)
    expect(sample(text, 'h_seconds_sum{r="a"}')).toBeCloseTo(3.65)
  })

  it('échappement des labels : antislash, guillemet, saut de ligne', () => {
    expect(escapeLabelValue('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd')
    const r = createRegistry()
    r.counter('e_total', 'x', ['v']).inc({ v: 'a"b\nc' })
    expect(r.render()).toContain('e_total{v="a\\"b\\nc"} 1')
  })

  it('sortie : # HELP et # TYPE une seule fois par métrique, terminée par un saut de ligne', () => {
    const r = createRegistry()
    const c = r.counter('one_total', 'Premier.', ['a'])
    c.inc({ a: '1' })
    c.inc({ a: '2' })
    r.histogram('two_seconds', 'Second.', ['a'], [1]).observe({ a: '1' }, 0.5)
    const text = r.render()
    expect(text.endsWith('\n')).toBe(true)
    for (const name of ['one_total', 'two_seconds']) {
      expect(text.match(new RegExp(`^# HELP ${name} `, 'gm'))).toHaveLength(1)
      expect(text.match(new RegExp(`^# TYPE ${name} `, 'gm'))).toHaveLength(1)
    }
    expect(text).toContain('# TYPE one_total counter')
    expect(text).toContain('# TYPE two_seconds histogram')
  })

  it('nombre de séries plafonné, nom déjà pris refusé', () => {
    const r = createRegistry()
    const c = r.counter('cap_total', 'x', ['v'])
    for (let index = 0; index < 500; index++) c.inc({ v: String(index) })
    expect(r.render().split('\n').filter(line => line.startsWith('cap_total{'))).toHaveLength(200)
    expect(() => r.counter('cap_total', 'x')).toThrow()
  })
})

describe('normalisation de route (CA1)', () => {
  it('ids → :id, inconnu → other', () => {
    expect(normalizeRoute('/api/channels/[id]/messages')).toBe('/api/channels/:id/messages')
    expect(normalizeRoute('/api/channels/:id/messages')).toBe('/api/channels/:id/messages')
    expect(normalizeRoute('/api/channels/:channelId/messages/:messageId/reactions')).toBe('/api/channels/:id/messages/:id/reactions')
    expect(normalizeRoute('/api/health')).toBe('/api/health')
    expect(normalizeRoute(undefined)).toBe('other')
    expect(normalizeRoute('/**')).toBe('other')
    expect(normalizeRoute('/api/**')).toBe('other')
    expect(normalizeRoute('/admin')).toBe('other')
    expect(normalizeRoute('/api/x"y')).toBe('other')
  })

  it('méthode et classe de statut bornées', () => {
    expect(normalizeMethod('post')).toBe('POST')
    expect(normalizeMethod('PROPFIND-ABC')).toBe('OTHER')
    expect(statusClass(204)).toBe('2xx')
    expect(statusClass(503)).toBe('5xx')
    expect(statusClass(101)).toBe('other')
  })

  it('recordHttp ne crée aucune série avec un id', () => {
    recordHttp({ method: 'POST', routePattern: '/api/channels/:id/messages', status: 201, seconds: 0.02 })
    const text = registry.render()
    expect(text).toContain('war_room_http_requests_total{method="POST",route="/api/channels/:id/messages",status_class="2xx"}')
  })
})

describe('METRICS_ENABLED', () => {
  it('actif par défaut, coupé par false/0/off', () => {
    expect(metricsEnabled({})).toBe(true)
    expect(metricsEnabled({ METRICS_ENABLED: 'true' })).toBe(true)
    for (const value of ['false', 'FALSE', '0', 'off']) expect(metricsEnabled({ METRICS_ENABLED: value })).toBe(false)
  })
})

describe('stockage (CA4)', () => {
  beforeEach(() => resetChatStore())

  it('échec de lecture : result="error" et storage_up 0 ; retour : storage_up 1', async () => {
    const storage = createStorage()
    let failing = true
    const original = storage.getItem.bind(storage)
    storage.getItem = (async (...args: Parameters<typeof original>) => {
      if (failing) throw new Error('redis down')
      return original(...args)
    }) as typeof storage.getItem
    const persistence = createChatPersistence(storage, { retryMs: 20, logger: { warn: vi.fn(), error: vi.fn() } })
    const before = sample(registry.render(), 'war_room_storage_operations_total{op="read",result="error"}') ?? 0
    await persistence.hydrate()
    let text = registry.render()
    expect(sample(text, 'war_room_storage_operations_total{op="read",result="error"}')).toBe(before + 1)
    expect(sample(text, 'war_room_storage_up')).toBe(0)
    failing = false
    await vi.waitFor(() => expect(sample(registry.render(), 'war_room_storage_up')).toBe(1))
    persistence.stop()
    text = registry.render()
    expect(sample(text, 'war_room_storage_operations_total{op="read",result="ok"}')).toBeGreaterThanOrEqual(1)
    expect(text).toContain('war_room_storage_operation_duration_seconds_count{op="read"}')
  })

  it('échec d\'écriture compté', async () => {
    const storage = createStorage()
    const persistence = createChatPersistence(storage, { logger: { warn: vi.fn(), error: vi.fn() } })
    await persistence.hydrate()
    storage.setItem = (async () => { throw new Error('disque plein') }) as typeof storage.setItem
    await persistence.flush()
    expect(sample(registry.render(), 'war_room_storage_operations_total{op="write",result="error"}')).toBeGreaterThanOrEqual(1)
    expect(sample(registry.render(), 'war_room_storage_up')).toBe(0)
  })
})

// --- Réponses de PNJ -----------------------------------------------------------------------------
const RELEASE = personaById('release-manager')

function message(author: string, text: string, id: string, rev: number, npc?: Message['npc']): Message {
  return { id, channelId: 'incident-en-cours', author, text, createdAt: new Date(0).toISOString(), rev, ...(npc ? { npc } : {}) } as Message
}

async function ask(question: string, history: Message[] = []): Promise<NpcRequest> {
  return { persona: RELEASE, excerpts: await createLexicalRetriever().retrieve(RELEASE, question), history, question }
}

function reply(content: string, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], ...(usage ? { usage } : {}) }), { status: 200 })
}

/** Valeur d'un compteur pour des labels, avant/après une action */
function replies(engine: string, outcome: string): number {
  return sample(registry.render(), `war_room_npc_replies_total{engine="${engine}",outcome="${outcome}"}`) ?? 0
}

describe('issues des réponses de PNJ (CA3)', () => {
  const env = { NPC_ENGINE: 'openai-compatible', NPC_LLM_BASE_URL: 'http://modele.test/v1', NPC_LLM_MODEL: 'm-test', NPC_LLM_API_KEY: 'cle-secrete-041' }
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => reply('Le déploiement v2.41.0.', { prompt_tokens: 120, completion_tokens: 40 }))
    vi.stubGlobal('fetch', fetchMock)
    resetLlmModels()
  })
  afterEach(() => vi.unstubAllGlobals())

  const quiet = { warn: vi.fn() }

  it('ok, repli après erreur HTTP, timeout et rejet anti-répétition', async () => {
    const engine = resolveNpcEngine(env, quiet).responder
    const before = { ok: replies('openai-compatible', 'ok'), fb: replies('openai-compatible', 'fallback'), to: replies('openai-compatible', 'timeout'), rr: replies('openai-compatible', 'rejected_repeat') }

    await engine.respond(await ask('Quel déploiement récent ?'))
    expect(replies('openai-compatible', 'ok')).toBe(before.ok + 1)

    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 503 }))
    await engine.respond(await ask('Quel déploiement récent ?'))
    expect(replies('openai-compatible', 'fallback')).toBe(before.fb + 1)

    fetchMock.mockImplementationOnce(async () => { throw new DOMException('délai', 'TimeoutError') })
    await engine.respond(await ask('Quel déploiement récent ?'))
    expect(replies('openai-compatible', 'timeout')).toBe(before.to + 1)

    const previous = message(RELEASE.name, 'Le déploiement v2.41.0.', 'p1', 1, { id: RELEASE.id, role: RELEASE.role })
    await engine.respond(await ask('Quel déploiement récent ?', [previous]))
    expect(replies('openai-compatible', 'rejected_repeat')).toBe(before.rr + 1)
    // Le rejet n'est pas compté deux fois comme ok
    expect(replies('openai-compatible', 'ok')).toBe(before.ok + 1)
  })

  it('issues, tokens et tailles par engine/model sur war_room_npc_llm_*', async () => {
    const engine = resolveNpcEngine(env, quiet).responder
    const count = (outcome: string) => sample(registry.render(), `war_room_npc_llm_duration_seconds_count{engine="openai-compatible",model="m-test",outcome="${outcome}"}`) ?? 0
    const before = { ok: count('ok'), error: count('error'), timeout: count('timeout'), fallback: count('fallback'), rr: count('rejected_repeat') }
    const tokens = (direction: string) => sample(registry.render(), `war_room_npc_llm_tokens_total{engine="openai-compatible",model="m-test",direction="${direction}"}`) ?? 0
    const tokensBefore = { input: tokens('input'), output: tokens('output') }

    await engine.respond(await ask('Quel déploiement récent ?'))
    expect(tokens('input')).toBe(tokensBefore.input + 120)
    expect(tokens('output')).toBe(tokensBefore.output + 40)
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    await engine.respond(await ask('Quel déploiement récent ?'))
    fetchMock.mockImplementationOnce(async () => { throw new DOMException('délai', 'TimeoutError') })
    await engine.respond(await ask('Quel déploiement récent ?'))
    fetchMock.mockImplementationOnce(async () => reply(''))
    await engine.respond(await ask('Quel déploiement récent ?'))
    const previous = message(RELEASE.name, 'Le déploiement v2.41.0.', 'p1', 1, { id: RELEASE.id, role: RELEASE.role })
    await engine.respond(await ask('Quel déploiement récent ?', [previous]))

    expect(count('ok')).toBe(before.ok + 1)
    expect(count('error')).toBe(before.error + 1)
    expect(count('timeout')).toBe(before.timeout + 1)
    expect(count('fallback')).toBe(before.fallback + 1)
    expect(count('rejected_repeat')).toBe(before.rr + 1)
    const text = registry.render()
    expect(text).toContain('war_room_npc_llm_prompt_chars_count{engine="openai-compatible",model="m-test"}')
    expect(text).toContain('war_room_npc_llm_response_chars_count{engine="openai-compatible",model="m-test"}')
    expect(text).toContain('war_room_npc_llm_effective_tokens_per_second_count{engine="openai-compatible",model="m-test"}')
    // Ni clé, ni URL, ni texte de prompt ou de réponse
    for (const secret of ['cle-secrete-041', 'modele.test', 'v2.41.0', 'Quel déploiement']) expect(text).not.toContain(secret)
  })

  it('sans usage : aucune série de tokens pour ce modèle', async () => {
    const engine = resolveNpcEngine({ ...env, NPC_LLM_MODEL: 'm-sans-usage' }, quiet).responder
    fetchMock.mockImplementation(async () => reply('Le déploiement v2.41.0.'))
    await engine.respond(await ask('Quel déploiement récent ?'))
    const text = registry.render()
    expect(text).not.toContain('war_room_npc_llm_tokens_total{engine="openai-compatible",model="m-sans-usage"')
    expect(text).toContain('war_room_npc_llm_duration_seconds_count{engine="openai-compatible",model="m-sans-usage",outcome="ok"}')
    expect(text).not.toContain('war_room_npc_llm_effective_tokens_per_second_count{engine="openai-compatible",model="m-sans-usage"')
  })

  it('keywords : aucune série war_room_npc_llm_* et une génération rapide', async () => {
    const before = registry.render().split('\n').filter(line => line.startsWith('war_room_npc_llm_') && line.includes('keywords'))
    expect(before).toEqual([])
    const engine = resolveNpcEngine({}, quiet).responder
    await engine.respond(await ask('Quel déploiement récent ?'))
    const after = registry.render().split('\n').filter(line => line.startsWith('war_room_npc_llm_') && line.includes('keywords'))
    expect(after).toEqual([])
    expect(replies('keywords', 'ok')).toBeGreaterThanOrEqual(1)
  })

  it('model : plus de 10 valeurs distinctes → other', () => {
    resetLlmModels()
    for (let index = 0; index < LLM_MODELS_MAX; index++) expect(llmModelLabel(`m${index}`)).toBe(`m${index}`)
    expect(llmModelLabel('m0')).toBe('m0')
    expect(llmModelLabel('m-onze')).toBe('other')
    resetLlmModels()
  })

  it('la génération ne dépend pas du délai de rythme (rythme occupé, moteur instantané)', async () => {
    resetChatStore()
    const clock = fakeClock()
    const engine = resolveNpcEngine({}, quiet).responder
    const generation = () => sample(registry.render(), 'war_room_npc_generation_duration_seconds_sum{engine="keywords"}') ?? 0
    const before = generation()
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever: createLexicalRetriever(),
      responder: engine,
      personas: loadPersonas(),
      delayMs: () => 180_000,
      history: m => listMessages(m.channelId),
      publish: r => addNpcMessage(r.channelId, { npc: r.persona, text: r.text, parentId: r.parentId }),
    })
    dispatcher.setEnabled(true)
    dispatcher.handle(addMessage('incident-en-cours', { author: 'Alice', text: `@${RELEASE.name} quel déploiement récent ?` }))
    await flush()
    await clock.advance(180_000)
    expect(listMessages('incident-en-cours').some(m => m.npc)).toBe(true)
    expect(generation() - before).toBeLessThan(1)
  })
})

describe('dispatcher : issues capped et timeout', () => {
  beforeEach(() => resetChatStore())

  it('plafond atteint → capped ; moteur sans réponse → timeout', async () => {
    const clock = fakeClock()
    const outcomes: string[] = []
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever: createLexicalRetriever(),
      responder: { respond: vi.fn(async () => 'ok') },
      personas: loadPersonas(),
      delayMs: () => 100,
      history: m => listMessages(m.channelId),
      onError: vi.fn(),
      onReplyOutcome: outcome => outcomes.push(outcome),
      publish: r => addNpcMessage(r.channelId, { npc: r.persona, text: r.text, parentId: r.parentId }),
    })
    dispatcher.setEnabled(true)
    for (let index = 1; index <= 7; index++) {
      dispatcher.handle(addMessage('incident-en-cours', { author: 'Alice', text: `@${RELEASE.name} question ${index}` }))
      await clock.advance(200)
    }
    expect(outcomes).toEqual(['capped'])

    const slow = createNpcDispatcher({
      ...clock,
      retriever: createLexicalRetriever(),
      responder: { respond: () => new Promise<string>(() => {}) },
      personas: loadPersonas(),
      delayMs: () => 100,
      respondTimeoutMs: 1000,
      history: m => listMessages(m.channelId),
      onError: vi.fn(),
      onReplyOutcome: outcome => outcomes.push(outcome),
      publish: r => addNpcMessage(r.channelId, { npc: r.persona, text: r.text, parentId: r.parentId }),
    })
    slow.setEnabled(true)
    slow.handle(addMessage('incident-en-cours', { author: 'Bob', text: `@${RELEASE.name} et là ?` }))
    await clock.advance(1500)
    expect(outcomes).toEqual(['capped', 'timeout'])
  })
})
void createKeywordsResponder
