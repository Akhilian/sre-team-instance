// 024 CA4 : moteur anthropic sur le build, branché sur un faux serveur Anthropic (node:http) ;
// 029 CA2 : faux serveur strict (temperature refusée), réflexion, max_tokens et lastModelCall ; 030 CA4 :
// lastModelCall remis à null par « Tout réinitialiser »
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import type { NpcAdminState } from '../../shared/types/npc'
import { FAKE_CLAUDE_PREFIX, startFakeAnthropic } from '../../scripts/fake-anthropic.mjs'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const RELEASE = 'Julien Moreau'
const API_KEY = 'cle-de-test-024'

let fake: Awaited<ReturnType<typeof startFakeAnthropic>>
let server: TestServer

beforeAll(async () => {
  fake = await startFakeAnthropic()
  server = await startServer({
    FACILITATOR_CODE: 'animateur',
    NPC_ENGINE: 'anthropic',
    ANTHROPIC_API_KEY: API_KEY,
    NPC_ANTHROPIC_BASE_URL: `${fake.baseUrl}/`,
    NPC_LLM_TIMEOUT_MS: '3000',
    NPC_REPLY_DELAY_MS: '200',
  })
})
afterAll(async () => {
  await server?.stop()
  await fake?.stop()
})

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function messages(): Promise<Message[]> {
  return (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
}

async function ask(text: string): Promise<Message> {
  const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text })
  expect(response.status).toBe(201)
  return response.json()
}

async function waitForNpcReply(parentId: string, timeoutMs: number): Promise<Message | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const reply = (await messages()).find(message => message.npc && message.parentId === parentId)
    if (reply || Date.now() > deadline) return reply
    await sleep(100)
  }
}

describe('PNJ anthropic (024)', () => {
  beforeEach(async () => {
    fake.state.status = 200
    fake.state.delayMs = 0
    fake.state.mode = 'text'
    fake.state.requests.length = 0
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  })

  it('/api/health : npcEngine anthropic, sans clé ni modèle', async () => {
    const raw = await (await fetch(`${server.url}/api/health`)).text()
    expect(JSON.parse(raw)).toMatchObject({ npcEngine: 'anthropic' })
    expect(raw).not.toContain(API_KEY)
    expect(raw).not.toContain('claude-haiku')
    expect(raw).not.toContain(String(fake.port))
  })

  it('une mention reçoit le texte du faux serveur en moins de 5 s, avec x-api-key et anthropic-version', async () => {
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply).toMatchObject({ author: RELEASE, npc: { id: 'release-manager' } })
    expect(reply!.text.startsWith(FAKE_CLAUDE_PREFIX)).toBe(true)
    expect(reply!.text).toContain('Je regarde de mon côté.')
    expect(fake.state.requests).toHaveLength(1)
    const received = fake.state.requests[0]!
    expect(received).toMatchObject({ url: '/v1/messages', apiKey: API_KEY, version: '2023-06-01', contentType: 'application/json' })
    expect(received.body).toMatchObject({ model: 'claude-haiku-5-5' })
    expect(typeof received.body.system).toBe('string')
    expect(received.body.system).toContain(RELEASE)
    expect(received.body.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(received.body.messages[0]).toMatchObject({ role: 'user' })
  })

  it('faux serveur en erreur 500 : réponse keywords et ligne de repli, sans la clé dans les journaux', async () => {
    fake.state.status = 500
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply!.text).toContain('v2.41.0')
    expect(reply!.text).not.toContain(FAKE_CLAUDE_PREFIX)
    expect(fake.state.requests).toHaveLength(1)
    const logs = server.stdout() + server.stderr()
    expect(logs).toContain('[npc] anthropic indisponible (HTTP 500) : repli keywords')
    expect(logs).not.toContain(API_KEY)
  })
})

async function adminState(): Promise<NpcAdminState> {
  const response = await fetch(`${server.url}/api/admin/npcs`, { headers: ADMIN })
  expect(response.status).toBe(200)
  return response.json()
}

describe('faux serveur strict et lastModelCall (029 CA2)', () => {
  beforeEach(async () => {
    fake.state.status = 200
    fake.state.delayMs = 0
    fake.state.mode = 'text'
    fake.state.requests.length = 0
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  })

  it('appel direct au faux serveur avec temperature: 0.3 : 400 invalid_request_error', async () => {
    const response = await postJson(`${fake.baseUrl}/v1/messages`, {
      model: 'claude-haiku-5-5',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'user', content: 'Bonjour' }],
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } })
  })

  it('mode thinking : réponse [faux Claude], corps sans temperature, lastModelCall.ok', async () => {
    fake.state.mode = 'thinking'
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply!.text.startsWith(FAKE_CLAUDE_PREFIX)).toBe(true)
    const received = fake.state.requests[0]!.body
    expect(received).toMatchObject({ max_tokens: 1024, output_config: { effort: 'low' } })
    for (const field of ['temperature', 'top_p', 'top_k']) expect(received).not.toHaveProperty(field)
    const { lastModelCall } = await adminState()
    expect(lastModelCall).toMatchObject({ ok: true })
    expect(Number.isNaN(Date.parse(lastModelCall!.at))).toBe(false)
  })

  it('mode max_tokens : réponse keywords, lastModelCall { ok: false, reason }', async () => {
    fake.state.mode = 'max_tokens'
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply!.text).toContain('v2.41.0')
    expect(reply!.text).not.toContain(FAKE_CLAUDE_PREFIX)
    const { lastModelCall } = await adminState()
    expect(lastModelCall).toMatchObject({ ok: false, reason: 'max_tokens sans texte' })
    expect(server.stdout() + server.stderr()).toContain('[npc] anthropic indisponible (max_tokens sans texte) : repli keywords')
  })

  it('030 CA4 : après un appel réussi, reset { scope: all } remet lastModelCall à null', async () => {
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    expect((await waitForNpcReply(root.id, 5000))?.text.startsWith(FAKE_CLAUDE_PREFIX)).toBe(true)
    expect((await adminState()).lastModelCall).toMatchObject({ ok: true })
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await adminState()).lastModelCall).toBeNull()
  })

  it('POST /__mode change le mode à chaud ; mode inconnu : 400', async () => {
    expect((await postJson(`${fake.baseUrl}/__mode`, { mode: 'refusal' })).status).toBe(200)
    expect(fake.state.mode).toBe('refusal')
    expect((await postJson(`${fake.baseUrl}/__mode`, { mode: 'autre' })).status).toBe(400)
    expect(fake.state.mode).toBe('refusal')
  })
})
