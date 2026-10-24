// 027 CA1 et CA5 : second scénario fuite-donnees sur le build (fiches embarquées, moteur keywords,
// délai de réponse fixé à 100 ms)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import type { NpcPersonasAdminState } from '../../shared/types/npc'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const PANNE_IDS = ['ceo', 'cfo', 'communication', 'psp', 'release-manager', 'support-n1']
const FUITE_IDS = ['dev-data', 'dpo', 'porte-parole', 'soc', 'support-clients']

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_REPLY_DELAY_MS: '100' })
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function npcs(): Promise<{ enabled: boolean, npcs: { id: string }[] }> {
  return (await fetch(`${server.url}/api/npcs`)).json()
}

async function messages(): Promise<Message[]> {
  return (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
}

/** existingMessages requis dès qu'un message existe (030) : sans lui, 409 messages-exist */
function start(id: string, existingMessages?: 'clear' | 'keep'): Promise<Response> {
  return postJson(`${server.url}/api/admin/scenarios/${id}/start`, existingMessages ? { existingMessages } : {}, ADMIN)
}

function openDirect(npcId: string): Promise<Response> {
  return postJson(`${server.url}/api/direct`, { participant: 'Alice', npcId })
}

async function ask(text: string): Promise<Message> {
  const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text })
  expect(response.status).toBe(201)
  return response.json()
}

/** Réponses de PNJ dans le fil parentId, après au plus timeoutMs (s'arrête à la première) */
async function npcReplies(parentId: string, timeoutMs: number): Promise<Message[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const replies = (await messages()).filter(message => message.npc && message.parentId === parentId)
    if (replies.length > 0 || Date.now() > deadline) return replies
    await sleep(100)
  }
}

describe('scénario fuite-donnees (027)', () => {
  afterAll(async () => {
    await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)
  })

  it('CA5 : au démarrage, PNJ coupés et 6 PNJ de panne-checkout', async () => {
    const state = await npcs()
    expect(state.enabled).toBe(false)
    expect(state.npcs.map(npc => npc.id)).toEqual(PANNE_IDS)
  })

  it('CA1 : GET /api/admin/npc-personas liste 11 fiches, dont les 5 de fuite-donnees', async () => {
    const state = await (await fetch(`${server.url}/api/admin/npc-personas`, { headers: ADMIN })).json() as NpcPersonasAdminState
    expect(state.personas).toHaveLength(11)
    expect(state.personas.filter(entry => entry.scenarioId === 'fuite-donnees').map(entry => entry.path))
      .toEqual(FUITE_IDS.map(id => `fuite-donnees/${id}.md`))
  })

  it('CA5 : lancer fuite-donnees n\'active que ses 5 PNJ, Yanis ouvre l\'incident', async () => {
    const response = await start('fuite-donnees')
    expect(response.status).toBe(201)
    const run = await response.json()
    expect(run.steps[0]).toMatchObject({ kind: 'npc-message', status: 'published' })
    expect(run.steps[0].label.startsWith('Yanis Belkacem : ')).toBe(true)
    const [first] = await messages()
    expect(first).toMatchObject({ author: 'Yanis Belkacem', npc: { id: 'soc' } })
    expect(first!.text).toContain('9h52')

    const state = await npcs()
    expect(state.enabled).toBe(true)
    expect(state.npcs.map(npc => npc.id)).toEqual(FUITE_IDS)
  })

  it('CA5 : conversation directe refusée avec support-n1 (404), ouverte avec dpo (201)', async () => {
    expect((await openDirect('support-n1')).status).toBe(404)
    expect((await openDirect('dpo')).status).toBe(201)
  })

  it('CA5 : @Sarah Benali reste sans réponse, @Yanis Belkacem répond en fil', async () => {
    const sarah = await ask('@Sarah Benali tu as des tickets ?')
    const yanis = await ask('@Yanis Belkacem quels téléchargements dans les journaux d\'accès, à quelle heure ?')
    const [reply] = await npcReplies(yanis.id, 5000)
    expect(reply).toMatchObject({ author: 'Yanis Belkacem', npc: { id: 'soc' } })
    expect(reply!.text).toContain('23h14')
    expect(await npcReplies(sarah.id, 500)).toEqual([])
  })

  it('CA5 : relancer panne-checkout ramène ses 6 PNJ et refuse dpo (404)', async () => {
    // Un seul scénario à la fois : arrêter fuite-donnees d'abord
    expect((await postJson(`${server.url}/api/admin/scenarios/stop`, {}, ADMIN)).status).toBe(200)
    expect((await start('panne-checkout', 'keep')).status).toBe(201)
    const state = await npcs()
    expect(state.enabled).toBe(true)
    expect(state.npcs.map(npc => npc.id)).toEqual(PANNE_IDS)
    expect((await openDirect('dpo')).status).toBe(404)
  })

  it('demo-express après fuite-donnees : les 6 PNJ de panne-checkout, coupés (030), Sarah répond une fois activés', async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await start('fuite-donnees')).status).toBe(201)
    expect((await postJson(`${server.url}/api/admin/scenarios/stop`, {}, ADMIN)).status).toBe(200)
    expect((await start('demo-express', 'keep')).status).toBe(201)
    const state = await npcs()
    expect(state.enabled).toBe(false)
    expect(state.npcs.map(npc => npc.id)).toEqual(PANNE_IDS)
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
    const root = await ask('@Sarah Benali depuis quand ?')
    const [reply] = await npcReplies(root.id, 5000)
    expect(reply).toMatchObject({ author: 'Sarah Benali', npc: { id: 'support-n1' } })
  })

  it('« Tout réinitialiser » après fuite-donnees : PNJ coupés et revenus à panne-checkout', async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    expect((await start('fuite-donnees')).status).toBe(201)
    expect((await npcs()).npcs.map(npc => npc.id)).toEqual(FUITE_IDS)
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
    const state = await npcs()
    expect(state.enabled).toBe(false)
    expect(state.npcs.map(npc => npc.id)).toEqual(PANNE_IDS)
    const admin = await (await fetch(`${server.url}/api/admin/npcs`, { headers: ADMIN })).json()
    expect(admin).toMatchObject({ enabled: false, scenarioId: 'panne-checkout' })
  })
})
