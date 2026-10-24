// 038 CA3 : rôles d'incident sur le build (participant, présence, animateur)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

const CODE = 'code-animateur-038'
let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: CODE })
})
afterAll(() => server?.stop())

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
const admin = { 'x-facilitator-code': CODE }
const participants = (headers?: Record<string, string>) => fetch(`${server.url}/api/admin/participants`, { headers })

describe('rôles d\'incident', () => {
  it('POST /api/roles : 200 si valide, 400 pour un rôle inconnu', async () => {
    const ok = await post('/api/roles', { name: 'Alice', role: 'scribe' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ name: 'Alice', role: 'scribe' })
    expect((await post('/api/roles', { name: 'Alice', role: 'chef' })).status).toBe(400)
    expect((await post('/api/roles', { name: '', role: 'scribe' })).status).toBe(400)
  })

  it('le battement de présence renvoie le rôle', async () => {
    const response = await post('/api/presence', { name: 'Alice', channelId: 'general' })
    expect(response.status).toBe(200)
    expect((await response.json()).roles).toEqual({ Alice: 'scribe' })
  })

  it('GET /api/admin/participants : 401 sans code valide, sinon présents et rôles', async () => {
    expect((await participants()).status).toBe(401)
    expect((await participants({ 'x-facilitator-code': 'mauvais' })).status).toBe(401)
    const response = await participants(admin)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      participants: [{ name: 'Alice', channelId: 'general', role: 'scribe' }],
      hasIncidentCommander: false,
    })
  })

  it('POST /api/admin/roles : 401, 400, puis 200 reflété partout', async () => {
    expect((await post('/api/admin/roles', { name: 'Alice', role: 'incident-commander' })).status).toBe(401)
    expect((await post('/api/admin/roles', { name: 'Alice', role: 'chef' }, admin)).status).toBe(400)
    const ok = await post('/api/admin/roles', { name: 'Alice', role: 'incident-commander' }, admin)
    expect(ok.status).toBe(200)

    const beat = await (await post('/api/presence', { name: 'Alice', channelId: 'general' })).json()
    expect(beat.roles).toEqual({ Alice: 'incident-commander' })
    const list = await (await participants(admin)).json()
    expect(list.participants).toEqual([{ name: 'Alice', channelId: 'general', role: 'incident-commander' }])
    expect(list.hasIncidentCommander).toBe(true)
  })
})
