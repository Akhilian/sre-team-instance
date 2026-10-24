// 037 CA4 : GET /api/admin/guides/:scenarioId sur le build
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

const CODE = 'code-animateur-037'
let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: CODE })
})
afterAll(() => server?.stop())

const get = (id: string, code?: string) =>
  fetch(`${server.url}/api/admin/guides/${id}`, { headers: code === undefined ? {} : { 'x-facilitator-code': code } })

describe('GET /api/admin/guides/:scenarioId', () => {
  it('401 sans code ou avec un mauvais code', async () => {
    expect((await get('panne-checkout')).status).toBe(401)
    expect((await get('panne-checkout', 'mauvais')).status).toBe(401)
  })

  it('200 avec le code : le guide Markdown du scénario', async () => {
    const response = await get('panne-checkout', CODE)
    expect(response.status).toBe(200)
    const body = await response.json() as { scenarioId: string, markdown: string }
    expect(body.scenarioId).toBe('panne-checkout')
    expect(body.markdown.startsWith('# ')).toBe(true)
    expect(body.markdown).toContain('Chronologie des injections')
  })

  it('les trois scénarios ont un guide', async () => {
    for (const id of ['fuite-donnees', 'demo-express']) {
      const body = await (await get(id, CODE)).json() as { markdown: string }
      expect(body.markdown).toContain('Chronologie des injections')
    }
  })

  it('404 pour un scénario inconnu', async () => {
    expect((await get('inconnu', CODE)).status).toBe(404)
  })
})
