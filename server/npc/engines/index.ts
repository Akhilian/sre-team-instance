// Registre des moteurs de réponse des PNJ, choisis par NPC_ENGINE. Ajouter un fournisseur
// (openai-compatible, anthropic avec ANTHROPIC_API_KEY…) = un fichier d'adaptateur dans ce dossier, qui implémente
// NpcResponder, et une ligne dans NPC_ENGINES. Module pur (environnement et logger injectés).
import type { ModelCallOutcome, NpcRequest, NpcResponder } from '../../../shared/types/npc'
import { type Env, processEnv } from '../../utils/env'
import { withoutRepeats } from '../anti-repeat'
import {
  failedCallOutcome,
  type LlmOutcome,
  type NpcOutcome,
  recordLlmCall,
  recordNpcEngineError,
  recordNpcGeneration,
  recordNpcReply,
  takeReplyOutcome,
} from '../../utils/war-room-metrics'
import { createKeywordsResponder } from './keywords'
import { openAiCompatibleFromEnv } from './openai-compatible'
import { ANTHROPIC_DEFAULT_MODEL, anthropicFromEnv } from './anthropic'

/**
 * Construit un moteur à partir de l'environnement (URL, modèle, clé d'API…). Configuration incomplète :
 * lève une erreur au message court, sans valeur sensible (le moteur par défaut est alors utilisé).
 */
export type NpcResponderFactory = (
  env: Env,
  logger: Pick<Console, 'warn'>,
  /** Issue de chaque appel au modèle (moteurs à modèle seulement) */
  onOutcome?: (outcome: ModelCallOutcome, request: NpcRequest) => void,
) => NpcResponder

export const NPC_ENGINES: Readonly<Record<string, NpcResponderFactory>> = {
  'keywords': () => createKeywordsResponder(),
  'openai-compatible': (env, logger, onOutcome) => withoutRepeats(openAiCompatibleFromEnv(env, logger, onOutcome), createKeywordsResponder()),
  'anthropic': (env, logger, onOutcome) => withoutRepeats(anthropicFromEnv(env, logger, onOutcome), createKeywordsResponder()),
}

export const DEFAULT_NPC_ENGINE = 'keywords'

export interface ResolvedNpcEngine {
  name: string
  /** Modèle configuré (NPC_LLM_MODEL, NPC_ANTHROPIC_MODEL) ; vide pour keywords */
  model: string
  responder: NpcResponder
}

/** Modèle du moteur d'après l'environnement : valeur de configuration, jamais issue d'un message */
export function modelOf(name: string, env: Env): string {
  if (name === 'openai-compatible') return env.NPC_LLM_MODEL?.trim() ?? ''
  if (name === 'anthropic') return env.NPC_ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL
  return ''
}

/**
 * Enveloppe commune des moteurs : métriques (041). Durée du seul appel au moteur (le délai de rythme du
 * dispatcher n'y entre jamais), issue de la réponse (ok, fallback, timeout, rejected_repeat) et, pour les
 * moteurs à modèle, mesures de l'appel (durée, débit effectif, tokens, tailles). Les interventions spontanées
 * ne comptent pas comme réponses.
 */
export function withMetrics(
  name: string,
  model: string,
  responder: NpcResponder,
  calls: WeakMap<object, ModelCallOutcome>,
): NpcResponder {
  return {
    async respond(request) {
      const started = performance.now()
      const text = await responder.respond(request)
      recordNpcGeneration(name, (performance.now() - started) / 1000)
      const rejected = takeReplyOutcome(request) === 'rejected_repeat'
      const call = calls.get(request)
      calls.delete(request)
      let outcome: NpcOutcome = rejected ? 'rejected_repeat' : 'ok'
      if (call) {
        let llm: LlmOutcome = rejected ? 'rejected_repeat' : 'ok'
        if (!call.ok) {
          llm = failedCallOutcome(call.reason)
          outcome = llm === 'timeout' ? 'timeout' : 'fallback'
          recordNpcEngineError(name, call.reason ?? '')
        }
        recordLlmCall(name, model, llm, call)
      }
      if (request.spontaneous === undefined) recordNpcReply(name, outcome)
      return text
    },
  }
}

/**
 * NPC_ENGINE absente ou vide : moteur par défaut ; inconnue ou mal configurée : moteur par défaut et
 * avertissement d'une ligne. name est le moteur effectivement en service.
 */
export function resolveNpcEngine(
  env: Env = processEnv(),
  logger: Pick<Console, 'warn'> = console,
  onOutcome?: (outcome: ModelCallOutcome, request: NpcRequest) => void,
): ResolvedNpcEngine {
  const requested = env.NPC_ENGINE?.trim() ?? ''
  if (requested !== '' && !Object.hasOwn(NPC_ENGINES, requested)) {
    logger.warn(`[npc] NPC_ENGINE « ${requested} » inconnu (disponibles : ${Object.keys(NPC_ENGINES).join(', ')}) : moteur ${DEFAULT_NPC_ENGINE} utilisé`)
  }
  const name = requested !== '' && Object.hasOwn(NPC_ENGINES, requested) ? requested : DEFAULT_NPC_ENGINE
  const calls = new WeakMap<object, ModelCallOutcome>()
  const hook = (outcome: ModelCallOutcome, request: NpcRequest) => {
    calls.set(request, outcome)
    onOutcome?.(outcome, request)
  }
  try {
    const model = modelOf(name, env)
    return { name, model, responder: withMetrics(name, model, NPC_ENGINES[name]!(env, logger, hook), calls) }
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(`[npc] moteur ${name} non configuré (${reason}) : moteur ${DEFAULT_NPC_ENGINE} utilisé`)
    return { name: DEFAULT_NPC_ENGINE, model: '', responder: withMetrics(DEFAULT_NPC_ENGINE, '', NPC_ENGINES[DEFAULT_NPC_ENGINE]!(env, logger), calls) }
  }
}
