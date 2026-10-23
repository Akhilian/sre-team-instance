// Moteur `anthropic` : API Messages de Claude (POST /v1/messages), appelée par le serveur avec le fetch
// natif, sans SDK. Même prompt que les autres moteurs à modèle (buildNpcPrompt), converti au format
// Anthropic (system à part, alternance stricte user/assistant). Ni temperature, ni top_p, ni top_k :
// Claude Haiku 5.5 renvoie 400 pour toute valeur autre que celle par défaut. La réflexion reste active
// (effort bas) et ses blocs sont ignorés. Au moindre échec (réseau, statut, délai, JSON, texte vide, refus,
// max_tokens sans texte), la réponse est celle du moteur de repli (keywords), avec une ligne de journal
// sans clé ni corps d'erreur. fetch et logger injectables pour les tests.
import type { ModelCallOutcome, NpcRequest, NpcResponder } from '../../../shared/types/npc'
import { NPC_REPLY_MAX_LENGTH } from '../../../shared/utils/limits'
import type { Env } from '../../utils/env'
import { truncateText } from '../../utils/chat-store'
import { buildNpcPrompt, type NpcPromptMessage } from '../prompt'
import { createKeywordsResponder } from './keywords'
import { timeoutFromEnv } from './openai-compatible'

export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-5-5'
const ANTHROPIC_VERSION = '2023-06-01'
/** La réflexion (active par défaut) compte dans max_tokens : marge pour elle et 2 à 4 phrases de réponse */
const MAX_TOKENS = 1024
/** Réflexion courte : la fiche suffit à répondre */
const OUTPUT_CONFIG = { effort: 'low' } as const
/** Tour user ajouté quand la conversation commence par un message du PNJ (l'API exige un user en tête) */
const CONVERSATION_START = '(Début de la conversation)'

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnthropicPrompt {
  system: string
  messages: AnthropicMessage[]
}

/**
 * Convertit le prompt commun au format Anthropic : les messages system vont dans system ; les messages
 * consécutifs du même rôle sont fusionnés (contenus joints par une ligne vide) ; un message user est
 * ajouté en tête si le premier est du PNJ. Fonction pure.
 */
export function toAnthropicMessages(prompt: readonly NpcPromptMessage[]): AnthropicPrompt {
  const system: string[] = []
  const messages: AnthropicMessage[] = []
  for (const entry of prompt) {
    if (entry.role === 'system') {
      system.push(entry.content)
      continue
    }
    const last = messages.at(-1)
    if (last?.role === entry.role) last.content = `${last.content}\n\n${entry.content}`
    else messages.push({ role: entry.role, content: entry.content })
  }
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: CONVERSATION_START })
  return { system: system.join('\n\n'), messages }
}

export interface AnthropicOptions {
  /** URL de base, sans /v1 (défaut https://api.anthropic.com) ; slash final toléré */
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  fetch?: typeof fetch
  /** Moteur utilisé quand l'API fait défaut */
  fallback: NpcResponder
  logger: Pick<Console, 'warn'>
  /** Issue de chaque appel à l'API (réussi, ou échec et sa raison courte) */
  onOutcome?: (outcome: ModelCallOutcome) => void
}

/** Échec de l'API, avec une raison courte et sans donnée sensible, pour le journal */
class ModelUnavailable extends Error {}

/** Concatène les blocs content[] de type text (les autres types sont ignorés) */
function textOf(body: unknown): string {
  const content = (body as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text', text: string } =>
      (block as { type?: unknown } | null)?.type === 'text' && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

export function createAnthropicResponder(options: AnthropicOptions): NpcResponder {
  const endpoint = `${options.baseUrl.trim().replace(/\/+$/, '')}/v1/messages`
  const doFetch = options.fetch ?? globalThis.fetch

  async function complete(request: NpcRequest): Promise<string> {
    const { system, messages } = toAnthropicMessages(buildNpcPrompt(request))
    let body: unknown
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: MAX_TOKENS,
          output_config: OUTPUT_CONFIG,
          system,
          messages,
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
    const stopReason = (body as { stop_reason?: unknown } | null)?.stop_reason
    if (stopReason === 'refusal') throw new ModelUnavailable('refus')
    const text = textOf(body)
    if (text === '') throw new ModelUnavailable(stopReason === 'max_tokens' ? 'max_tokens sans texte' : 'réponse vide')
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
        options.logger.warn(`[npc] anthropic indisponible (${reason}) : repli keywords`)
        return options.fallback.respond(request)
      }
    },
  }
}

/** Fabrique du registre : lève une erreur (sans valeur sensible) si ANTHROPIC_API_KEY manque ou est vide */
export function anthropicFromEnv(
  env: Env,
  logger: Pick<Console, 'warn'> = console,
  onOutcome?: (outcome: ModelCallOutcome) => void,
): NpcResponder {
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? ''
  if (apiKey === '') throw new Error('ANTHROPIC_API_KEY manquant')
  return createAnthropicResponder({
    baseUrl: env.NPC_ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_DEFAULT_BASE_URL,
    model: env.NPC_ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL,
    apiKey,
    timeoutMs: timeoutFromEnv(env),
    fallback: createKeywordsResponder(),
    logger,
    onOutcome,
  })
}
