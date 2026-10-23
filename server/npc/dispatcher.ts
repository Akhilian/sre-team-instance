// Orchestrateur des PNJ : après chaque message publié, chaque PNJ actif mentionné (@Nom complet) répond
// dans le fil du message, après un délai simulé. Activation, plafonds de débit et garde-fous ici ;
// la formulation revient au retriever et au moteur injectés. Module pur, sur le modèle de
// scenario-runner.ts : planificateur, horloge et publication injectés.
import type { Message } from '../../shared/types/chat'
import type { KnowledgeRetriever, NpcPersona, NpcResponder, NpcSummary } from '../../shared/types/npc'
import { splitMentions } from '../../shared/utils/mentions'
import {
  NPC_MENTIONS_PER_MESSAGE_MAX,
  NPC_REPLIES_GLOBAL_PER_MINUTE,
  NPC_REPLIES_PER_MINUTE,
  NPC_REPLIES_PER_NPC_PER_MINUTE,
} from '../../shared/utils/limits'

/** Messages d'historique transmis au moteur au plus */
export const NPC_HISTORY_MAX = 10
/** Fenêtre glissante des plafonds de réponses */
const RATE_WINDOW_MS = 60_000
/** Au-delà, la réponse est abandonnée sans erreur (moteurs à modèle lents ou injoignables) */
export const NPC_RESPOND_TIMEOUT_MS = 15_000
/** Écart entre les réponses de plusieurs PNJ mentionnés dans un même message */
const NPC_STAGGER_MS = 700

export interface NpcReply {
  persona: NpcPersona
  channelId: string
  /** Racine du fil où répondre */
  parentId: string
  text: string
}

export interface NpcDispatcherDeps<Handle = unknown> {
  /** Appelle fn après delayMs millisecondes */
  schedule: (fn: () => void, delayMs: number) => Handle
  cancel?: (handle: Handle) => void
  /** Horloge en millisecondes epoch */
  now: () => number
  retriever: KnowledgeRetriever
  responder: NpcResponder
  /** Publie la réponse (addNpcMessage) ; une exception abandonne la réponse */
  publish: (reply: NpcReply) => void
  /** Fiches de tous les scénarios */
  personas: readonly NpcPersona[]
  /** Délai simulé avant chaque réponse (défaut 1500 ms) */
  delayMs?: () => number
  /** Messages récents du fil ou du canal, question comprise ou non (elle est retirée) */
  history?: (message: Message) => Message[]
  /** Échecs du moteur ou de la publication (défaut : une ligne sur console.error, sans trace de pile) */
  onError?: (error: unknown) => void
  /** Délai maximal du moteur (défaut NPC_RESPOND_TIMEOUT_MS) */
  respondTimeoutMs?: number
}

export interface NpcDispatcher {
  isEnabled: () => boolean
  /** Scénario dont les PNJ sont proposés (activés ou non) */
  scenarioId: () => string
  /** Active ou coupe les PNJ du scénario courant ; la coupure annule les réponses en attente */
  setEnabled: (enabled: boolean) => void
  /** Active les PNJ de scenarioId s'il en a ; sinon ne change rien et renvoie false */
  activateScenario: (scenarioId: string) => boolean
  /** PNJ du scénario courant, dans l'ordre des fiches */
  list: () => NpcSummary[]
  /** Fiche dont le nom (casse ignorée) est name, tous scénarios confondus */
  findByName: (name: string) => NpcPersona | undefined
  /** Planifie les réponses au message ; renvoie les ids des PNJ qui vont répondre */
  handle: (message: Message) => string[]
  /**
   * Annule les réponses en attente (planifiées ou en cours de formulation) : ni publication ni onError
   * ensuite. Appelée par la coupure et par le reset des messages (leurs fils ont disparu).
   */
  cancelPending: () => void
}

/** Une ligne de journal, sans trace de pile */
function logAbandoned(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
  console.error(`[npc] réponse abandonnée : ${message}`)
}

function summary(persona: NpcPersona): NpcSummary {
  return { id: persona.id, name: persona.name, role: persona.role }
}

export function createNpcDispatcher<Handle>(deps: NpcDispatcherDeps<Handle>): NpcDispatcher {
  const personas = deps.personas
  const onError = deps.onError ?? logAbandoned
  let currentScenarioId = personas[0]?.scenarioId ?? ''
  let enabled = false
  // Horodatages des réponses planifiées (fenêtre glissante d'une minute), par clé : `channelId` (tous PNJ
  // du canal) et `channelId:personaId` ; allReplies borne les appels au moteur, tous canaux confondus
  const repliesByKey = new Map<string, number[]>()
  let allReplies: number[] = []
  const pending = new Set<Handle>()
  // Incrémentée à chaque coupure : une réponse planifiée avant ne publie plus rien
  let generation = 0

  function active(): NpcPersona[] {
    return enabled ? personas.filter(persona => persona.scenarioId === currentScenarioId) : []
  }

  function cancelPending() {
    generation += 1
    if (deps.cancel) for (const handle of pending) deps.cancel(handle)
    pending.clear()
  }

  /** Horodatages encore dans la fenêtre pour key (les clés vides sont retirées) */
  function recent(key: string, since: number): number[] {
    const kept = (repliesByKey.get(key) ?? []).filter(at => at > since)
    if (kept.length === 0) repliesByKey.delete(key)
    else repliesByKey.set(key, kept)
    return kept
  }

  /** Vrai et compté si le PNJ peut encore répondre dans ce canal dans la minute */
  function takeRateSlot(persona: NpcPersona, channelId: string): boolean {
    const now = deps.now()
    const since = now - RATE_WINDOW_MS
    allReplies = allReplies.filter(at => at > since)
    const channelKey = channelId
    const npcKey = `${channelId}:${persona.id}`
    const inChannel = recent(channelKey, since)
    const own = recent(npcKey, since)
    if (
      own.length >= NPC_REPLIES_PER_NPC_PER_MINUTE
      || inChannel.length >= NPC_REPLIES_PER_MINUTE
      || allReplies.length >= NPC_REPLIES_GLOBAL_PER_MINUTE
    ) return false
    repliesByKey.set(channelKey, [...inChannel, now])
    repliesByKey.set(npcKey, [...own, now])
    allReplies.push(now)
    return true
  }

  /** PNJ actifs mentionnés, dans l'ordre du texte, sans doublon, au plus NPC_MENTIONS_PER_MESSAGE_MAX */
  function mentioned(text: string, candidates: readonly NpcPersona[]): NpcPersona[] {
    const byName = new Map(candidates.map(persona => [persona.name.toLowerCase(), persona]))
    const found: NpcPersona[] = []
    for (const segment of splitMentions(text, candidates.map(persona => persona.name))) {
      if (segment.type !== 'mention') continue
      const persona = byName.get(segment.name.toLowerCase())
      if (persona && !found.includes(persona)) found.push(persona)
    }
    return found.slice(0, NPC_MENTIONS_PER_MESSAGE_MAX)
  }

  /** Rejette si promise n'est pas réglée en ms ; le minuteur est annulé dès qu'elle l'est */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let handle: Handle | undefined
    const timeout = new Promise<never>((_, reject) => {
      handle = deps.schedule(() => reject(new Error(`moteur PNJ sans réponse après ${ms} ms`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => {
      if (handle !== undefined) deps.cancel?.(handle)
    })
  }

  async function reply(persona: NpcPersona, message: Message, parentId: string, history: Message[]) {
    // Récupération et formulation sous le même délai maximal (retriever ou moteur distants possibles)
    const text = await withTimeout(
      deps.retriever.retrieve(persona, message.text)
        .then(excerpts => deps.responder.respond({ persona, excerpts, history, question: message.text })),
      deps.respondTimeoutMs ?? NPC_RESPOND_TIMEOUT_MS,
    )
    return { persona, channelId: message.channelId, parentId, text }
  }

  return {
    isEnabled: () => enabled,
    scenarioId: () => currentScenarioId,

    setEnabled(next) {
      if (!next) cancelPending()
      enabled = next
    },

    activateScenario(scenarioId) {
      if (!personas.some(persona => persona.scenarioId === scenarioId)) return false
      if (scenarioId !== currentScenarioId) cancelPending()
      currentScenarioId = scenarioId
      enabled = true
      return true
    },

    list: () => personas.filter(persona => persona.scenarioId === currentScenarioId).map(summary),

    findByName(name) {
      const key = name.trim().toLowerCase()
      return key === '' ? undefined : personas.find(persona => persona.name.toLowerCase() === key)
    },

    handle(message) {
      // Jamais de réponse à un PNJ (pas de boucle), à une annonce ou à une alerte
      if (!enabled || message.npc || message.kind !== undefined) return []
      const targets = mentioned(message.text, active())
      if (targets.length === 0) return []

      const parentId = message.parentId ?? message.id
      const history = (deps.history?.(message) ?? [])
        .filter(candidate => candidate.id !== message.id)
        .slice(-NPC_HISTORY_MAX)
      const scheduled: string[] = []
      const startGeneration = generation
      targets.forEach((persona) => {
        if (!takeRateSlot(persona, message.channelId)) return
        const delay = (deps.delayMs?.() ?? 1500) + scheduled.length * NPC_STAGGER_MS
        const handle: Handle = deps.schedule(() => {
          pending.delete(handle)
          if (generation !== startGeneration || !enabled) return
          reply(persona, message, parentId, history)
            .then((result) => {
              // Coupés pendant que le moteur réfléchissait : rien n'est publié
              if (generation !== startGeneration || !enabled) return
              deps.publish(result)
            })
            .catch((error: unknown) => {
              // Annulée entre-temps : l'échec (fil effacé, moteur interrompu) est attendu, rien à signaler
              if (generation !== startGeneration || !enabled) return
              onError(error)
            })
        }, delay)
        pending.add(handle)
        scheduled.push(persona.id)
      })
      return scheduled
    },

    cancelPending,
  }
}
