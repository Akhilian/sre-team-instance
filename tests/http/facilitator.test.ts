// CA4 / CA5 : code animateur généré en production (ou sans NODE_ENV), jamais exposé, « animateur » refusé
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type TestServer } from './server'

let server: TestServer | undefined

afterEach(async () => {
  await server?.stop()
  server = undefined
})

const LOG = /Code animateur généré : ([a-z0-9]+) — définissez FACILITATOR_CODE/g

function reset(code: string) {
  return fetch(`${server!.url}/api/admin/reset`, { method: 'POST', headers: { 'x-facilitator-code': code } })
}

async function expectGenerated(env: Record<string, string>) {
  server = await startServer(env)
  const healthText = await (await fetch(`${server.url}/api/health`)).text()
  const health = JSON.parse(healthText)
  expect(health.facilitatorCode).toBe('generated')

  const matches = [...server.stdout().matchAll(LOG)]
  expect(matches).toHaveLength(1)
  const code = matches[0]![1]!
  expect(code.length).toBeGreaterThanOrEqual(10)
  expect(healthText).not.toContain(code)

  expect((await reset('animateur')).status).toBe(401)
  expect((await reset(code)).status).toBe(200)
  // Toujours une seule ligne après des requêtes admin
  expect([...server.stdout().matchAll(LOG)]).toHaveLength(1)
}

describe('code animateur (H3)', () => {
  it('NODE_ENV=production sans FACILITATOR_CODE : code généré, journalisé une fois', async () => {
    await expectGenerated({ NODE_ENV: 'production' })
  })

  it('sans NODE_ENV ni FACILITATOR_CODE (startCommand Render) : code généré aussi', async () => {
    await expectGenerated({})
  })

  it('FACILITATOR_CODE=secret : source env, secret accepté, rien journalisé', async () => {
    server = await startServer({ NODE_ENV: 'production', FACILITATOR_CODE: 'secret' })
    const health = await (await fetch(`${server.url}/api/health`)).json()
    expect(health.facilitatorCode).toBe('env')
    expect(JSON.stringify(health)).not.toContain('secret')
    expect(server.stdout()).not.toContain('Code animateur généré')
    expect((await reset('animateur')).status).toBe(401)
    expect((await reset('secret')).status).toBe(200)
  })
})
