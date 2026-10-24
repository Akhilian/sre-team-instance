// 030 CA1 à CA3 : cycle de vie scénario et PNJ sur le build (arrêt qui coupe les PNJ, démo sans PNJ
// actifs, 409 messages-exist au lancement, conversations directes effacées avec les messages)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChannelSummary, Message } from '../../shared/types/chat'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const DM = 'dm-alice--release-manager'
const RELEASE = 'Julien Moreau'

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_REPLY_DELAY_MS: '0' })
})
afterAll(() => server?.stop())

/** POST sans corps (ni content-type) */
function postEmpty(path: string): Promise<Response> {
  return fetch(`${server.url}${path}`, { method: 'POST', headers: ADMIN })
}

function start(id: string, body?: unknown): Promise<Response> {
  return body === undefined
    ? postEmpty(`/api/admin/scenarios/${id}/start`)
    : postJson(`${server.url}/api/admin/scenarios/${id}/start`, body, ADMIN)
}

async function adminNpcs(): Promise<{ enabled: boolean, scenarioId: string }> {
  return (await fetch(`${server.url}/api/admin/npcs`, { headers: ADMIN })).json()
}

async function messages(channelId = CHANNEL): Promise<Message[]> {
  return (await fetch(`${server.url}/api/channels/${channelId}/messages`)).json()
}

async function run(): Promise<unknown> {
  return (await (await fetch(`${server.url}/api/admin/scenarios`, { headers: ADMIN })).json()).run
}

async function post(text: string, channelId = CHANNEL): Promise<Message> {
  const response = await postJson(`${server.url}/api/channels/${channelId}/messages`, { author: 'Alice', text })
  expect(response.status).toBe(201)
  return response.json()
}

beforeEach(async () => {
  expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
})

describe('lancement sur des messages existants (030 CA2)', () => {
  // En premier dans le fichier : aucun lancement depuis le démarrage, run vaut donc null
  it('409 messages-exist sans rien lancer, puis keep et clear', async () => {
    const old = await post('Message d\'avant le scénario')
    const refused = await start('panne-checkout')
    expect(refused.status).toBe(409)
    const body = await refused.json()
    expect(body.data.reason).toBe('messages-exist')
    expect(body.data.messageCount).toBeGreaterThanOrEqual(1)
    expect(await run()).toBeNull()
    expect((await messages()).map(message => message.id)).toEqual([old.id])

    expect((await start('panne-checkout', { existingMessages: 'keep' })).status).toBe(201)
    expect((await messages()).map(message => message.id)).toContain(old.id)

    expect((await postEmpty('/api/admin/scenarios/stop')).status).toBe(200)
    expect((await start('panne-checkout', { existingMessages: 'clear' })).status).toBe(201)
    const after = await messages()
    expect(after.map(message => message.id)).not.toContain(old.id)
    // Seul le message de Sarah (étape at: 0) a été publié par le nouveau scénario
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ author: 'Sarah Benali', npc: { id: 'support-n1' } })
  })

  it('store vide : start sans corps donne 201 ; existingMessages inconnu : 400', async () => {
    expect((await start('panne-checkout', { existingMessages: 'autre' })).status).toBe(400)
    expect((await start('panne-checkout')).status).toBe(201)
  })

  it('un scénario déjà en cours reste un 409 sans effacer les messages', async () => {
    expect((await start('panne-checkout')).status).toBe(201)
    const before = await messages()
    const refused = await start('fuite-donnees', { existingMessages: 'clear' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).data?.reason).not.toBe('messages-exist')
    expect((await messages()).map(message => message.id)).toEqual(before.map(message => message.id))
  })
})

describe('arrêt et démo (030 CA1)', () => {
  it('stop sans corps coupe les PNJ ; disableNpcs: false les laisse actifs ; demo-express les laisse coupés', async () => {
    expect((await start('panne-checkout')).status).toBe(201)
    expect((await adminNpcs()).enabled).toBe(true)
    expect((await postEmpty('/api/admin/scenarios/stop')).status).toBe(200)
    expect((await adminNpcs()).enabled).toBe(false)

    expect((await start('panne-checkout', { existingMessages: 'clear' })).status).toBe(201)
    expect((await adminNpcs()).enabled).toBe(true)
    expect((await postJson(`${server.url}/api/admin/scenarios/stop`, { disableNpcs: false }, ADMIN)).status).toBe(200)
    expect((await adminNpcs()).enabled).toBe(true)

    expect((await start('demo-express', { existingMessages: 'clear' })).status).toBe(201)
    expect(await adminNpcs()).toMatchObject({ enabled: false, scenarioId: 'panne-checkout' })
    const sarah = (await messages()).find(message => message.text.startsWith('[Démo] Ici Sarah'))
    expect(sarah).toMatchObject({ author: 'Sarah Benali', npc: { id: 'support-n1' } })
  })

  it('stop : 400 si disableNpcs n\'est pas un booléen', async () => {
    expect((await start('panne-checkout')).status).toBe(201)
    expect((await postJson(`${server.url}/api/admin/scenarios/stop`, { disableNpcs: 'non' }, ADMIN)).status).toBe(400)
    expect((await postEmpty('/api/admin/scenarios/stop')).status).toBe(200)
  })
})

describe('conversations directes et effacement (030 CA3)', () => {
  it('npcName listé ; reset messages supprime la conversation (404)', async () => {
    expect((await start('panne-checkout')).status).toBe(201)
    expect((await postJson(`${server.url}/api/direct`, { participant: 'Alice', npcId: 'release-manager' })).status).toBe(201)
    const listed: ChannelSummary[] = await (await fetch(`${server.url}/api/channels?participant=Alice`)).json()
    expect(listed.find(channel => channel.id === DM)?.direct?.npcName).toBe(RELEASE)
    await post('Bonjour', DM)

    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'messages' }, ADMIN)).status).toBe(200)
    const after: ChannelSummary[] = await (await fetch(`${server.url}/api/channels?participant=Alice`)).json()
    expect(after.map(channel => channel.id)).not.toContain(DM)
    expect((await fetch(`${server.url}/api/channels/${DM}/messages`)).status).toBe(404)
  })

  it('existingMessages: clear supprime aussi les conversations directes', async () => {
    expect((await start('panne-checkout')).status).toBe(201)
    expect((await postJson(`${server.url}/api/direct`, { participant: 'Alice', npcId: 'release-manager' })).status).toBe(201)
    expect((await postEmpty('/api/admin/scenarios/stop')).status).toBe(200)
    expect((await start('fuite-donnees', { existingMessages: 'clear' })).status).toBe(201)
    expect((await fetch(`${server.url}/api/channels/${DM}/messages`)).status).toBe(404)
  })
})
