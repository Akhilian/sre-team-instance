// Registre des moteurs de réponse des PNJ, choisis par NPC_ENGINE. Ajouter un fournisseur
// (openai-compatible, anthropic avec ANTHROPIC_API_KEY…) = un fichier d'adaptateur dans ce dossier, qui implémente
// NpcResponder, et une ligne dans NPC_ENGINES. Module pur (environnement et logger injectés).
import type { ModelCallOutcome, NpcResponder } from '../../../shared/types/npc'
import { type Env, processEnv } from '../../utils/env'
import { withoutRepeats } from '../anti-repeat'
import { createKeywordsResponder } from './keywords'
import { openAiCompatibleFromEnv } from './openai-compatible'
import { anthropicFromEnv } from './anthropic'

/**
 * Construit un moteur à partir de l'environnement (URL, modèle, clé d'API…). Configuration incomplète :
 * lève une erreur au message court, sans valeur sensible (le moteur par défaut est alors utilisé).
 */
export type NpcResponderFactory = (
  env: Env,
  logger: Pick<Console, 'warn'>,
  /** Issue de chaque appel au modèle (moteurs à modèle seulement) */
  onOutcome?: (outcome: ModelCallOutcome) => void,
) => NpcResponder

export const NPC_ENGINES: Readonly<Record<string, NpcResponderFactory>> = {
  'keywords': () => createKeywordsResponder(),
  'openai-compatible': (env, logger, onOutcome) => withoutRepeats(openAiCompatibleFromEnv(env, logger, onOutcome), createKeywordsResponder()),
  'anthropic': (env, logger, onOutcome) => withoutRepeats(anthropicFromEnv(env, logger, onOutcome), createKeywordsResponder()),
}

export const DEFAULT_NPC_ENGINE = 'keywords'

export interface ResolvedNpcEngine {
  name: string
  responder: NpcResponder
}

/**
 * NPC_ENGINE absente ou vide : moteur par défaut ; inconnue ou mal configurée : moteur par défaut et
 * avertissement d'une ligne. name est le moteur effectivement en service.
 */
export function resolveNpcEngine(
  env: Env = processEnv(),
  logger: Pick<Console, 'warn'> = console,
  onOutcome?: (outcome: ModelCallOutcome) => void,
): ResolvedNpcEngine {
  const requested = env.NPC_ENGINE?.trim() ?? ''
  if (requested !== '' && !Object.hasOwn(NPC_ENGINES, requested)) {
    logger.warn(`[npc] NPC_ENGINE « ${requested} » inconnu (disponibles : ${Object.keys(NPC_ENGINES).join(', ')}) : moteur ${DEFAULT_NPC_ENGINE} utilisé`)
  }
  const name = requested !== '' && Object.hasOwn(NPC_ENGINES, requested) ? requested : DEFAULT_NPC_ENGINE
  try {
    return { name, responder: NPC_ENGINES[name]!(env, logger, onOutcome) }
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn(`[npc] moteur ${name} non configuré (${reason}) : moteur ${DEFAULT_NPC_ENGINE} utilisé`)
    return { name: DEFAULT_NPC_ENGINE, responder: NPC_ENGINES[DEFAULT_NPC_ENGINE]!(env, logger) }
  }
}
