// Client serveur de DocShare (pannes injectables). Module pur : fetch injectable, config par environnement.
// Les messages d'erreur ne contiennent ni jeton ni URL : ils peuvent finir dans un log ou une réponse.
import { processEnv } from './env'
import type { Env } from './env'

export interface DocshareClientOptions {
  /** Absente ou vide : client désactivé, toute opération échoue */
  baseUrl?: string
  /** Envoyé en X-Ops-Token sur /ops/* uniquement (aucune route /ops appelée pour l'instant) */
  opsToken?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface DocshareClient {
  readonly enabled: boolean
  /** POST /admin/faults { name, value } */
  setFault: (name: string, value: number) => Promise<void>
  /** GET /admin/faults */
  getFaults: () => Promise<Record<string, number>>
}

export const DOCSHARE_TIMEOUT_MS = 3000

export class DocshareError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocshareError'
  }
}

export function createDocshareClient(options: DocshareClientOptions = {}): DocshareClient {
  const base = options.baseUrl?.trim().replace(/\/+$/, '') ?? ''
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DOCSHARE_TIMEOUT_MS

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    if (!base) throw new DocshareError('DocShare désactivé : DOCSHARE_BASE_URL absente')
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
    catch {
      throw new DocshareError('DocShare injoignable (réseau ou délai dépassé)')
    }
    if (!response.ok) throw new DocshareError(`DocShare a répondu HTTP ${response.status}`)
    return response
  }

  return {
    enabled: base !== '',
    async setFault(name, value) {
      await call('POST', '/admin/faults', { name, value })
    },
    async getFaults() {
      const response = await call('GET', '/admin/faults')
      try {
        const data = await response.json() as unknown
        return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, number> : {}
      }
      catch {
        throw new DocshareError('Réponse DocShare illisible')
      }
    },
  }
}

/** Client configuré par DOCSHARE_BASE_URL et DOCSHARE_OPS_TOKEN (lus à chaque appel) */
export function docshareClientFromEnv(env: Env = processEnv()): DocshareClient {
  return createDocshareClient({ baseUrl: env.DOCSHARE_BASE_URL, opsToken: env.DOCSHARE_OPS_TOKEN })
}
