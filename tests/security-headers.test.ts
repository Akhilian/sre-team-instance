import { describe, expect, it } from 'vitest'
import { addScriptNonce, buildContentSecurityPolicy, generateNonce } from '../server/utils/security-headers'

describe('security-headers', () => {
  it('ajoute le nonce à chaque <script>, sans doubler un nonce existant', () => {
    const html = '<script type="importmap">{}</script><script>window.__NUXT__={}</script><script nonce="x"></script><scripts>'
    expect(addScriptNonce(html, 'abc')).toBe(
      '<script nonce="abc" type="importmap">{}</script><script nonce="abc">window.__NUXT__={}</script><script nonce="x"></script><scripts>',
    )
  })

  it('génère un nonce base64 différent à chaque appel', () => {
    const a = generateNonce()
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(generateNonce()).not.toBe(a)
  })

  it('CSP : script-src sans unsafe-inline ni unsafe-eval', () => {
    const csp = buildContentSecurityPolicy('n0nce')
    const scriptSrc = csp.split('; ').find(directive => directive.startsWith('script-src'))
    expect(scriptSrc).toBe(`script-src 'self' 'nonce-n0nce'`)
    expect(csp).toContain(`frame-ancestors 'none'`)
  })
})
