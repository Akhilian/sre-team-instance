// 042 : GET /api/health sur le build (version issue de package.json, champs existants conservés)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')) as { version: string }
let server: TestServer

beforeAll(async () => {
  server = await startServer()
})
afterAll(async () => {
  await server?.stop()
})

describe('GET /api/health', () => {
  it('renvoie la version de package.json et les champs existants', async () => {
    const res = await fetch(`${server.url}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.version).toBe('string')
    expect(body.version).toBe(pkg.version)
    expect(body.status).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    for (const k of ['storage', 'facilitatorCode', 'npcEngine']) expect(typeof body[k]).toBe('string')
  })
})
