// Branchement des PNJ sur l'application : fiches lues dans NPC_PERSONAS_DIR ou embarquées (nitro.serverAssets,
// base assets:npc), rechargeables à chaud et modifiables en ligne (en mémoire) depuis /admin,
// moteur choisi par NPC_ENGINE, orchestrateur unique du processus (état activé en mémoire seulement)
// et publication dans le store des canaux. La logique pure vit dans server/npc/.
import type { Message } from '../../shared/types/chat'
import type { NpcAdminState, NpcPersona, NpcPersonaFileSummary, NpcPersonasAdminState } from '../../shared/types/npc'
import { createNpcDispatcher, type NpcDispatcher } from '../npc/dispatcher'
import { type ResolvedNpcEngine, resolveNpcEngine } from '../npc/engines'
import { createLexicalRetriever } from '../npc/lexical-retriever'
import { createPersonaLayer, type PersonaLayerResult } from '../npc/persona-overrides'
import {
  mergePersonaReload,
  type PersonaFile,
  type PersonaFs,
  type PersonaLoadError,
  type PersonaLoadResult,
  type PersonaReloadReport,
  type PersonaSourceKind,
  readEmbeddedPersonas,
  readPersonaDir,
} from '../npc/persona-source'
import { npcScenarioIdFor, SCENARIOS } from '../scenarios'
import { addNpcMessage, getChannel, listMessages } from './chat-store'
import { processEnv } from './env'
import { setNpcTyping } from './presence-store'

/** Base unstorage des fiches : server/npc/personas/<scénario>/<id>.md */
const NPC_ASSETS_BASE = 'assets:npc'
/** Sans NPC_REPLY_DELAY_MS : délai tiré entre 1 et 2 s (1,5 s en moyenne) */
const NPC_REPLY_DELAY_MIN_MS = 1000
const NPC_REPLY_DELAY_SPREAD_MS = 1000

let engine: ResolvedNpcEngine | undefined
let dispatcher: Promise<NpcDispatcher> | undefined
/** Fiches chargées par useNpcDispatcher(), pour les recherches synchrones (étapes de scénario) */
let loadedPersonas: readonly NpcPersona[] = []
/** Fiches lues à la source et fiches modifiées depuis /admin (en mémoire), gardées séparées */
const personaLayer = createPersonaLayer()
/** Fiches en service (source + modifiées), avec leur chemin et leur texte source (/admin), et la source en service */
let loadedFiles: readonly PersonaFile[] = []
let personaSource: PersonaSourceKind = 'embedded'

/** Recalcule les fiches en service depuis la couche ; sans effet sur le dispatcher */
function refreshLoadedPersonas() {
  loadedFiles = personaLayer.served()
  loadedPersonas = loadedFiles.map(file => file.persona)
}

/** Moteur du processus, résolu une fois (avertissement unique si NPC_ENGINE est inconnu) */
function npcEngine(): ResolvedNpcEngine {
  engine ??= resolveNpcEngine(processEnv())
  return engine
}

/** Nom du moteur en service, exposé par GET /api/health */
export function npcEngineName(): string {
  return npcEngine().name
}

/** Une ligne de journal par fiche écartée */
function logPersonaErrors(errors: readonly PersonaLoadError[]) {
  for (const error of errors) console.error('[npc] fiche écartée :', error.message)
}

/** NPC_PERSONAS_DIR si elle est définie et non vide (jamais influencée par une requête) */
function personasDir(): string | undefined {
  const dir = processEnv().NPC_PERSONAS_DIR?.trim()
  return dir ? dir : undefined
}

/** fs/promises de Node (le projet n'a pas @types/node : import non résolu par TypeScript) */
async function nodeFs(): Promise<PersonaFs> {
  return await import('node:fs/promises' as string) as PersonaFs
}

/** Relit la source kind : le dossier NPC_PERSONAS_DIR ou les fiches embarquées */
async function readPersonaSource(kind: PersonaSourceKind): Promise<PersonaLoadResult> {
  const dir = personasDir()
  if (kind === 'dir' && dir !== undefined) return readPersonaDir(dir, await nodeFs())
  return readEmbeddedPersonas(useStorage(NPC_ASSETS_BASE))
}

/**
 * Fiches du démarrage : le dossier NPC_PERSONAS_DIR s'il est défini et contient au moins une fiche
 * valide, sinon les fiches embarquées (avertissement d'une ligne). Les fiches invalides sont écartées
 * avec une erreur dans les logs.
 */
async function loadInitialPersonas(): Promise<{ source: PersonaSourceKind, files: PersonaFile[] }> {
  if (personasDir() !== undefined) {
    const result = await readPersonaSource('dir')
    logPersonaErrors(result.errors)
    if (result.files.length > 0) return { source: 'dir', files: result.files }
    console.warn('[npc] NPC_PERSONAS_DIR absent, illisible ou sans fiche valide : fiches embarquées utilisées')
  }
  const result = await readPersonaSource('embedded')
  logPersonaErrors(result.errors)
  return { source: 'embedded', files: result.files }
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
  dispatcher ??= loadInitialPersonas().then(({ source, files }) => {
    personaSource = source
    personaLayer.setSource(files)
    refreshLoadedPersonas()
    const personas = loadedPersonas
    return createNpcDispatcher({
      schedule: (fn, delayMs) => setTimeout(fn, delayMs),
      cancel: handle => clearTimeout(handle),
      now: () => Date.now(),
      retriever: createLexicalRetriever(),
      responder: npcEngine().responder,
      personas,
      // Sans lancement, les PNJ proposés sont ceux du premier scénario de /admin, pas ceux de la première fiche par chemin
      initialScenarioId: SCENARIOS[0]?.id,
      delayMs: replyDelayMs,
      history: recentHistory,
      directNpcId: channelId => getChannel(channelId)?.direct?.npcId,
      onTyping: (persona, channelId, typing) => setNpcTyping({ channelId, name: persona.name, typing }, Date.now()),
      publish: reply => addNpcMessage(reply.channelId, {
        npc: reply.persona,
        text: reply.text,
        parentId: reply.parentId,
      }),
    })
  })
  return dispatcher
}

/**
 * Fiche d'id npcId parmi toutes les fiches chargées (tous scénarios), activées ou non ; undefined si
 * elle est inconnue ou si useNpcDispatcher() n'a pas encore fini de charger les fiches.
 */
export function findLoadedNpcPersona(npcId: string): NpcPersona | undefined {
  return loadedPersonas.find(persona => persona.id === npcId)
}

/**
 * PNJ d'id npcId parmi ceux du scénario courant (activés ou non) ; undefined s'il n'en fait pas partie.
 * Renvoie aussi l'état d'activation, pour POST /api/direct.
 */
export async function currentScenarioNpc(npcId: string): Promise<{ persona: NpcPersona | undefined, enabled: boolean }> {
  const current = await useNpcDispatcher()
  const known = current.list().some(npc => npc.id === npcId)
  return {
    persona: known ? loadedPersonas.find(persona => persona.id === npcId && persona.scenarioId === current.scenarioId()) : undefined,
    enabled: current.isEnabled(),
  }
}

/** Planifie les réponses des PNJ mentionnés dans message (sans effet s'ils sont coupés). */
export async function dispatchNpcReplies(message: Message): Promise<void> {
  (await useNpcDispatcher()).handle(message)
}

/** Vrai si name est le nom d'un PNJ (casse ignorée), activé ou non : réservé aux PNJ. */
export async function isNpcName(name: unknown): Promise<boolean> {
  return typeof name === 'string' && (await useNpcDispatcher()).findByName(name) !== undefined
}

/** Active les PNJ du scénario lancé (ceux de son npcScenarioId), s'il en a. */
export async function activateScenarioNpcs(scenarioId: string): Promise<void> {
  (await useNpcDispatcher()).activateScenario(npcScenarioIdFor(scenarioId))
}

/** « Tout réinitialiser » : PNJ coupés et ramenés au scénario du démarrage (le premier de /admin) */
export async function resetNpcs(): Promise<void> {
  (await useNpcDispatcher()).resetScenario()
}

export async function setNpcsEnabled(enabled: boolean): Promise<void> {
  (await useNpcDispatcher()).setEnabled(enabled)
}

/** Annule les réponses en attente sans couper les PNJ (reset des messages : leurs fils ont disparu). */
export async function cancelPendingNpcReplies(): Promise<void> {
  (await useNpcDispatcher()).cancelPending()
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

/** Fiches chargées pour /admin, avec leur texte source ; tous scénarios */
export async function npcPersonaFiles(): Promise<NpcPersonasAdminState> {
  await useNpcDispatcher()
  return {
    source: personaSource,
    personas: loadedFiles.map(personaFileSummary),
  }
}

function personaFileSummary({ path, markdown, persona }: PersonaFile): NpcPersonaFileSummary {
  return {
    path,
    id: persona.id,
    name: persona.name,
    role: persona.role,
    scenarioId: persona.scenarioId,
    markdown,
    modified: personaLayer.isModified(path),
  }
}

export type NpcPersonaEditOutcome =
  | { ok: true, persona: NpcPersonaFileSummary }
  | Extract<PersonaLayerResult, { ok: false }>

/** Applique le résultat d'une édition ou d'un retour : fiches en service recalculées et remplacées à chaud */
async function applyLayerResult(result: PersonaLayerResult): Promise<NpcPersonaEditOutcome> {
  if (!result.ok) return result
  const current = await useNpcDispatcher()
  refreshLoadedPersonas()
  current.replacePersonas(loadedPersonas)
  return { ok: true, persona: personaFileSummary(result.file) }
}

/**
 * Remplace en mémoire la fiche en service path par markdown (026), si elle passe la validation ; rien
 * ne change sinon. path n'est qu'une clé comparée aux fiches en service, jamais un chemin de fichier.
 */
export async function editNpcPersona(path: string, markdown: string): Promise<NpcPersonaEditOutcome> {
  await useNpcDispatcher()
  return applyLayerResult(personaLayer.edit(path, markdown))
}

/** Supprime la version modifiée de path et remet la fiche de la source */
export async function revertNpcPersona(path: string): Promise<NpcPersonaEditOutcome> {
  await useNpcDispatcher()
  return applyLayerResult(personaLayer.revert(path))
}

/**
 * Relit la source en service (jamais changée à chaud) et remplace les fiches du dispatcher ; une fiche
 * en erreur garde sa version précédente. Sans aucune fiche valide, rien n'est remplacé (replaced faux).
 * Les fiches modifiées depuis /admin restent prioritaires sur la source relue.
 */
export async function reloadNpcPersonas(): Promise<{ replaced: boolean, report: PersonaReloadReport }> {
  const current = await useNpcDispatcher()
  const source = personaSource
  const result = await readPersonaSource(source)
  logPersonaErrors(result.errors)
  const outcome = mergePersonaReload(personaLayer.source(), result, source)
  if (outcome.replaced) {
    personaLayer.setSource(outcome.files)
    refreshLoadedPersonas()
    current.replacePersonas(loadedPersonas)
  }
  return { replaced: outcome.replaced, report: outcome.report }
}
