// Métriques de l'application de paging (préfixe paging_) sur le registre maison de metrics.ts.
// Aucun label à forte cardinalité : ni id de participant, de message ou de canal, ni URL brute.
// Module pur (sans auto-import Nuxt) ; les points d'instrumentation (middleware HTTP, moteurs de PNJ,
// persistance) appellent les fonctions ci-dessous.
import { createRegistry, normalizeMethod, normalizeRoute, statusClass } from './metrics'
import { type Env, processEnv } from './env'
import { presentParticipants } from './presence-store'
import type { ModelCallOutcome } from '../../shared/types/npc'

export const registry = createRegistry()

const HTTP_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
const NPC_GENERATION_BUCKETS = [0.25, 0.5, 1, 2, 5, 10, 15, 30]

const httpRequests = registry.counter('paging_http_requests_total', 'Requêtes HTTP traitées, par méthode, route normalisée et classe de statut.', ['method', 'route', 'status_class'])
const httpDuration = registry.histogram('paging_http_request_duration_seconds', 'Durée des requêtes HTTP, par méthode et route normalisée.', ['method', 'route'], HTTP_BUCKETS)
const messagesPosted = registry.counter('paging_messages_posted_total', 'Messages publiés, par nature (human, npc, system).', ['kind'])
registry.gauge('paging_active_clients', 'Participants présents (battement de présence récent).', [], () => presentParticipants(Date.now()).length)
const npcReplies = registry.counter('paging_npc_replies_total', 'Réponses de PNJ par moteur et issue (ok, fallback, timeout, rejected_repeat, capped).', ['engine', 'outcome'])
const npcGeneration = registry.histogram('paging_npc_generation_duration_seconds', 'Durée du seul appel au moteur de PNJ (délai de rythme exclu).', ['engine'], NPC_GENERATION_BUCKETS)
const npcEngineErrors = registry.counter('paging_npc_engine_errors_total', 'Échecs d\'appel au moteur de PNJ, par raison (timeout, http, invalid).', ['engine', 'reason'])
const storageOps = registry.counter('paging_storage_operations_total', 'Opérations sur le stockage de persistance, par type et résultat.', ['op', 'result'])
const storageDuration = registry.histogram('paging_storage_operation_duration_seconds', 'Durée des opérations de stockage, par type.', ['op'], HTTP_BUCKETS)
const storageUp = registry.gauge('paging_storage_up', 'Dernier état connu du stockage de persistance (1 = opération réussie, 0 = échec).')

// Performance des moteurs à modèle (engine, model) : jamais d'écriture pour keywords
const LLM_LABELS = ['engine', 'model'] as const
const llmDuration = registry.histogram('paging_npc_llm_duration_seconds', 'Durée totale de l\'appel au modèle, par issue (ok, timeout, error, fallback, rejected_repeat).', ['engine', 'model', 'outcome'], [0.5, 1, 2, 5, 10, 15, 30, 60])
const llmTokensPerSecond = registry.histogram('paging_npc_llm_effective_tokens_per_second', 'Débit effectif bout en bout : tokens de sortie / durée totale de l\'appel (traitement du prompt compris), si au moins 2 tokens.', LLM_LABELS, [0.5, 1, 2, 5, 10, 20, 40])
const llmTokens = registry.counter('paging_npc_llm_tokens_total', 'Tokens lus dans usage de l\'API (jamais estimés), par direction.', ['engine', 'model', 'direction'])
const llmPromptChars = registry.histogram('paging_npc_llm_prompt_chars', 'Taille du prompt envoyé au modèle, en caractères.', LLM_LABELS, [500, 1000, 2000, 4000, 8000, 16000])
const llmResponseChars = registry.histogram('paging_npc_llm_response_chars', 'Taille de la réponse nettoyée du modèle, en caractères.', LLM_LABELS, [50, 100, 200, 400, 800])

/** /metrics et la sonde de santé n'entrent pas dans les métriques HTTP */
export function isHttpTracked(path: string): boolean {
  const clean = path.split('?')[0]!
  return clean !== '/metrics' && clean !== '/api/health'
}

export function recordHttp(input: { method: string, routePattern: string | undefined, status: number, seconds: number }): void {
  const method = normalizeMethod(input.method)
  const route = normalizeRoute(input.routePattern)
  httpRequests.inc({ method, route, status_class: statusClass(input.status) })
  httpDuration.observe({ method, route }, input.seconds)
}

export function recordMessagePosted(kind: 'human' | 'npc' | 'system'): void {
  messagesPosted.inc({ kind })
}

export type NpcOutcome = 'ok' | 'fallback' | 'timeout' | 'rejected_repeat' | 'capped'
export type NpcErrorReason = 'timeout' | 'http' | 'invalid'

/** Raison courte d'un échec de moteur (« délai dépassé », « HTTP 500 », « réponse vide »…) → label */
export function engineErrorReason(reason: string): NpcErrorReason {
  if (reason.startsWith('délai')) return 'timeout'
  if (reason.startsWith('HTTP') || reason.startsWith('erreur réseau')) return 'http'
  return 'invalid'
}

export function recordNpcReply(engine: string, outcome: NpcOutcome): void {
  npcReplies.inc({ engine, outcome })
}

export function recordNpcGeneration(engine: string, seconds: number): void {
  npcGeneration.observe({ engine }, seconds)
}

export function recordNpcEngineError(engine: string, reason: string): void {
  npcEngineErrors.inc({ engine, reason: engineErrorReason(reason) })
}

// Issue d'une réponse de PNJ, déposée par les enveloppes (moteur, anti-répétition) sur l'objet requête
// qui traverse toute la chaîne ; lue une fois par withReplyMetrics. Absente = ok.
const replyOutcomes = new WeakMap<object, NpcOutcome>()

export function markReplyOutcome(request: object, outcome: NpcOutcome): void {
  const current = replyOutcomes.get(request)
  // « rejected_repeat » prime sur un repli : la réponse finale n'est pas celle du modèle fautif
  if (current === 'rejected_repeat') return
  replyOutcomes.set(request, outcome)
}

export function takeReplyOutcome(request: object): NpcOutcome {
  const outcome = replyOutcomes.get(request) ?? 'ok'
  replyOutcomes.delete(request)
  return outcome
}

/** Valeurs distinctes de model au-delà desquelles tout devient `other` (cardinalité bornée) */
export const LLM_MODELS_MAX = 10
const seenModels = new Set<string>()

/** Label model : modèle configuré (une valeur par instance) ; au-delà de LLM_MODELS_MAX valeurs distinctes → other */
export function llmModelLabel(model: string): string {
  const value = model.trim().slice(0, 64) || 'inconnu'
  if (seenModels.has(value)) return value
  if (seenModels.size >= LLM_MODELS_MAX) return 'other'
  seenModels.add(value)
  return value
}

/** Retire les modèles mémorisés (tests) */
export function resetLlmModels(): void {
  seenModels.clear()
}

export type LlmOutcome = 'ok' | 'timeout' | 'error' | 'fallback' | 'rejected_repeat'

/** Issue d'un appel au modèle qui a échoué : délai dépassé, erreur réseau ou HTTP, ou réponse inexploitable (repli) */
export function failedCallOutcome(reason: string | undefined): Exclude<LlmOutcome, 'ok' | 'rejected_repeat'> {
  const text = reason ?? ''
  if (text.startsWith('délai')) return 'timeout'
  if (text.startsWith('HTTP') || text.startsWith('erreur réseau')) return 'error'
  return 'fallback'
}

/** Enregistre les mesures d'un appel au modèle (engine ≠ keywords) ; outcome tient compte du rejet anti-répétition */
export function recordLlmCall(engine: string, model: string, outcome: LlmOutcome, call: ModelCallOutcome): void {
  const labels = { engine, model: llmModelLabel(model) }
  const seconds = (call.durationMs ?? 0) / 1000
  if (call.durationMs !== undefined) llmDuration.observe({ ...labels, outcome }, seconds)
  if (call.ok && call.outputTokens !== undefined && call.outputTokens >= 2 && seconds > 0) llmTokensPerSecond.observe(labels, call.outputTokens / seconds)
  if (call.inputTokens !== undefined) llmTokens.inc({ ...labels, direction: 'input' }, call.inputTokens)
  if (call.outputTokens !== undefined) llmTokens.inc({ ...labels, direction: 'output' }, call.outputTokens)
  if (call.promptChars !== undefined) llmPromptChars.observe(labels, call.promptChars)
  if (call.responseChars !== undefined) llmResponseChars.observe(labels, call.responseChars)
}

/** Opération de stockage mesurée : résultat, durée et storage_up (dernier état connu) */
export async function trackStorage<T>(op: 'read' | 'write', call: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    const value = await call()
    storageOps.inc({ op, result: 'ok' })
    storageUp.set(undefined, 1)
    return value
  }
  catch (error) {
    storageOps.inc({ op, result: 'error' })
    storageUp.set(undefined, 0)
    throw error
  }
  finally {
    storageDuration.observe({ op }, (performance.now() - start) / 1000)
  }
}

/** METRICS_ENABLED=false (ou 0, off, no) coupe /metrics ; actif par défaut */
export function metricsEnabled(env: Env = processEnv()): boolean {
  return !['false', '0', 'off', 'no'].includes(env.METRICS_ENABLED?.trim().toLowerCase() ?? '')
}
