// 020 CA5 : moteur openai-compatible sur le build, branché sur un faux serveur OpenAI-compatible (node:http)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import { FAKE_MODEL_PREFIX, startFakeOpenAi } from '../../scripts/fake-openai.mjs'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const RELEASE = 'Julien Moreau'
const API_KEY = 'cle-de-test-020'

let fake: Awaited<ReturnType<typeof startFakeOpenAi>>
let server: TestServer

beforeAll(async () => {
  fake = await startFakeOpenAi()
  server = await startServer({
    FACILITATOR_CODE: 'animateur',
    NPC_ENGINE: 'openai-compatible',
    NPC_LLM_BASE_URL: `${fake.baseUrl}/`,
    NPC_LLM_MODEL: 'faux-modele',
    NPC_LLM_API_KEY: API_KEY,
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

describe('PNJ openai-compatible (020)', () => {
  beforeEach(async () => {
    fake.state.status = 200
    fake.state.delayMs = 0
    fake.state.requests.length = 0
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  })

  it('/api/health : npcEngine openai-compatible, ni URL ni clé', async () => {
    const response = await fetch(`${server.url}/api/health`)
    const raw = await response.text()
    expect(JSON.parse(raw)).toMatchObject({ npcEngine: 'openai-compatible' })
    expect(raw).not.toContain(String(fake.port))
    expect(raw).not.toContain('127.0.0.1')
    expect(raw).not.toContain(API_KEY)
    expect(raw).not.toContain('faux-modele')
  })

  it('une mention reçoit la réponse du modèle en moins de 5 s, avec la clé en Bearer', async () => {
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply).toMatchObject({ author: RELEASE, npc: { id: 'release-manager' } })
    expect(reply!.text.startsWith(FAKE_MODEL_PREFIX)).toBe(true)
    expect(fake.state.requests).toHaveLength(1)
    expect(fake.state.requests[0]).toMatchObject({ url: '/v1/chat/completions', authorization: `Bearer ${API_KEY}` })
    expect(fake.state.requests[0]!.body).toMatchObject({ model: 'faux-modele', stream: false })
  })

  it('faux serveur en erreur 500 : réponse keywords et ligne de repli dans les journaux', async () => {
    fake.state.status = 500
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const reply = await waitForNpcReply(root.id, 5000)
    expect(reply!.text).toContain('v2.41.0')
    expect(reply!.text).not.toContain(FAKE_MODEL_PREFIX)
    const logs = server.stdout() + server.stderr()
    expect(logs).toContain('[npc] openai-compatible indisponible (HTTP 500) : repli keywords')
    expect(logs).not.toContain(API_KEY)
  })

  it('reset messages pendant une réponse en attente : aucun message PNJ, aucune trace de pile', async () => {
    // Le modèle répond en 1,5 s : le reset tombe pendant l'appel
    fake.state.delayMs = 1500
    await ask(`@${RELEASE} quel déploiement récent ?`)
    await sleep(600)
    expect(fake.state.requests).toHaveLength(1)
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'messages' }, ADMIN)).status).toBe(200)
    await sleep(2500)
    expect((await messages()).filter(message => message.npc)).toEqual([])

    // Une réponse encore planifiée (délai simulé de 200 ms) est aussi annulée
    fake.state.delayMs = 0
    await ask(`@${RELEASE} quel déploiement récent ?`)
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'messages' }, ADMIN)).status).toBe(200)
    await sleep(1000)
    expect((await messages()).filter(message => message.npc)).toEqual([])

    const logs = server.stdout() + server.stderr()
    expect(logs).not.toContain('    at ')
    expect(logs).not.toContain('réponse abandonnée')
  })
})

describe('034 CA4 et 020 CA11 : auteur de la question, contexte du canal, filtre de sortie', () => {
  beforeEach(async () => {
    fake.state.status = 200
    fake.state.delayMs = 0
    fake.state.apologize = false
    fake.state.requests.length = 0
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  })

  it('une mention de Bob après un message d\'Alice : le dernier message user commence par « Bob : »', async () => {
    await ask('Le checkout est lent depuis ce matin')
    const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Bob', text: `@${RELEASE} quel déploiement récent ?` })
    const root: Message = await response.json()
    expect(await waitForNpcReply(root.id, 5000)).toBeDefined()
    const sent = fake.state.requests[0]!.body.messages as { role: string, content: string }[]
    expect(sent.at(-1)).toMatchObject({ role: 'user' })
    expect(sent.at(-1)!.content.startsWith('Bob : ')).toBe(true)
    expect(sent[0]!.content).toContain('Tu réponds à Bob')
  })

  it('mention en fil : le system contient un message racine du canal posté avant le fil ; l\'excuse de service client est retirée', async () => {
    fake.state.apologize = true
    await ask('Le paiement est en erreur depuis dix minutes')
    const thread = await ask('Autre sujet : le café')
    const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, {
      author: 'Bob',
      text: `@${RELEASE} quel déploiement récent ?`,
      parentId: thread.id,
    })
    expect(response.status).toBe(201)
    const reply = await waitForNpcReply(thread.id, 5000)
    expect(reply).toBeDefined()
    expect(reply!.text).not.toContain('désolé')
    expect(reply!.text.startsWith(FAKE_MODEL_PREFIX)).toBe(true)
    const system = (fake.state.requests[0]!.body.messages as { role: string, content: string }[])[0]!.content
    expect(system).toContain('Le paiement est en erreur depuis dix minutes')
    expect(system).toMatch(/\[\d{2}:\d{2}\] Alice : Le paiement est en erreur/)
  })
})
