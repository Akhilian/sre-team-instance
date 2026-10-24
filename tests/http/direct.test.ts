// 022 CA4 et CA5 : conversations directes avec les PNJ, sur le build (délai de réponse fixé à 1,5 s)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChannelSummary, Message } from '../../shared/types/chat'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }
const DM = 'dm-alice--release-manager'
const RELEASE = 'Julien Moreau'

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_REPLY_DELAY_MS: '1500' })
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

function openDirect(body: unknown): Promise<Response> {
  return postJson(`${server.url}/api/direct`, body)
}

async function channelIds(query = ''): Promise<string[]> {
  const summaries: ChannelSummary[] = await (await fetch(`${server.url}/api/channels${query}`)).json()
  return summaries.map(summary => summary.id)
}

describe('conversations directes (022)', () => {
  beforeEach(async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
  })
  afterAll(async () => {
    await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)
  })

  it('CA5 : PNJ coupés → 409', async () => {
    expect((await openDirect({ participant: 'Alice', npcId: 'release-manager' })).status).toBe(409)
  })

  it('CA4 : création, visibilité, écriture gardée, réponse sans mention avec frappe, chronologie, reset', async () => {
    expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)

    const created = await openDirect({ participant: 'Alice', npcId: 'release-manager' })
    expect(created.status).toBe(201)
    const channel = await created.json()
    expect(channel).toEqual({ id: DM, name: `Alice ↔ ${RELEASE}`, direct: { participant: 'Alice', npcId: 'release-manager', npcName: RELEASE } })
    const again = await openDirect({ participant: 'alice', npcId: 'release-manager' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(channel)

    expect((await openDirect({ participant: 'Alice', npcId: 'inconnu' })).status).toBe(404)
    expect((await openDirect({ participant: RELEASE, npcId: 'cfo' })).status).toBe(400)
    expect((await openDirect({ participant: '!!!', npcId: 'cfo' })).status).toBe(400)

    expect(await channelIds()).not.toContain(DM)
    expect(await channelIds('?participant=Alice')).toContain(DM)
    expect(await channelIds('?participant=Bob')).not.toContain(DM)

    const intruder = await postJson(`${server.url}/api/channels/${DM}/messages`, { author: 'Bob', text: 'Coucou' })
    expect(intruder.status).toBe(403)

    const sent = await postJson(`${server.url}/api/channels/${DM}/messages`, { author: 'Alice', text: 'Quel déploiement récent ?' })
    expect(sent.status).toBe(201)
    const startedAt = Date.now()
    const presence = await postJson(`${server.url}/api/presence`, { name: 'Alice', channelId: DM })
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect((await presence.json()).typing).toContain(RELEASE)

    let reply: Message | undefined
    while (!reply && Date.now() - startedAt < 5000) {
      const messages: Message[] = await (await fetch(`${server.url}/api/channels/${DM}/messages`)).json()
      reply = messages.find(message => message.npc)
      if (!reply) await sleep(200)
    }
    expect(reply).toMatchObject({ author: RELEASE, npc: { id: 'release-manager' } })
    expect(reply!.parentId).toBeUndefined()
    expect(reply!.text).toContain('v2.41.0')
    // Réponse publiée : le PNJ n'écrit plus
    const after = await postJson(`${server.url}/api/presence`, { name: 'Alice', channelId: DM })
    expect((await after.json()).typing).not.toContain(RELEASE)

    const timeline = await (await fetch(`${server.url}/api/admin/timeline`, { headers: ADMIN })).json()
    expect(timeline.events.some((event: { channelId: string }) => event.channelId === DM)).toBe(true)

    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await fetch(`${server.url}/api/channels/${DM}/messages`)).status).toBe(404)
  })

  it('023 CA2 : réactions et acquittements réservés au propriétaire dans une conversation directe', async () => {
    expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)
    expect((await openDirect({ participant: 'Alice', npcId: 'release-manager' })).status).toBe(201)
    const sent = await postJson(`${server.url}/api/channels/${DM}/messages`, { author: 'Alice', text: 'Quel déploiement récent ?' })
    expect(sent.status).toBe(201)
    const question: Message = await sent.json()

    // Réponse du PNJ publiée : la conversation contient le message d'Alice et celui du PNJ
    const startedAt = Date.now()
    let reply: Message | undefined
    while (!reply && Date.now() - startedAt < 5000) {
      const messages: Message[] = await (await fetch(`${server.url}/api/channels/${DM}/messages`)).json()
      reply = messages.find(message => message.npc)
      if (!reply) await sleep(200)
    }
    expect(reply).toBeDefined()

    const react = (channelId: string, messageId: string, body: unknown) =>
      postJson(`${server.url}/api/channels/${channelId}/messages/${messageId}/reactions`, body)
    for (const messageId of [question.id, reply!.id]) {
      expect((await react(DM, messageId, { emoji: '👍', author: 'Bob' })).status).toBe(403)
    }
    expect((await react(DM, reply!.id, { emoji: '👍', author: 'Alice' })).status).toBe(200)
    expect((await react(DM, reply!.id, { emoji: '❤️', author: 'alice' })).status).toBe(200)
    expect((await react(DM, reply!.id, { emoji: '👍' })).status).toBe(400)
    expect((await react(DM, reply!.id, { emoji: '👍', author: '  ' })).status).toBe(400)

    const status = await postJson(`${server.url}/api/channels/${DM}/messages/${reply!.id}/alert-status`, { status: 'acknowledged', name: 'Bob' })
    expect(status.status).toBe(403)

    // Canaux d'équipe inchangés : Bob y réagit librement
    const team = await postJson(`${server.url}/api/channels/incident-en-cours/messages`, { author: 'Alice', text: 'Je regarde le checkout' })
    expect(team.status).toBe(201)
    expect((await react('incident-en-cours', (await team.json()).id, { emoji: '👍', author: 'Bob' })).status).toBe(200)
  })
})
