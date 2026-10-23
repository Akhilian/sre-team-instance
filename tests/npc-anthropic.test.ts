// 024 CA1 à CA3 : conversion du prompt au format Anthropic, adaptateur anthropic (fetch simulé) et repli keywords
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcRequest } from '../shared/types/npc'
import { buildNpcPrompt, type NpcPromptMessage } from '../server/npc/prompt'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { anthropicFromEnv, createAnthropicResponder, toAnthropicMessages } from '../server/npc/engines/anthropic'
import { resolveNpcEngine } from '../server/npc/engines'
import { personaById } from './npc-helpers'

const RELEASE = personaById('release-manager')
const retriever = createLexicalRetriever()
const keywords = createKeywordsResponder()
const API_KEY = 'cle-de-test-024'

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

const fromRelease = (text: string) => message(RELEASE.name, text, { id: RELEASE.id, name: RELEASE.name, role: RELEASE.role })

async function request(question: string, history: Message[] = []): Promise<NpcRequest> {
  return { persona: RELEASE, excerpts: await retriever.retrieve(RELEASE, question), history, question }
}

function okResponse(content: unknown): Response {
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', content }), { status: 200 })
}

function expectAlternating(messages: { role: string }[]) {
  expect(messages[0]!.role).toBe('user')
  expect(messages.at(-1)!.role).toBe('user')
  for (let index = 1; index < messages.length; index++) expect(messages[index]!.role).not.toBe(messages[index - 1]!.role)
  for (const entry of messages) expect(entry.role).not.toBe('system')
}

function responder(fetchImpl: typeof fetch, options: { timeoutMs?: number } = {}) {
  const logger = { warn: vi.fn() }
  const fetchMock = vi.fn(fetchImpl)
  const engine = createAnthropicResponder({
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    apiKey: API_KEY,
    timeoutMs: options.timeoutMs ?? 8000,
    fetch: fetchMock as typeof fetch,
    fallback: keywords,
    logger,
  })
  return { engine, logger, fetchMock }
}

describe('toAnthropicMessages (CA1)', () => {
  it('user, user, assistant, assistant, user puis la question : alternance stricte, ordre gardé', () => {
    const prompt: NpcPromptMessage[] = [
      { role: 'system', content: 'fiche' },
      { role: 'user', content: 'Alice : u1' },
      { role: 'user', content: 'Bob : u2' },
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'Alice : u3' },
      { role: 'user', content: 'la question' },
    ]
    const { system, messages } = toAnthropicMessages(prompt)
    expect(system).toBe('fiche')
    expectAlternating(messages)
    expect(messages).toEqual([
      { role: 'user', content: 'Alice : u1\n\nBob : u2' },
      { role: 'assistant', content: 'a1\n\na2' },
      { role: 'user', content: 'Alice : u3\n\nla question' },
    ])
    expect(messages.at(-1)!.content.endsWith('la question')).toBe(true)
    // Entrée intacte (fonction pure)
    expect(prompt).toHaveLength(7)
    expect(prompt[1]).toEqual({ role: 'user', content: 'Alice : u1' })
  })

  it('historique qui commence par le PNJ : précédé d\'un message user', async () => {
    const req = await request('Quel déploiement récent ?', [fromRelease('Je regarde.'), message('Alice', 'Merci')])
    const { system, messages } = toAnthropicMessages(buildNpcPrompt(req))
    expect(system).toContain(RELEASE.name)
    expect(messages[0]).toEqual({ role: 'user', content: '(Début de la conversation)' })
    expect(messages[1]).toEqual({ role: 'assistant', content: 'Je regarde.' })
    expect(messages[2]).toEqual({ role: 'user', content: 'Alice : Merci\n\nQuel déploiement récent ?' })
    expectAlternating(messages)
  })

  it('sans historique : un seul message user, la question', async () => {
    const { messages } = toAnthropicMessages(buildNpcPrompt(await request('Quel déploiement récent ?')))
    expect(messages).toEqual([{ role: 'user', content: 'Quel déploiement récent ?' }])
  })
})

describe('adaptateur anthropic (CA2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST /v1/messages : URL par défaut ou NPC_ANTHROPIC_BASE_URL (slash final toléré), modèle par défaut ou NPC_ANTHROPIC_MODEL', async () => {
    const cases: { env: Record<string, string>, url: string, model: string }[] = [
      { env: {}, url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5' },
      { env: { NPC_ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999' }, url: 'http://127.0.0.1:9999/v1/messages', model: 'claude-haiku-5-5' },
      { env: { NPC_ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999/', NPC_ANTHROPIC_MODEL: 'claude-autre' }, url: 'http://127.0.0.1:9999/v1/messages', model: 'claude-autre' },
    ]
    for (const { env, url, model } of cases) {
      const fetchMock = vi.fn(async () => okResponse([{ type: 'text', text: 'ok' }]))
      vi.stubGlobal('fetch', fetchMock)
      const engine = anthropicFromEnv({ ANTHROPIC_API_KEY: API_KEY, ...env }, { warn: vi.fn() })
      expect(await engine.respond(await request('Quel déploiement récent ?'))).toBe('ok')
      expect(fetchMock).toHaveBeenCalledOnce()
      const [calledUrl, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
      expect(calledUrl).toBe(url)
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body)).model).toBe(model)
    }
  })

  it('exactement les trois en-têtes, corps model / max_tokens / system / messages', async () => {
    const { engine, fetchMock } = responder(async () => okResponse([{ type: 'text', text: 'ok' }]))
    const req = await request('Quel déploiement récent ?', [message('Alice', 'Le checkout est lent'), message('Bob', 'On rollback ?')])
    await engine.respond(req)
    const init = fetchMock.mock.calls[0]![1]!
    expect(init.headers).toEqual({
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.max_tokens).toBeLessThanOrEqual(300)
    expect(body.temperature).toBeLessThanOrEqual(0.5)
    expect(typeof body.system).toBe('string')
    expect(body.system).toContain(RELEASE.name)
    expect(body.system).toBe(buildNpcPrompt(req)[0]!.content)
    expectAlternating(body.messages)
    expect(body.messages).toEqual(toAnthropicMessages(buildNpcPrompt(req)).messages)
  })

  it('concatène les blocs text, ignore les autres, rogne et tronque à 600', async () => {
    const { engine, logger } = responder(async () => okResponse([
      { type: 'text', text: ' A ' },
      { type: 'tool_use', id: 't1', name: 'outil', input: {} },
      { type: 'text', text: 'B' },
    ]))
    const text = await engine.respond(await request('Quel déploiement ?'))
    expect(text).toContain('A')
    expect(text).toContain('B')
    expect(text).toBe(text.trim())
    expect(text).not.toContain('outil')
    const long = responder(async () => okResponse([{ type: 'text', text: 'x'.repeat(2000) }]))
    expect([...await long.engine.respond(await request('Quel déploiement ?'))]).toHaveLength(600)
    expect(logger.warn).not.toHaveBeenCalled()
  })
})

describe('repli keywords (CA3)', () => {
  const failures: Record<string, typeof fetch> = {
    'rejet réseau': async () => {
      throw new TypeError(`fetch failed: https://api.anthropic.com ${API_KEY}`)
    },
    'statut 401': async () => new Response(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${API_KEY}"}}`, { status: 401 }),
    'statut 529': async () => new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }),
    'délai dépassé': (_url, init) => new Promise((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
    }),
    'JSON invalide': async () => new Response('<html>pas du json', { status: 200 }),
    'content vide': async () => okResponse([]),
    'content sans bloc text': async () => okResponse([{ type: 'tool_use', id: 't1', name: 'outil', input: {} }]),
    'texte blanc': async () => okResponse([{ type: 'text', text: '   ' }]),
    'content absent': async () => new Response('{"type":"message"}', { status: 200 }),
  }

  for (const [label, fetchImpl] of Object.entries(failures)) {
    it(`${label} : réponse keywords et une ligne de journal sans clé`, async () => {
      const { engine, logger } = responder(fetchImpl, { timeoutMs: 30 })
      const req = await request('Quel déploiement récent ?')
      const text = await engine.respond(req)
      expect(text).toBe(await keywords.respond(req))
      expect(logger.warn).toHaveBeenCalledOnce()
      const line = String(logger.warn.mock.calls[0]![0])
      expect(line).toMatch(/^\[npc\] anthropic indisponible \(.+\) : repli keywords$/)
      expect(line).not.toContain('\n')
      expect(line).not.toContain(API_KEY)
      expect(line).not.toContain('anthropic.com')
      expect(line).not.toContain('error')
    })
  }

  it('resolveNpcEngine : anthropic sans clé ou clé vide → keywords et avertissement nommant ANTHROPIC_API_KEY', () => {
    for (const env of [{ NPC_ENGINE: 'anthropic' }, { NPC_ENGINE: 'anthropic', ANTHROPIC_API_KEY: '' }, { NPC_ENGINE: 'anthropic', ANTHROPIC_API_KEY: '  ' }]) {
      const logger = { warn: vi.fn() }
      expect(resolveNpcEngine(env, logger).name).toBe('keywords')
      expect(logger.warn).toHaveBeenCalledOnce()
      const line = String(logger.warn.mock.calls[0]![0])
      expect(line).toContain('ANTHROPIC_API_KEY')
      expect(line).not.toContain('\n')
    }
  })

  it('resolveNpcEngine : anthropic avec clé, sans avertissement', () => {
    const logger = { warn: vi.fn() }
    expect(resolveNpcEngine({ NPC_ENGINE: 'anthropic', ANTHROPIC_API_KEY: API_KEY }, logger).name).toBe('anthropic')
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
