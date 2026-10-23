// 017 CA4 : POST /api/admin/reset avec scope messages (défaut) ou all, sur le build
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur' })
})
afterAll(() => server?.stop())

function reset(body?: unknown) {
  if (body === undefined) {
    return fetch(`${server.url}/api/admin/reset`, { method: 'POST', headers: { ...ADMIN, 'content-length': '0' } })
  }
  return postJson(`${server.url}/api/admin/reset`, body, ADMIN)
}

async function channelIds(): Promise<string[]> {
  const channels: { id: string }[] = await (await fetch(`${server.url}/api/channels`)).json()
  return channels.map(channel => channel.id)
}

let counter = 0

/** Un canal créé par un participant, un message dans general et une présence active */
async function setup(): Promise<string> {
  counter += 1
  const created = await postJson(`${server.url}/api/channels`, { name: `Test ${counter}` })
  expect(created.status).toBe(201)
  const { id } = await created.json()
  expect((await postJson(`${server.url}/api/channels/general/messages`, { author: 'Alice', text: 'bonjour' })).status).toBe(201)
  expect((await postJson(`${server.url}/api/presence`, { name: 'Alice', channelId: 'general' })).status).toBe(200)
  return id
}

describe('reset (M2)', () => {
  beforeEach(async () => {
    // Part d'un état propre : seuls les canaux par défaut
    expect((await reset({ scope: 'all' })).status).toBe(200)
  })

  it('sans corps : scope messages, le canal créé est conservé', async () => {
    const id = await setup()
    const response = await reset()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ cleared: true, scope: 'messages' })
    expect(await channelIds()).toContain(id)
    expect(await (await fetch(`${server.url}/api/channels/general/messages`)).json()).toEqual([])
  })

  it('scope messages : le canal créé est conservé', async () => {
    const id = await setup()
    const response = await reset({ scope: 'messages' })
    expect(await response.json()).toEqual({ cleared: true, scope: 'messages' })
    expect(await channelIds()).toContain(id)
  })

  it('scope all : canaux par défaut seulement, canal créé en 404, présence vidée, totalCount conservé', async () => {
    const id = await setup()
    const before: { id: string, totalCount: number }[] = await (await fetch(`${server.url}/api/channels`)).json()
    const generalTotal = before.find(channel => channel.id === 'general')!.totalCount
    expect(generalTotal).toBeGreaterThan(0)

    const response = await reset({ scope: 'all' })
    expect(await response.json()).toEqual({ cleared: true, scope: 'all' })
    const after: { id: string, messageCount: number, totalCount: number }[] = await (await fetch(`${server.url}/api/channels`)).json()
    expect(after.map(channel => channel.id)).toEqual(['general', 'incident-en-cours'])
    expect(after[0]).toMatchObject({ messageCount: 0, totalCount: generalTotal })
    expect((await fetch(`${server.url}/api/channels/${id}/messages`)).status).toBe(404)

    const presence = await (await postJson(`${server.url}/api/presence`, { name: 'Bob', channelId: 'general' })).json()
    expect(presence.present).toEqual(['Bob'])
  })

  it('arrête le scénario en cours (les deux scopes)', async () => {
    for (const scope of ['messages', 'all']) {
      expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)
      expect((await reset({ scope })).status).toBe(200)
      const { run } = await (await fetch(`${server.url}/api/admin/scenarios`, { headers: ADMIN })).json()
      expect(run?.status).not.toBe('running')
    }
  })

  it('400 pour un scope inconnu, 401 sans code', async () => {
    expect((await reset({ scope: 'x' })).status).toBe(400)
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' })).status).toBe(401)
  })
})
