// CA1 : corps de plus de 16 Ko refusé en 413 avant lecture, corps normal accepté
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer

beforeAll(async () => {
  server = await startServer()
})
afterAll(() => server?.stop())

const messagesUrl = () => `${server.url}/api/channels/incident-en-cours/messages`

describe('limite de corps (H1)', () => {
  it('refuse un message de 20 Ko en 413 et accepte le même de taille normale en 201', async () => {
    const big = await postJson(messagesUrl(), { author: 'x', text: 'a'.repeat(20_000) })
    expect(big.status).toBe(413)
    const normal = await postJson(messagesUrl(), { author: 'x', text: 'a'.repeat(200) })
    expect(normal.status).toBe(201)
  })

  it('accepte un corps de 16 384 octets exactement (texte trop long : 400, pas 413)', async () => {
    const prefix = JSON.stringify({ author: 'x', text: '' })
    const body = JSON.stringify({ author: 'x', text: 'a'.repeat(16_384 - prefix.length) })
    expect(new TextEncoder().encode(body).length).toBe(16_384)
    expect((await postJson(messagesUrl(), body)).status).toBe(400)
  })

  it('refuse en 413 un corps chunked sans content-length', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ author: 'x', text: 'petit' }))
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    })
    const response = await fetch(messagesUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(response.status).toBe(413)
  })

  it('s\'applique aussi aux routes admin et à la présence', async () => {
    const padding = 'a'.repeat(20_000)
    expect((await postJson(`${server.url}/api/presence`, { name: 'x', channelId: 'general', padding })).status).toBe(413)
    expect((await postJson(`${server.url}/api/admin/announcements`, { channelId: 'general', text: padding })).status).toBe(413)
  })
})
