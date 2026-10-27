// 055 CA5/CA6 sur le build : sans scénario déclarant des actions, liste vide et 404 ; aucune fuite de jeton ni d'URL
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

const TOKEN = 'jeton-docshare-ultra-secret'
const ADMIN = { 'x-facilitator-code': 'animateur' }
let server: TestServer

beforeAll(async () => {
  server = await startServer({
    FACILITATOR_CODE: 'animateur',
    NPC_REPLY_DELAY_MS: '0',
    DOCSHARE_OPS_TOKEN: TOKEN,
    DOCSHARE_BASE_URL: 'http://127.0.0.1:9',
    GRAFANA_DASHBOARD_URL: 'https://grafana.example/d/abc',
  })
})
afterAll(() => server?.stop())

describe('055 actions d\'équipe sans scénario avec actions', () => {
  it('liste vide, 404, ni jeton ni URL DocShare ni lien Grafana', async () => {
    const bodies: string[] = []
    const list = await fetch(`${server.url}/api/actions`)
    expect(list.status).toBe(200)
    bodies.push(await list.text())
    expect(JSON.parse(bodies[0]!)).toEqual({ actions: [] })

    const post = await postJson(`${server.url}/api/actions/rollback`, { author: 'Alice' })
    expect(post.status).toBe(404)
    bodies.push(await post.text())

    // Scénario du catalogue (sans actions) en cours : même réponse
    expect((await fetch(`${server.url}/api/admin/scenarios/demo-express/start`, { method: 'POST', headers: ADMIN })).status).toBeLessThan(300)
    bodies.push(await (await fetch(`${server.url}/api/actions`)).text())
    expect(JSON.parse(bodies.at(-1)!)).toEqual({ actions: [] })
    expect((await postJson(`${server.url}/api/actions/rollback`, { author: 'Alice' })).status).toBe(404)

    expect((await postJson(`${server.url}/api/actions/rollback`, {})).status).toBe(400)
    await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)
    for (const body of bodies) {
      expect(body).not.toContain(TOKEN)
      expect(body).not.toContain('127.0.0.1:9')
      expect(body).not.toContain('grafana')
    }
  })
})
