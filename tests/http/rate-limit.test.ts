// CA2 : 120 écritures par 10 s et par IP, puis 429 avec Retry-After ; présence et GET épargnés
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer

beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server?.stop())

describe('limiteur de débit (H2)', () => {
  it('130 POST de messages : 201 puis 429 avec Retry-After ; présence et GET restent 2xx', async () => {
    const url = `${server.url}/api/channels/general/messages`
    const statuses: number[] = []
    const retryAfter: (string | null)[] = []
    const sideStatuses: number[] = []
    for (let index = 1; index <= 130; index++) {
      const response = await postJson(url, { author: 'Rafale', text: `message ${index}` })
      statuses.push(response.status)
      retryAfter.push(response.headers.get('retry-after'))
      await response.arrayBuffer()
      if (index % 10 === 0) {
        const presence = await postJson(`${server.url}/api/presence`, { name: 'Rafale', channelId: 'general' })
        const channels = await fetch(`${server.url}/api/channels`)
        sideStatuses.push(presence.status, channels.status)
      }
    }
    expect(statuses.slice(0, 120).every(status => status === 201)).toBe(true)
    const refused = statuses.findIndex(status => status === 429)
    expect(refused).toBeGreaterThanOrEqual(120)
    expect(Number(retryAfter[refused])).toBeGreaterThanOrEqual(1)
    expect(Number(retryAfter[refused])).toBeLessThanOrEqual(10)
    expect(sideStatuses.length).toBe(26)
    expect(sideStatuses.every(status => status >= 200 && status < 300)).toBe(true)

    // Une autre IP (derrière le proxy Render) garde son propre compteur
    const other = await postJson(url, { author: 'Autre', text: 'bonjour' }, { 'x-forwarded-for': '203.0.113.7' })
    expect(other.status).toBe(201)
  })

  it('x-forwarded-for : seule la dernière entrée (celle du proxy) compte, la première est forgeable', async () => {
    const url = `${server.url}/api/channels/general/messages`
    const statuses: number[] = []
    for (let index = 1; index <= 125; index++) {
      // Première entrée différente à chaque requête : elle ne doit pas ouvrir un nouveau compteur
      const response = await postJson(url, { author: 'Forgeur', text: `m ${index}` }, { 'x-forwarded-for': `10.0.0.${index}, 198.51.100.4` })
      statuses.push(response.status)
      await response.arrayBuffer()
    }
    expect(statuses.slice(0, 120).every(status => status === 201)).toBe(true)
    expect(statuses.slice(120).every(status => status === 429)).toBe(true)
  })
})
