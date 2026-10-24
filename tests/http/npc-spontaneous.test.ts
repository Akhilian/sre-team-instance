// 035 CA6 : interventions spontanées sur le build (moteur keywords, « minute » de 1 s)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import { loadPersonas, personaById } from '../npc-helpers'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const CFO = personaById('cfo')
const CFO_KEYWORDS_RULE = CFO.spontaneous.find(rule => rule.trigger.type === 'keywords')!
const COMMUNICATION = personaById('communication')
const COMMUNICATION_AFTER = COMMUNICATION.spontaneous.find(rule => rule.trigger.type === 'after')!
/** Tous les textes de règles : permet de reconnaître une intervention spontanée */
const RULE_TEXTS = new Set(loadPersonas().flatMap(persona => persona.spontaneous.map(rule => rule.text)))

let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_SPONTANEOUS_MINUTE_MS: '1000', NPC_REPLY_DELAY_MS: '100' })
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function spontaneousMessages(): Promise<Message[]> {
  const all: Message[] = await (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json()
  return all.filter(message => message.npc && RULE_TEXTS.has(message.text))
}

async function waitFor(author: string, timeoutMs: number): Promise<Message | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = (await spontaneousMessages()).find(message => message.author === author)
    if (found || Date.now() > deadline) return found
    await sleep(100)
  }
}

function adminState(headers: Record<string, string> = ADMIN) {
  return fetch(`${server.url}/api/admin/npcs`, { headers })
}

describe('interventions spontanées (035 CA6)', () => {
  beforeEach(async () => {
    expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
  })

  it('GET /api/admin/npcs renvoie spontaneous (true par défaut) ; 401 sans code ; POST {spontaneous} avec ou sans enabled', async () => {
    expect((await adminState({})).status).toBe(401)
    expect(await (await adminState()).json()).toMatchObject({ spontaneous: true })
    expect((await postJson(`${server.url}/api/admin/npcs`, { spontaneous: false })).status).toBe(401)
    expect((await postJson(`${server.url}/api/admin/npcs`, {}, ADMIN)).status).toBe(400)
    expect((await postJson(`${server.url}/api/admin/npcs`, { spontaneous: 'oui' }, ADMIN)).status).toBe(400)

    const off = await postJson(`${server.url}/api/admin/npcs`, { spontaneous: false }, ADMIN)
    expect(off.status).toBe(200)
    expect(await off.json()).toMatchObject({ spontaneous: false, enabled: false })
    const both = await postJson(`${server.url}/api/admin/npcs`, { enabled: true, spontaneous: true }, ADMIN)
    expect(await both.json()).toMatchObject({ spontaneous: true, enabled: true })

    // reset all remet l'interrupteur à true
    await postJson(`${server.url}/api/admin/npcs`, { spontaneous: false }, ADMIN)
    await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)
    expect(await (await adminState()).json()).toMatchObject({ spontaneous: true })
  })

  it('mot d\'une règle du CFO : message racine de Marc Lefort égal au texte ; règle « après » d\'un autre PNJ ; interrupteur coupé : plus rien', async () => {
    expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, { existingMessages: 'clear' }, ADMIN)).status).toBe(201)
    const post = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Bob', text: 'on a combien de clients bloqués sur le paiement ?' })
    expect(post.status).toBe(201)

    const cfo = await waitFor(CFO.name, 5000)
    expect(cfo).toMatchObject({ author: CFO.name, text: CFO_KEYWORDS_RULE.text, npc: { id: 'cfo' } })
    expect(cfo!.parentId).toBeUndefined()

    // « après » d'un autre PNJ (Inès Garnier, 9 min = 9 s ici)
    const communication = await waitFor(COMMUNICATION.name, 15_000)
    expect(communication).toMatchObject({ text: COMMUNICATION_AFTER.text })
    expect(communication!.parentId).toBeUndefined()

    // Coupé : les règles encore en attente (CEO « après », CFO « après ») ne partent plus
    expect((await postJson(`${server.url}/api/admin/npcs`, { spontaneous: false }, ADMIN)).status).toBe(200)
    const before = (await spontaneousMessages()).length
    await sleep(5000)
    expect((await spontaneousMessages()).length).toBe(before)
  })
})
