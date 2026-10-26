// Atelier type : 40 participants derrière une seule IP (wifi d'entreprise, NAT). En usage normal,
// mesuré sur le front (battement de présence toutes les 3 s, frappe au plus toutes les 2 s, messages,
// réactions, acquittements), aucun ne doit recevoir de 429.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'atelier' })
})
afterAll(() => server?.stop())

const PARTICIPANTS = 40
const NAT = { 'x-forwarded-for': '192.0.2.10' }

describe('40 participants derrière une même IP', () => {
  it('une fenêtre de 10 s d\'usage intense ne donne aucun 429', async () => {
    const names = Array.from({ length: PARTICIPANTS }, (_, index) => `Participant ${index + 1}`)
    const messagesUrl = `${server.url}/api/channels/incident-en-cours/messages`
    const presenceUrl = `${server.url}/api/presence`
    const statuses: number[] = []
    async function post(url: string, body: unknown): Promise<{ id?: string }> {
      const response = await postJson(url, body, NAT)
      statuses.push(response.status)
      return response.json().catch(() => ({}))
    }

    const alert = await postJson(`${server.url}/api/admin/alerts`, {
      channelId: 'incident-en-cours', severity: 'SEV1', title: 'Checkout KO', service: 'checkout-api', text: '5xx',
    }, { 'x-facilitator-code': 'atelier', ...NAT })
    expect(alert.status).toBe(201)
    const root = await post(messagesUrl, { author: names[0], text: 'Qui prend le lead ?' })

    // Par participant, sur la fenêtre : 5 frappes (≤ 1 / 2 s) et 4 battements (3 s) de présence ;
    // 4 messages, 1 réponse, 4 réactions, soit 9 écritures limitées (400 pour l'IP)
    for (let round = 0; round < 4; round++) {
      await Promise.all(names.map(async (name) => {
        await post(presenceUrl, { name, channelId: 'incident-en-cours', typing: true })
        await post(presenceUrl, { name, channelId: 'incident-en-cours' })
        await post(messagesUrl, { author: name, text: `point ${round}` })
        await post(`${messagesUrl}/${root.id}/reactions`, { emoji: '👍', author: name })
      }))
    }
    await Promise.all(names.map(async (name) => {
      await post(presenceUrl, { name, channelId: 'incident-en-cours', typing: true })
      await post(messagesUrl, { author: name, text: 'réponse', parentId: root.id })
    }))

    expect(statuses.filter(status => status === 429)).toHaveLength(0)
    expect(statuses).toHaveLength(1 + PARTICIPANTS * (4 * 4 + 2))
    // Jamais de 5xx
    expect(statuses.filter(status => status >= 500)).toHaveLength(0)
  })
})
