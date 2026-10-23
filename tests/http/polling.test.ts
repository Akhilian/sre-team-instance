// 017 CA3 : GET …/messages?since=<rev> (polling incrémental) sur le build
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur' })
})
afterAll(() => server?.stop())

const messagesUrl = (channelId = 'incident-en-cours') => `${server.url}/api/channels/${channelId}/messages`

async function since(rev: number | string) {
  const response = await fetch(`${messagesUrl()}?since=${rev}`)
  expect(response.status).toBe(200)
  return response.json() as Promise<{ rev: number, full: boolean, messages: { id: string, rev: number, reactions?: unknown[], alert?: { status: string } }[] }>
}

describe('polling incrémental (?since)', () => {
  it('ne renvoie que les messages créés ou modifiés depuis le curseur', async () => {
    const old = await (await postJson(messagesUrl(), { author: 'Alice', text: 'ancien' })).json()
    const alert = await (await postJson(`${server.url}/api/admin/alerts`, {
      channelId: 'incident-en-cours', severity: 'SEV2', title: 'Latence', service: 'api', text: 'p99 élevé',
    }, ADMIN)).json()

    const start = await since(0)
    expect(start.full).toBe(false)
    const cursor = start.rev
    // Rien ne bouge : aucun message
    expect(await since(cursor)).toEqual({ rev: cursor, full: false, messages: [] })

    const created = await (await postJson(messagesUrl(), { author: 'Bob', text: 'nouveau' })).json()
    const reply = await (await postJson(messagesUrl(), { author: 'Bob', text: 'réponse', parentId: old.id })).json()
    expect((await postJson(`${messagesUrl()}/${old.id}/reactions`, { emoji: '👍', author: 'Bob' })).status).toBe(200)
    expect((await postJson(`${messagesUrl()}/${alert.id}/alert-status`, { status: 'acknowledged', name: 'Bob' })).status).toBe(200)

    const delta = await since(cursor)
    expect(delta.full).toBe(false)
    expect(delta.messages.map(message => message.id)).toEqual([created.id, reply.id, old.id, alert.id])
    const revs = delta.messages.map(message => message.rev)
    expect([...revs].sort((a, b) => a - b)).toEqual(revs)
    expect(delta.messages[2]!.reactions).toHaveLength(1)
    expect(delta.messages[3]!.alert!.status).toBe('acknowledged')
    expect(delta.rev).toBe(revs.at(-1))

    // Après un reset, l'ancien curseur donne la liste complète (vide)
    const reset = await fetch(`${server.url}/api/admin/reset`, { method: 'POST', headers: ADMIN })
    expect(reset.status).toBe(200)
    const afterReset = await since(delta.rev)
    expect(afterReset).toMatchObject({ full: true, messages: [] })
    expect(afterReset.rev).toBeGreaterThan(delta.rev)
  })

  it('full: true pour un curseur dans le futur', async () => {
    expect(await since(999999999)).toMatchObject({ full: true })
  })

  it('400 pour un since non entier ou négatif', async () => {
    for (const value of ['abc', '-1', '1.5', '']) {
      expect((await fetch(`${messagesUrl()}?since=${value}`)).status).toBe(400)
    }
  })

  it('sans since : toujours un tableau', async () => {
    await postJson(messagesUrl(), { author: 'Alice', text: 'x' })
    const body = await (await fetch(messagesUrl())).json()
    expect(Array.isArray(body)).toBe(true)
    expect(body[0].rev).toBeTypeOf('number')
  })

  it('404 sur un canal inconnu, avec ou sans since', async () => {
    expect((await fetch(`${messagesUrl('inconnu')}?since=0`)).status).toBe(404)
    expect((await fetch(messagesUrl('inconnu'))).status).toBe(404)
  })
})
