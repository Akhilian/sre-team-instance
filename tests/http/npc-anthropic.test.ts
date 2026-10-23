// 024 CA4 : moteur anthropic sur le build, branché sur un faux serveur Anthropic (node:http)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
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
