// Moteur `openai-compatible` : tout serveur exposant POST /v1/chat/completions (Ollama, LM Studio, vLLM,
// llama.cpp…), appelé par le serveur avec le fetch natif (jamais par le navigateur). Au moindre échec
// (réseau, statut, délai, JSON, réponse vide), la réponse est celle du moteur de repli (keywords), avec
// une ligne de journal sans URL ni clé. fetch et logger injectables pour les tests.
import type { ModelCallOutcome, NpcRequest, NpcResponder } from '../../../shared/types/npc'
import { NPC_REPLY_MAX_LENGTH } from '../../../shared/utils/limits'
import type { Env } from '../../utils/env'
import { truncateText } from '../../utils/chat-store'
import { buildNpcPrompt } from '../prompt'
import { createKeywordsResponder } from './keywords'

/** Délai maximal d'un appel au modèle, sous celui du dispatcher (15 s) pour laisser place au repli */
export const NPC_LLM_TIMEOUT_DEFAULT_MS = 8000
const NPC_LLM_TIMEOUT_MAX_MS = 14_000
/** Réponses courtes et peu créatives : 2 à 4 phrases fidèles à la fiche */
const TEMPERATURE = 0.3
const MAX_TOKENS = 300

export interface OpenAiCompatibleOptions {
  /** URL de base de l'API, /v1 compris (ex. http://localhost:11434/v1) ; slash final toléré */
  baseUrl: string
  model: string
  /** Envoyée en Authorization: Bearer seulement si définie et non vide */
  apiKey?: string
  timeoutMs: number
  fetch?: typeof fetch
  /** Moteur utilisé quand le modèle fait défaut */
  fallback: NpcResponder
  logger: Pick<Console, 'warn'>
  /** Issue de chaque appel au modèle (réussi, ou échec et sa raison courte) */
  onOutcome?: (outcome: ModelCallOutcome) => void
}

/** Échec du modèle, avec une raison courte et sans donnée sensible, pour le journal */
class ModelUnavailable extends Error {}

/** Retire les blocs de raisonnement (<think>…</think>, même non refermés) des modèles qui en produisent */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
}

function contentOf(body: unknown): string {
  const choices = (body as { choices?: unknown } | null)?.choices
  const content = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
    : undefined
  return typeof content === 'string' ? stripThinking(content) : ''
}

export function createOpenAiCompatibleResponder(options: OpenAiCompatibleOptions): NpcResponder {
  const endpoint = `${options.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
  const apiKey = options.apiKey?.trim() ?? ''
  const doFetch = options.fetch ?? globalThis.fetch

  async function complete(request: NpcRequest): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`
    let response: Response
    let body: unknown
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: options.model,
          messages: buildNpcPrompt(request),
          stream: false,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) throw new ModelUnavailable(`HTTP ${response.status}`)
      const raw = await response.text()
      try {
        body = JSON.parse(raw)
      }
      catch {
        throw new ModelUnavailable('JSON invalide')
      }
    }
    catch (error) {
      if (error instanceof ModelUnavailable) throw error
      // Le message d'erreur du fetch peut contenir l'URL : seule une raison générique est gardée
      const name = (error as { name?: unknown } | null)?.name
      throw new ModelUnavailable(name === 'TimeoutError' || name === 'AbortError' ? 'délai dépassé' : 'erreur réseau')
    }
    const text = contentOf(body)
    if (text === '') throw new ModelUnavailable('réponse vide')
    return truncateText(text, NPC_REPLY_MAX_LENGTH)
  }

  return {
    async respond(request) {
      try {
        const text = await complete(request)
        options.onOutcome?.({ ok: true })
        return text
      }
      catch (error) {
        const reason = error instanceof ModelUnavailable ? error.message : 'erreur inattendue'
        options.onOutcome?.({ ok: false, reason })
        options.logger.warn(`[npc] openai-compatible indisponible (${reason}) : repli keywords`)
        return options.fallback.respond(request)
      }
    },
  }
}

/** NPC_LLM_TIMEOUT_MS : entier > 0 (plafonné à 14 s), sinon 8000 ; partagé par les moteurs à modèle */
export function timeoutFromEnv(env: Env): number {
  const raw = env.NPC_LLM_TIMEOUT_MS?.trim() ?? ''
  const value = Number(raw)
  if (raw === '' || !Number.isSafeInteger(value) || value <= 0) return NPC_LLM_TIMEOUT_DEFAULT_MS
  return Math.min(value, NPC_LLM_TIMEOUT_MAX_MS)
}

/** Fabrique du registre : lève une erreur (sans valeur sensible) si NPC_LLM_BASE_URL ou NPC_LLM_MODEL manque */
export function openAiCompatibleFromEnv(
  env: Env,
  logger: Pick<Console, 'warn'> = console,
  onOutcome?: (outcome: ModelCallOutcome) => void,
): NpcResponder {
  const baseUrl = env.NPC_LLM_BASE_URL?.trim() ?? ''
  const model = env.NPC_LLM_MODEL?.trim() ?? ''
  const missing = [baseUrl === '' && 'NPC_LLM_BASE_URL', model === '' && 'NPC_LLM_MODEL'].filter(Boolean)
  if (missing.length > 0) throw new Error(`${missing.join(' et ')} manquant`)
  return createOpenAiCompatibleResponder({
    baseUrl,
    model,
    apiKey: env.NPC_LLM_API_KEY,
    timeoutMs: timeoutFromEnv(env),
    fallback: createKeywordsResponder(),
    logger,
    onOutcome,
  })
}
