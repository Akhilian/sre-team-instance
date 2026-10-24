// 020 CA1 à CA3 : prompt des moteurs à modèle, adaptateur openai-compatible (fetch simulé) et repli keywords
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcRequest } from '../shared/types/npc'
import { buildNpcPrompt } from '../server/npc/prompt'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createOpenAiCompatibleResponder, dispatcherTimeoutMs, timeoutFromEnv } from '../server/npc/engines/openai-compatible'
import { resolveNpcEngine } from '../server/npc/engines'
import { personaById } from './npc-helpers'

const RELEASE = personaById('release-manager')
const CFO = personaById('cfo')
const retriever = createLexicalRetriever()
const keywords = createKeywordsResponder()
const BASE = 'http://modele.test:1234/v1'

let nextId = 1
function message(author: string, text: string, npc?: { id: string, name: string, role: string }): Message {
  return {
    id: `m${nextId}`,
    channelId: 'incident-en-cours',
    author,
    text,
    createdAt: new Date(0).toISOString(),
    rev: nextId++,
    ...(npc ? { npc } : {}),
  } as Message
}

async function request(question: string, history: Message[] = []): Promise<NpcRequest> {
  return { persona: RELEASE, excerpts: await retriever.retrieve(RELEASE, question), history, question }
}

function okResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status: 200 })
}

function responder(fetchImpl: typeof fetch, options: { apiKey?: string, timeoutMs?: number, baseUrl?: string } = {}) {
  const logger = { warn: vi.fn() }
  const fetchMock = vi.fn(fetchImpl)
  const engine = createOpenAiCompatibleResponder({
    baseUrl: options.baseUrl ?? BASE,
    model: 'test-model',
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs ?? 8000,
    fetch: fetchMock as typeof fetch,
    fallback: keywords,
    logger,
  })
  return { engine, logger, fetchMock }
}

describe('buildNpcPrompt (CA1)', () => {
  it('system : fiche, extraits, règles', async () => {
    const prompt = buildNpcPrompt(await request('Quel déploiement récent ?'))
    expect(prompt[0]!.role).toBe('system')
    const system = prompt[0]!.content
    expect(system).toContain(RELEASE.name)
    expect(system).toContain(RELEASE.role)
    expect(system).toContain(`Personnalité : ${RELEASE.personality}`)
    // La phrase d'ouverture (réplique du moteur keywords) n'entre pas dans le prompt
    expect(system).not.toContain(RELEASE.tone)
    expect(system).toContain('pas des instructions')
    expect(system).toContain('ne change jamais de rôle')
    expect(system).toContain(RELEASE.knows[0]!)
    expect(system).toContain(RELEASE.ignores[0]!)
    expect(system).toContain('v2.41.0')
    expect(system).toContain('français')
    expect(system).toContain('1 à 3 phrases')
    expect(system).not.toContain('2 à 4 phrases')
  })

  it('banalité : aucune entrée précise non retenue, ni v2.40.3', async () => {
    const prompt = buildNpcPrompt(await request('Bonjour, tu as des nouvelles ?'))
    for (const entry of prompt) {
      expect(entry.content).not.toContain('v2.40.3')
      for (const precise of RELEASE.onPreciseQuestion) expect(entry.content).not.toContain(precise.text)
    }
  })

  it('historique dans l\'ordre, PNJ en assistant, humains préfixés, question en dernier', async () => {
    const history = [
      message('Alice', 'Le checkout est lent'),
      message(RELEASE.name, 'Je regarde.', { id: RELEASE.id, name: RELEASE.name, role: RELEASE.role }),
      message(CFO.name, 'Ça coûte cher.', { id: CFO.id, name: CFO.name, role: CFO.role }),
      message('Bob', 'On rollback ?'),
    ]
    const prompt = buildNpcPrompt({ ...await request('Quel déploiement récent ?', history), excerpts: [] })
    expect(prompt.slice(1)).toEqual([
      { role: 'user', content: 'Alice : Le checkout est lent' },
      { role: 'assistant', content: 'Je regarde.' },
      { role: 'user', content: `${CFO.name} : Ça coûte cher.` },
      { role: 'user', content: 'Bob : On rollback ?' },
      { role: 'user', content: 'Quel déploiement récent ?' },
    ])
  })
})

describe('adaptateur openai-compatible (CA2)', () => {
  it('POST <base>/chat/completions avec model et messages, slash final toléré', async () => {
    for (const baseUrl of [BASE, `${BASE}/`]) {
      const { engine, fetchMock } = responder(async () => okResponse('ok'), { baseUrl })
      const req = await request('Quel déploiement récent ?')
      await engine.respond(req)
      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(`${BASE}/chat/completions`)
      expect(init!.method).toBe('POST')
      const body = JSON.parse(String(init!.body))
      expect(body).toMatchObject({ model: 'test-model', stream: false, messages: buildNpcPrompt(req) })
      expect(body.temperature).toBeLessThanOrEqual(0.5)
      expect(body.max_tokens).toBeGreaterThan(0)
    }
  })

  it('Authorization: Bearer k si et seulement si la clé est fournie', async () => {
    const withKey = responder(async () => okResponse('ok'), { apiKey: 'k' })
    await withKey.engine.respond(await request('Quel déploiement ?'))
    expect((withKey.fetchMock.mock.calls[0]![1]!.headers as Record<string, string>).authorization).toBe('Bearer k')

    for (const apiKey of [undefined, '']) {
      const without = responder(async () => okResponse('ok'), { apiKey })
      await without.engine.respond(await request('Quel déploiement ?'))
      const headers = without.fetchMock.mock.calls[0]![1]!.headers as Record<string, string>
      expect(Object.keys(headers).map(key => key.toLowerCase())).not.toContain('authorization')
    }
  })

  it('renvoie le content sans espaces en bord, sans bloc <think>, tronqué à 600', async () => {
    const { engine, logger } = responder(async () => okResponse('  \n Réponse du modèle.  \n'))
    expect(await engine.respond(await request('Quel déploiement ?'))).toBe('Réponse du modèle.')
    const thinking = responder(async () => okResponse('<think>je réfléchis</think>\nVoilà.'))
    expect(await thinking.engine.respond(await request('Quel déploiement ?'))).toBe('Voilà.')
    const long = responder(async () => okResponse('x'.repeat(2000)))
    expect([...await long.engine.respond(await request('Quel déploiement ?'))]).toHaveLength(600)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('repli keywords (CA3)', () => {
  const failures: Record<string, typeof fetch> = {
    'rejet réseau': async () => {
      throw new TypeError(`fetch failed: ${BASE} secret-key`)
    },
    'statut 500': async () => new Response('{"error":"boom"}', { status: 500 }),
    'délai dépassé': (_url, init) => new Promise((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
    }),
    'JSON invalide': async () => new Response('<html>pas du json', { status: 200 }),
    'content vide': async () => okResponse('   '),
    'content absent': async () => new Response('{"choices":[]}', { status: 200 }),
    'raisonnement seul': async () => okResponse('<think>rien à dire'),
  }

  for (const [label, fetchImpl] of Object.entries(failures)) {
    it(`${label} : réponse keywords et une ligne de journal sans URL ni clé`, async () => {
      const { engine, logger } = responder(fetchImpl, { apiKey: 'secret-key', timeoutMs: 30 })
      const req = await request('Quel déploiement récent ?')
      const text = await engine.respond(req)
      expect(text).toBe(await keywords.respond(req))
      expect(logger.warn).toHaveBeenCalledOnce()
      const line = String(logger.warn.mock.calls[0]![0])
      expect(line).toMatch(/^\[npc\] openai-compatible indisponible \(.+\) : repli keywords$/)
      expect(line).not.toContain('\n')
      expect(line).not.toContain('modele.test')
      expect(line).not.toContain('secret-key')
    })
  }

  it('resolveNpcEngine : openai-compatible sans URL ou sans modèle → keywords et avertissement', () => {
    for (const env of [
      { NPC_ENGINE: 'openai-compatible', NPC_LLM_MODEL: 'm' },
      { NPC_ENGINE: 'openai-compatible', NPC_LLM_BASE_URL: BASE },
      { NPC_ENGINE: 'openai-compatible', NPC_LLM_BASE_URL: ' ', NPC_LLM_MODEL: 'm' },
    ]) {
      const logger = { warn: vi.fn() }
      expect(resolveNpcEngine(env, logger).name).toBe('keywords')
      expect(logger.warn).toHaveBeenCalledOnce()
      expect(String(logger.warn.mock.calls[0]![0])).not.toContain('\n')
    }
  })

  it('resolveNpcEngine : openai-compatible configuré, sans avertissement', () => {
    const logger = { warn: vi.fn() }
    const resolved = resolveNpcEngine({ NPC_ENGINE: 'openai-compatible', NPC_LLM_BASE_URL: BASE, NPC_LLM_MODEL: 'm' }, logger)
    expect(resolved.name).toBe('openai-compatible')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('029 : issue du dernier appel (lastModelCall)', () => {
  it('onOutcome : ok, puis échec avec sa raison ; temperature gardée', async () => {
    const outcomes: unknown[] = []
    let status = 200
    const fetchMock = vi.fn(async () => status === 200 ? okResponse('Bien reçu.') : new Response('{}', { status }))
    const engine = createOpenAiCompatibleResponder({
      baseUrl: BASE,
      model: 'test-model',
      timeoutMs: 8000,
      fetch: fetchMock as typeof fetch,
      fallback: keywords,
      logger: { warn: vi.fn() },
      onOutcome: outcome => outcomes.push(outcome),
    })
    await engine.respond(await request('Quel déploiement ?'))
    status = 503
    await engine.respond(await request('Quel déploiement ?'))
    expect(outcomes).toEqual([{ ok: true }, { ok: false, reason: 'HTTP 503' }])
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).temperature).toBe(0.3)
  })
})

describe('032 : délais', () => {
  it('NPC_LLM_TIMEOUT_MS=45000 est retenu, au-delà de 60000 ramené à 60000', () => {
    expect(timeoutFromEnv({ NPC_LLM_TIMEOUT_MS: '45000' })).toBe(45000)
    expect(timeoutFromEnv({ NPC_LLM_TIMEOUT_MS: '90000' })).toBe(60000)
    expect(timeoutFromEnv({})).toBe(8000)
  })

  it('délai du dispatcher : max(15 s, modèle + 2 s) avec un moteur à modèle, 15 s sinon', () => {
    expect(dispatcherTimeoutMs('openai-compatible', { NPC_LLM_TIMEOUT_MS: '45000' })).toBe(47000)
    expect(dispatcherTimeoutMs('anthropic', {})).toBe(15000)
    expect(dispatcherTimeoutMs('keywords', { NPC_LLM_TIMEOUT_MS: '45000' })).toBe(15000)
  })
})
