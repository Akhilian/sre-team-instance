import { describe, expect, it, vi } from 'vitest'
import { createDocshareClient, docshareClientFromEnv } from '../server/utils/docshare-client'

const TOKEN = 'jeton-secret-xyz'

function client(fetchImpl: typeof fetch, baseUrl: string | null = 'http://docshare.internal:8080/') {
  return createDocshareClient({ baseUrl: baseUrl ?? undefined, opsToken: TOKEN, fetch: fetchImpl })
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  }
  catch (error) {
    return (error as Error).message
  }
  throw new Error('devait rejeter')
}

describe('docshare-client', () => {
  it('setFault envoie POST /admin/faults avec le corps JSON, sans le jeton', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    await client(fetchMock as unknown as typeof fetch).setFault('upload_latency', 3)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://docshare.internal:8080/admin/faults')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"name":"upload_latency","value":3}')
    expect(JSON.stringify(init.headers ?? {})).not.toContain(TOKEN)
  })

  it('getFaults envoie GET /admin/faults et renvoie le corps', async () => {
    const fetchMock = vi.fn(async () => new Response('{"upload_latency":3}', { status: 200 }))
    const faults = await client(fetchMock as unknown as typeof fetch).getFaults()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://docshare.internal:8080/admin/faults')
    expect(init.method).toBe('GET')
    expect(faults).toEqual({ upload_latency: 3 })
  })

  it('rejette proprement sans base, sur HTTP non 2xx et sur erreur réseau, sans fuite', async () => {
    const never = vi.fn()
    const disabled = client(never as unknown as typeof fetch, null)
    expect(disabled.enabled).toBe(false)
    await expect(disabled.setFault('a', 1)).rejects.toThrow()
    expect(never).not.toHaveBeenCalled()

    const http500 = client((async () => new Response('boom', { status: 500 })) as typeof fetch)
    const net = client((async () => { throw new Error(`connect ECONNREFUSED http://docshare.internal:8080/admin/faults ${TOKEN}`) }) as typeof fetch)
    for (const promise of [http500.setFault('a', 1), http500.getFaults(), net.setFault('a', 1), net.getFaults(), disabled.getFaults()]) {
      const message = await messageOf(promise)
      expect(message).not.toContain(TOKEN)
      expect(message).not.toContain('docshare.internal')
      expect(message).not.toContain('http://')
    }
  })

  it('docshareClientFromEnv est désactivé sans DOCSHARE_BASE_URL', () => {
    expect(docshareClientFromEnv({}).enabled).toBe(false)
    expect(docshareClientFromEnv({ DOCSHARE_BASE_URL: 'http://x' }).enabled).toBe(true)
  })
})

describe('docshare-client : routes /ops (055 CA1)', () => {
  it('indexCheck, startReindex et getReindex envoient la bonne route avec X-Ops-Token', async () => {
    const fetchMock = vi.fn(async () => new Response('{"summary":"ok","state":"running","processed":2,"total":9}', { status: 200 }))
    const c = client(fetchMock as unknown as typeof fetch)
    expect((await c.indexCheck()).summary).toBe('ok')
    expect(await c.startReindex()).toMatchObject({ state: 'running', processed: 2, total: 9 })
    expect((await c.getReindex()).total).toBe(9)
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET http://docshare.internal:8080/ops/index-check',
      'POST http://docshare.internal:8080/ops/reindex',
      'GET http://docshare.internal:8080/ops/reindex',
    ])
    for (const [, init] of calls) expect((init.headers as Record<string, string>)['x-ops-token']).toBe(TOKEN)
  })

  it('les erreurs ne contiennent ni jeton ni URL', async () => {
    const never = vi.fn()
    const disabled = client(never as unknown as typeof fetch, null)
    const http500 = client((async () => new Response('boom', { status: 500 })) as typeof fetch)
    const net = client((async () => { throw new Error(`ECONNREFUSED http://docshare.internal:8080 ${TOKEN}`) }) as typeof fetch)
    for (const c of [disabled, http500, net]) {
      for (const promise of [c.indexCheck(), c.startReindex(), c.getReindex()]) {
        const message = await messageOf(promise)
        expect(message).not.toContain(TOKEN)
        expect(message).not.toContain('docshare.internal')
        expect(message).not.toContain('http://')
      }
    }
    expect(never).not.toHaveBeenCalled()
  })
})
