// 033 CA4, 019 (bis) CA12-CA13, 019 CA8, 005 CA8 : prénom, nom en clair, aucun « PNJ » côté participant, combobox SSR
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer
const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur' })
  expect((await postJson(`${server.url}/api/admin/reset`, { scope: 'all' }, ADMIN)).status).toBe(200)
  expect((await postJson(`${server.url}/api/admin/scenarios/panne-checkout/start`, {}, ADMIN)).status).toBe(201)
})
afterAll(() => server?.stop())

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function messages(channel: string): Promise<Message[]> {
  return (await fetch(`${server.url}/api/channels/${channel}/messages`)).json()
}

async function ask(channel: string, text: string, author = 'Alice'): Promise<Message> {
  const response = await postJson(`${server.url}/api/channels/${channel}/messages`, { author, text })
  expect(response.status).toBe(201)
  return response.json()
}

async function replies(channel: string, parentId: string, waitMs: number, atLeast = 1): Promise<Message[]> {
  const deadline = Date.now() + waitMs
  for (;;) {
    const found = (await messages(channel)).filter(message => message.npc && message.parentId === parentId)
    if (found.length >= atLeast || Date.now() > deadline) return found
    await sleep(200)
  }
}

describe('mention par le prénom et nom en clair', () => {
  it('CA4 : « @Claire tu es là ? » fait répondre ceo en moins de 5 s', async () => {
    const root = await ask(CHANNEL, '@Claire tu es là ?')
    expect((await replies(CHANNEL, root.id, 5000))[0]).toMatchObject({ npc: { id: 'ceo' } })
  })

  it('CA4 : prénom ambigu après un message de Claire Martin', async () => {
    const created = await postJson(`${server.url}/api/channels`, { name: 'prenoms' })
    expect(created.status).toBe(201)
    const { id } = await created.json()
    await ask(id, 'bonjour', 'Claire Martin')
    const ambiguous = await ask(id, '@Claire tu es là ?')
    expect(await replies(id, ambiguous.id, 3000)).toEqual([])
    const full = await ask(id, '@Claire Dumont tu es là ?')
    expect((await replies(id, full.id, 5000))[0]).toMatchObject({ npc: { id: 'ceo' } })
  })

  it('019 CA12-CA13 : « Claire, tu es là ? » répond, sans surlignage ; « Claireval » non', async () => {
    const root = await ask(CHANNEL, 'Claire, tu es là ? (nom en clair)')
    expect((await replies(CHANNEL, root.id, 5000))[0]).toMatchObject({ npc: { id: 'ceo' } })
    const page = await (await fetch(`${server.url}/channels/${CHANNEL}`)).text()
    // Les mentions rendues commencent par « @ » (celle de « @Claire » plus haut) ; « Claire » en clair n'en est pas une
    expect(page).not.toMatch(/data-testid="mention"[^>]*>(?!@)/)
    expect(page).toContain('Claire, tu es là ? (nom en clair)')

    const glued = await ask(CHANNEL, 'Claireval est en panne')
    expect(await replies(CHANNEL, glued.id, 3000)).toEqual([])
  })
})

describe('aucun signalement côté participant (019 CA8) et combobox SSR (005 CA8)', () => {
  it('pages sans « PNJ » ni « non joueur », composeur combobox fermé', async () => {
    const julien = await ask(CHANNEL, '@Julien Moreau quel déploiement récent ?')
    expect((await replies(CHANNEL, julien.id, 5000))[0]).toMatchObject({ npc: { id: 'release-manager' } })
    expect((await postJson(`${server.url}/api/direct`, { participant: 'Alice', npcId: 'release-manager' })).status).toBeLessThan(300)
    const dm = 'dm-alice--release-manager'
    await ask(dm, 'Quel déploiement récent ?')
    await sleep(3000)
    for (const path of [CHANNEL, dm]) {
      const html = await (await fetch(`${server.url}/channels/${path}`)).text()
      expect(html).not.toMatch(/PNJ|non joueur/i)
    }
    const html = await (await fetch(`${server.url}/channels/${CHANNEL}`)).text()
    const textarea = html.match(/<textarea[^>]*data-testid="composer"[^>]*>/)?.[0] ?? ''
    expect(textarea).toContain('role="combobox"')
    expect(textarea).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="listbox"')
    expect((await messages(CHANNEL)).some(message => message.npc)).toBe(true)
  })
})
