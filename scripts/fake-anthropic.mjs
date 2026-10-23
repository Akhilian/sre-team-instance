// Faux serveur Anthropic (node:http, sans dépendance), pour essayer le moteur anthropic sans clé réelle :
// POST /v1/messages répond « [faux Claude] … ». Strict comme Claude Haiku 5.5 : temperature, top_p ou top_k
// dans le corps → 400 invalid_request_error. Partagé par tests/http.
//   node scripts/fake-anthropic.mjs [port]     (ou PORT=…, défaut 11998, sur 127.0.0.1)
//   FAKE_ANTHROPIC_MODE=text|thinking|max_tokens|refusal (défaut text), ou à chaud :
//   curl -X POST http://127.0.0.1:11998/__mode -d '{"mode":"max_tokens"}'
// puis NPC_ENGINE=anthropic, ANTHROPIC_API_KEY=<n'importe quelle valeur>, NPC_ANTHROPIC_BASE_URL=<URL affichée>
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const FAKE_CLAUDE_PREFIX = '[faux Claude]'
/** Formes de réponse : texte seul, réflexion puis texte, réflexion seule coupée par max_tokens, refus */
export const FAKE_ANTHROPIC_MODES = ['text', 'thinking', 'max_tokens', 'refusal']
/** Paramètres d'échantillonnage refusés par Claude Haiku 5.5 */
const SAMPLING_FIELDS = ['temperature', 'top_p', 'top_k']

const THINKING_BLOCK = { type: 'thinking', thinking: '', signature: 'fake-signature' }

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
}

/** content et stop_reason de la réponse selon le mode */
function replyShape(mode, question) {
  const text = [
    { type: 'text', text: `${FAKE_CLAUDE_PREFIX} Bien reçu : « ${question} ».` },
    { type: 'text', text: ' Je regarde de mon côté.' },
  ]
  if (mode === 'thinking') return { content: [THINKING_BLOCK, ...text], stop_reason: 'end_turn' }
  if (mode === 'max_tokens') return { content: [THINKING_BLOCK], stop_reason: 'max_tokens' }
  if (mode === 'refusal') return { content: [], stop_reason: 'refusal' }
  return { content: text, stop_reason: 'end_turn' }
}

/**
 * Démarre le faux serveur. Réglages modifiables à chaud : status (200 par défaut ; autre valeur → erreur
 * renvoyée telle quelle), delayMs (attente avant de répondre), mode (forme de la réponse, voir
 * FAKE_ANTHROPIC_MODES ; aussi POST /__mode {mode}). requests garde les appels reçus (en-têtes x-api-key et
 * anthropic-version, corps JSON), refusés compris.
 */
export function startFakeAnthropic({ port = 0, host = '127.0.0.1', mode = 'text' } = {}) {
  const state = { status: 200, delayMs: 0, mode, requests: [] }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      // Route de test locale : change le mode à chaud
      if (req.method === 'POST' && req.url === '/__mode') {
        let next
        try {
          next = JSON.parse(raw)?.mode
        }
        catch {
          // corps illisible : mode refusé ci-dessous
        }
        if (!FAKE_ANTHROPIC_MODES.includes(next)) {
          json(res, 400, { error: `mode attendu : ${FAKE_ANTHROPIC_MODES.join(', ')}` })
          return
        }
        state.mode = next
        json(res, 200, { mode: next })
        return
      }
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
        const sampling = SAMPLING_FIELDS.find(field => body && typeof body === 'object' && Object.hasOwn(body, field))
        if (sampling) {
          json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: `${sampling}: unsupported for this model` } })
          return
        }
        if (state.status !== 200) {
          res.writeHead(state.status, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"api_error","message":"fake failure"}}')
          return
        }
        const messages = Array.isArray(body?.messages) ? body.messages : []
        const question = String(messages.at(-1)?.content ?? '').split('\n\n').at(-1).slice(0, 80)
        json(res, 200, {
          id: 'msg_fake_1',
          type: 'message',
          role: 'assistant',
          model: body?.model ?? 'fake',
          ...replyShape(state.mode, question),
          usage: { input_tokens: 1, output_tokens: 1 },
        })
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
  const envMode = process.env.FAKE_ANTHROPIC_MODE?.trim()
  const fake = await startFakeAnthropic({ port, mode: FAKE_ANTHROPIC_MODES.includes(envMode) ? envMode : 'text' })
  console.log(`faux serveur Anthropic sur ${fake.baseUrl} (mode ${fake.state.mode})`)
  const shutdown = () => fake.stop().then(() => process.exit(0))
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
