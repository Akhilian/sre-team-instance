// Faux serveur OpenAI-compatible (node:http, sans dépendance), pour essayer le moteur openai-compatible
// sans modèle : POST /v1/chat/completions répond « [faux modèle] … ». Partagé par tests/http.
//   node scripts/fake-openai.mjs [port]     (ou PORT=…, défaut 11999, sur 127.0.0.1)
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const FAKE_MODEL_PREFIX = '[faux modèle]'

/**
 * Démarre le faux serveur. Réglages modifiables à chaud : status (200 par défaut ; autre valeur → erreur
 * renvoyée telle quelle), delayMs (attente avant de répondre). requests garde les appels reçus.
 */
export function startFakeOpenAi({ port = 0, host = '127.0.0.1' } = {}) {
  const state = { status: 200, delayMs: 0, requests: [] }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
        return
      }
      let body = null
      try {
        body = JSON.parse(raw)
      }
      catch {
        // corps illisible : gardé à null
      }
      state.requests.push({ url: req.url, authorization: req.headers.authorization, body })
      const reply = () => {
        if (res.destroyed) return
        if (state.status !== 200) {
          res.writeHead(state.status, { 'content-type': 'application/json' }).end('{"error":"fake failure"}')
          return
        }
        const messages = Array.isArray(body?.messages) ? body.messages : []
        const question = String(messages.at(-1)?.content ?? '').slice(0, 80)
        const content = `${FAKE_MODEL_PREFIX} Bien reçu : « ${question} ». Je regarde de mon côté.`
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          id: 'fake-1',
          object: 'chat.completion',
          model: body?.model ?? 'fake',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }))
      }
      if (state.delayMs > 0) setTimeout(reply, state.delayMs)
      else reply()
    })
  })

  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      done({
        state,
        port: actualPort,
        baseUrl: `http://${host}:${actualPort}/v1`,
        stop: () => new Promise((closed) => {
          server.closeAllConnections()
          server.close(() => closed())
        }),
      })
    })
  })
}

// Lancé directement : écoute jusqu'à SIGINT / SIGTERM
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 11999)
  const fake = await startFakeOpenAi({ port })
  console.log(`faux serveur OpenAI-compatible sur ${fake.baseUrl}`)
  const shutdown = () => fake.stop().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
