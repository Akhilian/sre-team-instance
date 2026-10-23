// 018 CA1 / CA2 : CSP à nonce sur les pages du build, en-têtes communs sur toutes les réponses
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postJson, startServer, type TestServer } from './server'

let server: TestServer

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur' })
})
afterAll(() => server?.stop())

const CSP_DIRECTIVES = [
  `default-src 'self'`,
  `style-src 'self' 'unsafe-inline'`,
  `connect-src 'self'`,
  `img-src 'self' data:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
]

function expectCommonHeaders(response: Response) {
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(response.headers.get('x-frame-options')).toBe('DENY')
}

/** Nonce de la CSP, après contrôle des directives et des balises <script> de la page */
async function checkPage(path: string): Promise<string> {
  const response = await fetch(`${server.url}${path}`)
  expect(response.status).toBe(200)
  expectCommonHeaders(response)
  const csp = response.headers.get('content-security-policy') ?? ''
  for (const directive of CSP_DIRECTIVES) expect(csp.split('; ')).toContain(directive)
  const scriptSrc = csp.split('; ').find(directive => directive.startsWith('script-src ')) ?? ''
  const nonce = /^script-src 'self' 'nonce-([A-Za-z0-9+/=]+)'$/.exec(scriptSrc)?.[1]
  expect(nonce, scriptSrc).toBeTruthy()
  expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/)

  const html = await response.text()
  const tags = html.match(/<script\b[^>]*>/g) ?? []
  expect(tags.some(tag => tag.includes('type="importmap"'))).toBe(true)
  expect(html).toContain('window.__NUXT__')
  for (const tag of tags) expect(tag).toContain(`nonce="${nonce}"`)
  return nonce!
}

describe('CSP à nonce (B11)', () => {
  it('/channels/incident-en-cours et /admin : directives attendues, tous les <script> portent le nonce', async () => {
    await checkPage('/channels/incident-en-cours')
    await checkPage('/admin')
  })

  it('le nonce change d\'une requête à l\'autre', async () => {
    const first = await checkPage('/channels/incident-en-cours')
    const second = await checkPage('/channels/incident-en-cours')
    expect(second).not.toBe(first)
  })
})

describe('en-têtes communs (B11)', () => {
  it('page, /api/health, 404 d\'API et 413', async () => {
    expectCommonHeaders(await fetch(`${server.url}/channels/incident-en-cours`))
    expectCommonHeaders(await fetch(`${server.url}/api/health`))
    const notFound = await fetch(`${server.url}/api/channels/inconnu/messages`)
    expect(notFound.status).toBe(404)
    expectCommonHeaders(notFound)
    const tooLarge = await postJson(`${server.url}/api/channels/incident-en-cours/messages`, { author: 'x', text: 'a'.repeat(20_000) })
    expect(tooLarge.status).toBe(413)
    expectCommonHeaders(tooLarge)
  })
})
