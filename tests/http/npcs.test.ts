// 019 CA4 et CA5 : PNJ sur le build (délai de réponse par défaut, 1 à 2 s)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const RELEASE = 'Julien Moreau'

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur' })
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function npcs(): Promise<{ enabled: boolean, npcs: { id: string, name: string, role: string }[] }> {
  return (await fetch(`${server.url}/api/npcs`)).json()
}

async function messages(): Promise<Message[]> {
  return (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
}

function setEnabled(enabled: boolean, headers: Record<string, string> = ADMIN) {
  return postJson(`${server.url}/api/admin/npcs`, { enabled }, headers)
}

async function ask(text: string, parentId?: string): Promise<Message> {
  const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text, parentId })
  expect(response.status).toBe(201)
  return response.json()
}

/** Attend count réponses de PNJ dans le fil parentId, au plus timeoutMs ; renvoie celles trouvées */
async function waitForNpcReplies(parentId: string, count: number, timeoutMs: number): Promise<Message[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const replies = (await messages()).filter(message => message.npc && message.parentId === parentId)
    if (replies.length >= count || Date.now() > deadline) return replies
    await sleep(200)
  }
}

describe('PNJ (019)', () => {
  beforeEach(async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
  })

  it('/api/health indique le moteur keywords', async () => {
    expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({ npcEngine: 'keywords' })
  })

  it('POST /api/admin/npcs : 401 sans code, 400 sans booléen, 200 avec le code', async () => {
    expect((await setEnabled(true, {})).status).toBe(401)
    expect((await fetch(`${server.url}/api/admin/npcs`)).status).toBe(401)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: 'oui' }, ADMIN)).status).toBe(400)
    const response = await setEnabled(true)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ enabled: true, engine: 'keywords', scenarioId: 'panne-checkout' })

    const state = await npcs()
    expect(state.enabled).toBe(true)
    expect(state.npcs).toHaveLength(4)
    expect(state.npcs.map(npc => npc.name)).toContain(RELEASE)
    expect(Object.keys(state.npcs[0]!).sort()).toEqual(['id', 'name', 'role'])
  })

  it('une mention du Release Manager reçoit sa réponse dans le fil en moins de 5 s', async () => {
    expect((await setEnabled(true)).status).toBe(200)
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    const [reply] = await waitForNpcReplies(root.id, 1, 5000)
    expect(reply).toMatchObject({ author: RELEASE, parentId: root.id, npc: { id: 'release-manager' } })
    expect(reply!.text).toContain('v2.41.0')

    // Dans un fil : réponse dans ce même fil
    await ask(`@${RELEASE.toLowerCase()} rollback possible ?`, root.id)
    const replies = await waitForNpcReplies(root.id, 2, 5000)
    expect(replies).toHaveLength(2)
    expect(replies[1]!.text).toContain('v2.40.3')
  })

  it('PNJ coupés : aucune réponse au bout de 3 s', async () => {
    expect((await setEnabled(false)).status).toBe(200)
    expect((await npcs()).enabled).toBe(false)
    const root = await ask(`@${RELEASE} quel déploiement récent ?`)
    await sleep(3000)
    expect((await messages()).filter(message => message.npc)).toEqual([])
    expect(root.npc).toBeUndefined()
  })

  it('un participant ne peut pas signer du nom d\'un PNJ (400)', async () => {
    for (const author of [RELEASE, 'julien moreau', ' CLAIRE DUMONT ']) {
      const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author, text: 'je suis un PNJ' })
      expect(response.status).toBe(400)
    }
  })

  it('le corps HTTP ne peut pas poser npc', async () => {
    const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, {
      author: 'Alice',
      text: 'faux PNJ',
      npc: { id: 'cfo', role: 'CFO' },
    })
    expect(response.status).toBe(201)
    expect((await response.json()).npc).toBeUndefined()
  })

  it('CA5 : lancer panne-checkout active les PNJ, reset all les coupe', async () => {
    expect((await npcs()).enabled).toBe(false)
    expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)
    expect((await npcs()).enabled).toBe(true)
    const admin = await (await fetch(`${server.url}/api/admin/npcs`, { headers: ADMIN })).json()
    expect(admin).toMatchObject({ enabled: true, scenarioId: 'panne-checkout' })

    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await npcs()).enabled).toBe(false)
  })
})
