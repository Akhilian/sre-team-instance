// 054 CA6 : le jeton DocShare n'apparaît dans aucune réponse des routes de scénarios ni dans le run
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

const TOKEN = 'jeton-docshare-ultra-secret'
const ADMIN = { 'x-facilitator-code': 'animateur' }
let server: TestServer

beforeAll(async () => {
  server = await startServer({
    FACILITATOR_CODE: 'animateur',
    NPC_REPLY_DELAY_MS: '0',
    DOCSHARE_OPS_TOKEN: TOKEN,
    DOCSHARE_BASE_URL: 'http://127.0.0.1:9',
  })
})
afterAll(() => server?.stop())

describe('054 non-fuite du jeton DocShare', () => {
  it('absent des routes /api/admin/scenarios* et du run', async () => {
    const bodies: string[] = []
    bodies.push(await (await fetch(`${server.url}/api/admin/scenarios`, { headers: ADMIN })).text())
    const started = await fetch(`${server.url}/api/admin/scenarios/demo-express/start`, { method: 'POST', headers: ADMIN })
    bodies.push(await started.text())
    bodies.push(await (await fetch(`${server.url}/api/admin/scenarios`, { headers: ADMIN })).text())
    bodies.push(await (await fetch(`${server.url}/api/admin/scenarios/stop`, { method: 'POST', headers: ADMIN })).text())
    await fetch(`${server.url}/api/admin/reset`, { method: 'POST', headers: { ...ADMIN, 'content-type': 'application/json' }, body: '{"scope":"all"}' })
    for (const body of bodies) expect(body).not.toContain(TOKEN)
    expect(bodies[0]).toContain('demo-express')
  })
})
