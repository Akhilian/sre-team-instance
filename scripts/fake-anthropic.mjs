// Faux serveur Anthropic (node:http, sans dépendance), pour essayer le moteur anthropic sans clé réelle :
// POST /v1/messages répond « [faux Claude] … ». Partagé par tests/http.
//   node scripts/fake-anthropic.mjs [port]     (ou PORT=…, défaut 11998, sur 127.0.0.1)
// puis NPC_ENGINE=anthropic, ANTHROPIC_API_KEY=<n'importe quelle valeur>, NPC_ANTHROPIC_BASE_URL=<URL affichée>
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const FAKE_CLAUDE_PREFIX = '[faux Claude]'

/**
 * Démarre le faux serveur. Réglages modifiables à chaud : status (200 par défaut ; autre valeur → erreur
 * renvoyée telle quelle), delayMs (attente avant de répondre). requests garde les appels reçus (en-têtes
 * x-api-key et anthropic-version, corps JSON).
 */
export function startFakeAnthropic({ port = 0, host = '127.0.0.1' } = {}) {
  const state = { status: 200, delayMs: 0, requests: [] }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"not_found_error"}}')
        return
      }
      let body = null
      try {
        body = JSON.parse(raw)
      }
      catch {
        // corps illisible : gardé à null
      }
      state.requests.push({
        url: req.url,
        apiKey: req.headers['x-api-key'],
        version: req.headers['anthropic-version'],
        contentType: req.headers['content-type'],
        body,
      })
      const reply = () => {
        if (res.destroyed) return
        if (state.status !== 200) {
          res.writeHead(state.status, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"api_error","message":"fake failure"}}')
          return
        }
        const messages = Array.isArray(body?.messages) ? body.messages : []
        const question = String(messages.at(-1)?.content ?? '').split('\n\n').at(-1).slice(0, 80)
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          id: 'msg_fake_1',
          type: 'message',
          role: 'assistant',
          model: body?.model ?? 'fake',
          content: [
            { type: 'text', text: `${FAKE_CLAUDE_PREFIX} Bien reçu : « ${question} ».` },
            { type: 'text', text: ' Je regarde de mon côté.' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
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
        baseUrl: `http://${host}:${actualPort}`,
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
  const port = Number(process.argv[2] ?? process.env.PORT ?? 11998)
  const fake = await startFakeAnthropic({ port })
  console.log(`faux serveur Anthropic sur ${fake.baseUrl}`)
  const shutdown = () => fake.stop().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
