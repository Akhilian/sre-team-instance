// Registre des moteurs de réponse des PNJ, choisis par NPC_ENGINE. Ajouter un fournisseur
// (openai-compatible, anthropic…) = un fichier d'adaptateur dans ce dossier, qui implémente
// NpcResponder, et une ligne dans NPC_ENGINES. Module pur (environnement et logger injectés).
import type { NpcResponder } from '../../../shared/types/npc'
import { type Env, processEnv } from '../../utils/env'
import { createKeywordsResponder } from './keywords'

/** Construit un moteur à partir de l'environnement (URL, modèle, clé d'API…) */
export type NpcResponderFactory = (env: Env) => NpcResponder

export const NPC_ENGINES: Readonly<Record<string, NpcResponderFactory>> = {
  keywords: () => createKeywordsResponder(),
}

export const DEFAULT_NPC_ENGINE = 'keywords'

export interface ResolvedNpcEngine {
  name: string
  responder: NpcResponder
}

/** NPC_ENGINE absente ou vide : moteur par défaut ; inconnue : moteur par défaut et avertissement. */
export function resolveNpcEngine(
  env: Env = processEnv(),
  logger: Pick<Console, 'warn'> = console,
): ResolvedNpcEngine {
  const requested = env.NPC_ENGINE?.trim() ?? ''
  if (requested !== '' && !Object.hasOwn(NPC_ENGINES, requested)) {
    logger.warn(`[npc] NPC_ENGINE « ${requested} » inconnu (disponibles : ${Object.keys(NPC_ENGINES).join(', ')}) : moteur ${DEFAULT_NPC_ENGINE} utilisé`)
  }
  const name = requested !== '' && Object.hasOwn(NPC_ENGINES, requested) ? requested : DEFAULT_NPC_ENGINE
  return { name, responder: NPC_ENGINES[name]!(env) }
}
