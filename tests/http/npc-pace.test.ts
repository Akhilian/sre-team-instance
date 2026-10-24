// 019 CA15 (réglage du rythme) et 040 CA6 (avis « pas dans ce scénario ») sur le build
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import { loadPersonas } from '../npc-helpers'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const FOREIGN = loadPersonas('fuite-donnees')[0]!

let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_REPLY_DELAY_MS: '100' })
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

describe('rythme des PNJ (019 CA15)', () => {
  beforeEach(async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
  })

  it('NPC_PACE=instant (test) ; POST {pace} réglable avec le code, 400 sinon, 401 sans code', async () => {
    const state = () => fetch(`${server.url}/api/admin/npcs`, { headers: ADMIN }).then(response => response.json())
    expect(await state()).toMatchObject({ pace: 'instant' })
    expect((await postJson(`${server.url}/api/admin/npcs`, { pace: 'busy' })).status).toBe(401)
    expect((await postJson(`${server.url}/api/admin/npcs`, { pace: 'tortue' }, ADMIN)).status).toBe(400)
    const response = await postJson(`${server.url}/api/admin/npcs`, { pace: 'busy' }, ADMIN)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ pace: 'busy' })
    // « Tout réinitialiser » revient au rythme de l'environnement
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect(await state()).toMatchObject({ pace: 'instant' })
  })

  it('mode réaliste : pas de réponse avant 5 s, mais la frappe est signalée tout de suite', async () => {
    await postJson(`${server.url}/api/admin/npcs`, { enabled: true, pace: 'realistic' }, ADMIN)
    const asked = await (await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text: '@Julien Moreau quel déploiement récent ?' })).json() as Message
    await sleep(1500)
    const all: Message[] = await (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
    expect(all.filter(message => message.npc && message.parentId === asked.id)).toEqual([])
    const presence = await postJson(`${server.url}/api/presence`, { name: 'Alice', channelId: CHANNEL })
    expect((await presence.json()).typing).toContain('Julien Moreau')
    await postJson(`${server.url}/api/admin/npcs`, { enabled: false }, ADMIN)
  })
})

describe('mention d\'un PNJ absent du scénario (040 CA6)', () => {
  it('message système dans le fil, pas de réponse', async () => {
    await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)
    expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)
    const asked = await (await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text: `@${FOREIGN.name} des nouvelles ?` })).json() as Message
    await sleep(600)
    const all: Message[] = await (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
    const notice = all.find(message => message.parentId === asked.id && message.kind === 'system')
    expect(notice?.text).toBe(`${FOREIGN.name} n'est pas dans ce scénario.`)
    expect(all.filter(message => message.npc && message.parentId === asked.id)).toEqual([])
  })
})
