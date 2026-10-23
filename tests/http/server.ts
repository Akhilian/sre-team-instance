// Lance le build (node .output/server/index.mjs) sur un port libre, avec un environnement maîtrisé,
// et attend /api/health. Le fetch natif de Node suffit pour l'interroger : aucune dépendance de test.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const ENTRY = resolve(import.meta.dirname, '../../.output/server/index.mjs')

// Variables héritées qui changeraient le comportement testé (Vitest fixe NODE_ENV=test)
const CLEARED = ['NODE_ENV', 'FACILITATOR_CODE', 'REDIS_URL', 'CHAT_DATA_DIR', 'PORT', 'NITRO_PORT', 'HOST', 'NITRO_HOST']

export interface TestServer {
  url: string
  /** Sortie standard accumulée depuis le lancement */
  stdout: () => string
  stop: () => Promise<void>
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => done(port))
    })
  })
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((done) => {
    const force = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(force)
      done()
    })
    child.kill('SIGTERM')
  })
}

export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} introuvable : lancez npm run build avant npm run test:http`)
  const port = await freePort()
  const childEnv: Record<string, string | undefined> = { ...process.env }
  for (const key of CLEARED) delete childEnv[key]
  Object.assign(childEnv, { PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' }, env)

  const child = spawn(process.execPath, [ENTRY], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (chunk) => { stdout += chunk })
  child.stderr!.on('data', (chunk) => { stderr += chunk })

  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15_000
  while (true) {
    if (child.exitCode !== null) throw new Error(`serveur arrêté au démarrage (code ${child.exitCode}) : ${stderr}`)
    try {
      const response = await fetch(`${url}/api/health`)
      if (response.ok) break
    }
    catch {
      // pas encore à l'écoute
    }
    if (Date.now() > deadline) {
      await stopProcess(child)
      throw new Error(`/api/health ne répond pas : ${stderr}`)
    }
    await new Promise(done => setTimeout(done, 100))
  }

  return { url, stdout: () => stdout, stop: () => stopProcess(child) }
}

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
