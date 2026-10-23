// En-têtes de sécurité : communs à toutes les réponses (pages, /api/*, erreurs comprises), et une CSP
// à nonce sur les pages HTML rendues par Nuxt. Le nonce est ajouté aux <script> que Nuxt génère
// (importmap, window.__NUXT__, charge utile, entrée) ; le corps rendu (contenu des participants)
// n'est jamais marqué. CSP absente sous nuxt dev : le client HMR de Vite injecte ses propres scripts.

// Sous-ensemble de la réponse Node utilisé ici (@types/node absent du projet)
interface NodeResponse {
  headersSent: boolean
  setHeader: (name: string, value: string) => unknown
  writeHead: (...args: unknown[]) => unknown
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    setResponseHeaders(event, SECURITY_HEADERS)
    // Le gestionnaire d'erreurs de Nitro (404, 413…) réécrit Referrer-Policy en no-referrer : nos
    // valeurs sont réimposées juste avant l'envoi des en-têtes (res.end appelle writeHead).
    const res = event.node.res as unknown as NodeResponse
    const writeHead = res.writeHead
    if (typeof writeHead !== 'function') return
    res.writeHead = function (this: NodeResponse, ...args: unknown[]) {
      if (!this.headersSent) {
        for (const [name, value] of Object.entries(SECURITY_HEADERS)) this.setHeader(name, value)
      }
      return writeHead.apply(this, args)
    }
  })

  if (import.meta.dev) return

  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = generateNonce()
    html.head = html.head.map(fragment => addScriptNonce(fragment, nonce))
    html.bodyPrepend = html.bodyPrepend.map(fragment => addScriptNonce(fragment, nonce))
    html.bodyAppend = html.bodyAppend.map(fragment => addScriptNonce(fragment, nonce))
    setResponseHeader(event, 'Content-Security-Policy', buildContentSecurityPolicy(nonce))
  })
})
