// 041 CA2 et CA12 : GET /metrics sur le build (format, cardinalité, absence de secret, METRICS_ENABLED)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FAKE_MODEL_PREFIX, startFakeOpenAi } from '../../scripts/fake-openai.mjs'
import { postJson, startServer, type TestServer } from './server'

const CODE = 'code-animateur-sentinelle-041'
const REDIS_PASSWORD = 'mdp-redis-sentinelle-041'
const LLM_KEY = 'cle-llm-sentinelle-041'
const ANTHROPIC_KEY = 'cle-anthropic-sentinelle-041'
const MODEL = 'm-test'
const ADMIN = { 'x-facilitator-code': CODE }

let fake: Awaited<ReturnType<typeof startFakeOpenAi>>
let server: TestServer

beforeAll(async () => {
  fake = await startFakeOpenAi()
  server = await startServer({
    FACILITATOR_CODE: CODE,
    REDIS_URL: `redis://:${REDIS_PASSWORD}@127.0.0.1:1`,
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    NPC_ENGINE: 'openai-compatible',
    NPC_LLM_BASE_URL: fake.baseUrl,
    NPC_LLM_MODEL: MODEL,
    NPC_LLM_API_KEY: LLM_KEY,
    NPC_REPLY_DELAY_MS: '100',
  })
})
afterAll(async () => {
  await server?.stop()
  await fake?.stop()
})

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function metrics(): Promise<{ response: Response, text: string }> {
  const response = await fetch(`${server.url}/metrics`)
  return { response, text: await response.text() }
}

describe('GET /metrics (041)', () => {
  it('200, text/plain version=0.0.4, compte les requêtes sur un canal, sans /metrics ni /api/health', async () => {
    await fetch(`${server.url}/api/channels/incident-en-cours/messages`)
    const { response, text } = await metrics()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain; version=0.0.4')
    expect(text).toContain('paging_http_requests_total{method="GET",route="/api/channels/:id/messages",status_class="2xx"}')
    expect(text).toContain('# TYPE paging_http_request_duration_seconds histogram')
    expect(text).not.toContain('route="/metrics"')
    expect(text).not.toContain('route="/api/health"')
  })

  it('un id inventé n\'ajoute aucune série avec l\'id ; un chemin inconnu → other', async () => {
    const invented = 'canal-invente-7f3a9c'
    await fetch(`${server.url}/api/channels/${invented}/messages`)
    await postJson(`${server.url}/api/channels/${invented}/messages`, { author: 'Alice', text: 'x' })
    await fetch(`${server.url}/api/inconnu/${invented}`)
    const { text } = await metrics()
    expect(text).not.toContain(invented)
    expect(text).toContain('route="/api/channels/:id/messages",status_class="4xx"')
    expect(text).toMatch(/route="other"/)
  })

  it('aucun secret : code animateur, REDIS_URL, clés d\'API', async () => {
    const { text } = await metrics()
    for (const secret of [CODE, REDIS_PASSWORD, LLM_KEY, ANTHROPIC_KEY, '127.0.0.1', String(fake.port)]) expect(text).not.toContain(secret)
  })

  it('PNJ : issues, model configuré seul, ni prompt ni réponse', async () => {
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
    const root = await (await postJson(`${server.url}/api/channels/incident-en-cours/messages`, { author: 'Alice', text: '@Julien Moreau quel déploiement récent ?' })).json() as { id: string }
    const deadline = Date.now() + 5000
    for (;;) {
      const all = await (await fetch(`${server.url}/api/channels/incident-en-cours/messages`)).json() as Array<{ npc?: unknown, parentId?: string, text: string }>
      if (all.some(message => message.npc && message.parentId === root.id) || Date.now() > deadline) break
      await sleep(100)
    }
    const { text } = await metrics()
    expect(text).toContain('paging_npc_replies_total{engine="openai-compatible",outcome="ok"} 1')
    expect(text).toContain(`paging_npc_llm_duration_seconds_count{engine="openai-compatible",model="${MODEL}",outcome="ok"} 1`)
    expect(text).toContain('paging_messages_posted_total{kind="npc"} 1')
    expect(text).toContain('paging_active_clients')
    expect(text).not.toContain(FAKE_MODEL_PREFIX)
    expect(text).not.toContain('quel déploiement')
    // Redis injoignable : le stockage est signalé en échec
    expect(text).toContain('paging_storage_up 0')
    expect(text).not.toMatch(/paging_npc_llm_[a-z_]+\{[^}]*engine="keywords"/)
  })
})

describe('METRICS_ENABLED=false (041 CA2)', () => {
  it('404 sur /metrics, le reste fonctionne', async () => {
    const off = await startServer({ METRICS_ENABLED: 'false' })
    try {
      expect((await fetch(`${off.url}/metrics`)).status).toBe(404)
      expect((await fetch(`${off.url}/api/health`)).status).toBe(200)
    }
    finally {
      await off.stop()
    }
  })
})
