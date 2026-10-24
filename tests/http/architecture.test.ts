// 036 CA3 : GET /api/admin/architecture sur le build
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

const CODE = 'code-animateur-036'
let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: CODE, ANTHROPIC_API_KEY: 'sk-ant-SECRET' })
})
afterAll(() => server?.stop())

const REQUIRED = ['participants', 'facilitator', 'nuxt-pages', 'api', 'scenario-runner', 'npc-dispatcher', 'spontaneous', 'persistence',
  'storage-memory', 'storage-fs', 'storage-redis', 'engine-keywords', 'engine-openai', 'engine-anthropic', 'personas-embedded',
  'personas-directory', 'hosting-render', 'hosting-kubernetes', 'hosting-local']

describe('GET /api/admin/architecture', () => {
  it('401 sans code ou avec un mauvais code', async () => {
    expect((await fetch(`${server.url}/api/admin/architecture`)).status).toBe(401)
    const wrong = await fetch(`${server.url}/api/admin/architecture`, { headers: { 'x-facilitator-code': 'mauvais' } })
    expect(wrong.status).toBe(401)
  })

  it('200 avec le code : modèle local, mémoire, keywords, sans secret', async () => {
    const response = await fetch(`${server.url}/api/admin/architecture`, { headers: { 'x-facilitator-code': CODE } })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain('SECRET')
    expect(text).not.toContain(CODE)
    const model = JSON.parse(text)
    expect(model.hosting).toBe('local')
    expect(model.storage.driver).toBe('memory')
    expect(model.npcEngine.name).toBe('keywords')
    expect(model.personas.count).toBeGreaterThan(0)
    const ids = model.components.map((component: { id: string }) => component.id)
    for (const id of REQUIRED) expect(ids).toContain(id)
  })
})
