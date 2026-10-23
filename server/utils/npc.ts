// Branchement des PNJ sur l'application : fiches embarquées (nitro.serverAssets, base assets:npc),
// moteur choisi par NPC_ENGINE, orchestrateur unique du processus (état activé en mémoire seulement)
// et publication dans le store des canaux. La logique pure vit dans server/npc/.
import type { Message } from '../../shared/types/chat'
import type { NpcAdminState, NpcPersona } from '../../shared/types/npc'
import { createNpcDispatcher, type NpcDispatcher } from '../npc/dispatcher'
import { type ResolvedNpcEngine, resolveNpcEngine } from '../npc/engines'
import { createLexicalRetriever } from '../npc/lexical-retriever'
import { PersonaParseError, parsePersona } from '../npc/persona-parser'
import { addNpcMessage, listMessages } from './chat-store'
import { processEnv } from './env'

/** Base unstorage des fiches : server/npc/personas/<scénario>/<id>.md */
const NPC_ASSETS_BASE = 'assets:npc'
/** Sans NPC_REPLY_DELAY_MS : délai tiré entre 1 et 2 s (1,5 s en moyenne) */
const NPC_REPLY_DELAY_MIN_MS = 1000
const NPC_REPLY_DELAY_SPREAD_MS = 1000

let engine: ResolvedNpcEngine | undefined
let dispatcher: Promise<NpcDispatcher> | undefined

/** Moteur du processus, résolu une fois (avertissement unique si NPC_ENGINE est inconnu) */
function npcEngine(): ResolvedNpcEngine {
  engine ??= resolveNpcEngine(processEnv())
  return engine
}

/** Nom du moteur en service, exposé par GET /api/health */
export function npcEngineName(): string {
  return npcEngine().name
}

/**
 * Fiches valides de tous les scénarios, triées par scénario puis par id. Une fiche invalide (ou dont
 * l'id ou le scénario ne correspond pas à son chemin, ou au nom déjà pris) est écartée avec une erreur
 * dans les logs.
 */
export async function loadNpcPersonas(): Promise<NpcPersona[]> {
  const storage = useStorage(NPC_ASSETS_BASE)
  const keys = (await storage.getKeys()).filter(key => key.endsWith('.md')).sort()
  const personas: NpcPersona[] = []
  for (const key of keys) {
    const path = key.replace(/:/g, '/')
    try {
      const raw = await storage.getItem(key)
      if (typeof raw !== 'string') throw new PersonaParseError(path, 'contenu illisible')
      const persona = parsePersona(raw, path)
      const [scenarioId, file] = key.split(':')
      if (`${persona.scenarioId}:${persona.id}.md` !== `${scenarioId}:${file}`) {
        throw new PersonaParseError(path, `id « ${persona.id} » ou scénario « ${persona.scenarioId} » différent du chemin`)
      }
      if (personas.some(other => other.name.toLowerCase() === persona.name.toLowerCase())) {
        throw new PersonaParseError(path, `nom « ${persona.name} » déjà pris par une autre fiche`)
      }
      personas.push(persona)
    }
    catch (error) {
      console.error('[npc] fiche écartée :', error instanceof Error ? error.message : error)
    }
  }
  return personas
}

/** Délai simulé : NPC_REPLY_DELAY_MS (entier ≥ 0) s'il est défini, sinon entre 1 et 2 s */
function replyDelayMs(): number {
  const raw = processEnv().NPC_REPLY_DELAY_MS?.trim() ?? ''
  const configured = Number(raw)
  if (raw !== '' && Number.isSafeInteger(configured) && configured >= 0) return configured
  return NPC_REPLY_DELAY_MIN_MS + Math.floor(Math.random() * NPC_REPLY_DELAY_SPREAD_MS)
}

/** Fil du message s'il est en fil, sinon fin du canal ; vide si le canal a disparu */
function recentHistory(message: Message): Message[] {
  try {
    const messages = listMessages(message.channelId)
    if (message.parentId === undefined) return messages
    return messages.filter(candidate => candidate.id === message.parentId || candidate.parentId === message.parentId)
  }
  catch {
    return []
  }
}

/** Orchestrateur du processus, créé au premier appel une fois les fiches chargées */
export function useNpcDispatcher(): Promise<NpcDispatcher> {
  dispatcher ??= loadNpcPersonas().then(personas => createNpcDispatcher({
    schedule: (fn, delayMs) => setTimeout(fn, delayMs),
    cancel: handle => clearTimeout(handle),
    now: () => Date.now(),
    retriever: createLexicalRetriever(),
    responder: npcEngine().responder,
    personas,
    delayMs: replyDelayMs,
    history: recentHistory,
    publish: reply => addNpcMessage(reply.channelId, {
      npc: reply.persona,
      text: reply.text,
      parentId: reply.parentId,
    }),
  }))
  return dispatcher
}

/** Planifie les réponses des PNJ mentionnés dans message (sans effet s'ils sont coupés). */
export async function dispatchNpcReplies(message: Message): Promise<void> {
  (await useNpcDispatcher()).handle(message)
}

/** Vrai si name est le nom d'un PNJ (casse ignorée), activé ou non : réservé aux PNJ. */
export async function isNpcName(name: unknown): Promise<boolean> {
  return typeof name === 'string' && (await useNpcDispatcher()).findByName(name) !== undefined
}

/** Active les PNJ du scénario lancé, s'il en a. */
export async function activateScenarioNpcs(scenarioId: string): Promise<void> {
  (await useNpcDispatcher()).activateScenario(scenarioId)
}

export async function setNpcsEnabled(enabled: boolean): Promise<void> {
  (await useNpcDispatcher()).setEnabled(enabled)
}

/** État complet pour /admin */
export async function npcAdminState(): Promise<NpcAdminState> {
  const current = await useNpcDispatcher()
  return {
    enabled: current.isEnabled(),
    npcs: current.list(),
    engine: npcEngineName(),
    scenarioId: current.scenarioId(),
  }
}
