// Orchestrateur des PNJ : après chaque message publié, chaque PNJ actif mentionné (@Nom complet) répond
// dans le fil du message, après un délai simulé ; dans une conversation directe, le PNJ de la conversation
// répond à tout message, sans mention. Activation, plafonds de débit et garde-fous ici ;
// la formulation revient au retriever et au moteur injectés. Module pur, sur le modèle de
// scenario-runner.ts : planificateur, horloge et publication injectés.
import type { Message } from '../../shared/types/chat'
import type { KnowledgeRetriever, NpcPersona, NpcResponder, NpcSummary } from '../../shared/types/npc'
import { splitMentions } from '../../shared/utils/mentions'
import {
  NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE,
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
  /** Racine du fil où répondre ; absent pour une réponse racine (message racine d'une conversation directe) */
  parentId?: string
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
  /** Id du PNJ si channelId est une conversation directe, sinon undefined (défaut : aucune) */
  directNpcId?: (channelId: string) => string | undefined
  /**
   * Début (true, à la planification : couvre le délai simulé) et fin (false : publication, échec ou
   * annulation) de chaque réponse ; exactement une fin par début
   */
  onTyping?: (persona: NpcPersona, channelId: string, typing: boolean) => void
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
  /**
   * Remplace les fiches (rechargement à chaud) : l'état activé ou coupé est conservé, ainsi que le
   * scénario courant s'il a encore des fiches (sinon celui de la première fiche). Les réponses déjà
   * planifiées ne sont pas annulées (elles gardent la fiche d'avant).
   */
  replacePersonas: (personas: readonly NpcPersona[]) => void
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
  let personas = deps.personas
  const onError = deps.onError ?? logAbandoned
  let currentScenarioId = personas[0]?.scenarioId ?? ''
  let enabled = false
  // Horodatages des réponses planifiées (fenêtre glissante d'une minute), par clé : `channelId` (tous PNJ
  // du canal) et `channelId:personaId` ; allReplies (canaux d'équipe) et directReplies (conversations
  // directes, budget séparé) bornent les appels au moteur
  const repliesByKey = new Map<string, number[]>()
  let allReplies: number[] = []
  let directReplies: number[] = []
  const pending = new Set<Handle>()
  // Réponses en préparation dont la fin de frappe n'a pas encore été signalée, par jeton
  const typing = new Map<number, { persona: NpcPersona, channelId: string }>()
  let nextTypingToken = 1
  // Incrémentée à chaque coupure : une réponse planifiée avant ne publie plus rien
  let generation = 0

  function active(): NpcPersona[] {
    return enabled ? personas.filter(persona => persona.scenarioId === currentScenarioId) : []
  }

  function startTyping(persona: NpcPersona, channelId: string): number {
    const token = nextTypingToken++
    typing.set(token, { persona, channelId })
    deps.onTyping?.(persona, channelId, true)
    return token
  }

  /** Fin de frappe du jeton, signalée une seule fois (publication, échec ou annulation) */
  function stopTyping(token: number) {
    const entry = typing.get(token)
    if (!entry) return
    typing.delete(token)
    deps.onTyping?.(entry.persona, entry.channelId, false)
  }

  function cancelPending() {
    generation += 1
    if (deps.cancel) for (const handle of pending) deps.cancel(handle)
    pending.clear()
    for (const token of [...typing.keys()]) stopTyping(token)
  }

  /** Horodatages encore dans la fenêtre pour key (les clés vides sont retirées) */
  function recent(key: string, since: number): number[] {
    const kept = (repliesByKey.get(key) ?? []).filter(at => at > since)
    if (kept.length === 0) repliesByKey.delete(key)
    else repliesByKey.set(key, kept)
    return kept
  }

  /**
   * Vrai et compté si le PNJ peut encore répondre dans ce canal dans la minute. Une conversation directe
   * puise dans son propre budget global (NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE), pas dans celui des canaux
   * d'équipe ; les plafonds par canal et par PNJ s'y appliquent de la même façon.
   */
  function takeRateSlot(persona: NpcPersona, channelId: string, direct: boolean): boolean {
    const now = deps.now()
    const since = now - RATE_WINDOW_MS
    allReplies = allReplies.filter(at => at > since)
    directReplies = directReplies.filter(at => at > since)
    const budget = direct ? directReplies : allReplies
    const budgetMax = direct ? NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE : NPC_REPLIES_GLOBAL_PER_MINUTE
    const channelKey = channelId
    const npcKey = `${channelId}:${persona.id}`
    const inChannel = recent(channelKey, since)
    const own = recent(npcKey, since)
    if (
      own.length >= NPC_REPLIES_PER_NPC_PER_MINUTE
      || inChannel.length >= NPC_REPLIES_PER_MINUTE
      || budget.length >= budgetMax
    ) return false
    repliesByKey.set(channelKey, [...inChannel, now])
    repliesByKey.set(npcKey, [...own, now])
    budget.push(now)
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

  async function reply(persona: NpcPersona, message: Message, parentId: string | undefined, history: Message[]): Promise<NpcReply> {
    // Récupération et formulation sous le même délai maximal (retriever ou moteur distants possibles)
    const text = await withTimeout(
      deps.retriever.retrieve(persona, message.text)
        .then(excerpts => deps.responder.respond({ persona, excerpts, history, question: message.text })),
      deps.respondTimeoutMs ?? NPC_RESPOND_TIMEOUT_MS,
    )
    const result: NpcReply = { persona, channelId: message.channelId, text }
    if (parentId !== undefined) result.parentId = parentId
    return result
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

    replacePersonas(next) {
      personas = next
      if (!personas.some(persona => persona.scenarioId === currentScenarioId)) currentScenarioId = personas[0]?.scenarioId ?? ''
    },

    findByName(name) {
      const key = name.trim().toLowerCase()
      return key === '' ? undefined : personas.find(persona => persona.name.toLowerCase() === key)
    },

    handle(message) {
      // Jamais de réponse à un PNJ (pas de boucle), à une annonce ou à une alerte
      if (!enabled || message.npc || message.kind !== undefined) return []
      // Conversation directe : son PNJ répond sans mention, les mentions d'autres PNJ y sont ignorées.
      // Seul le propriétaire peut y écrire (vérifié par la route).
      const directNpcId = deps.directNpcId?.(message.channelId)
      const direct = directNpcId !== undefined
      const targets = direct
        ? active().filter(persona => persona.id === directNpcId)
        : mentioned(message.text, active())
      if (targets.length === 0) return []

      // En canal d'équipe, toujours dans le fil ; en conversation directe, à la racine pour un message racine
      const parentId = direct ? message.parentId : message.parentId ?? message.id
      const history = (deps.history?.(message) ?? [])
        .filter(candidate => candidate.id !== message.id)
        .slice(-NPC_HISTORY_MAX)
      const scheduled: string[] = []
      const startGeneration = generation
      targets.forEach((persona) => {
        if (!takeRateSlot(persona, message.channelId, direct)) return
        const delay = (deps.delayMs?.() ?? 1500) + scheduled.length * NPC_STAGGER_MS
        // Frappe signalée dès la planification ; l'annulation (cancelPending) la termine aussi
        const token = startTyping(persona, message.channelId)
        const handle: Handle = deps.schedule(() => {
          pending.delete(handle)
          if (generation !== startGeneration || !enabled) {
            stopTyping(token)
            return
          }
          reply(persona, message, parentId, history)
            .then((result) => {
              // Coupés pendant que le moteur réfléchissait : rien n'est publié
              if (generation !== startGeneration || !enabled) return
              stopTyping(token)
              deps.publish(result)
            })
            .catch((error: unknown) => {
              stopTyping(token)
              // Annulée entre-temps : l'échec (fil effacé, moteur interrompu) est attendu, rien à signaler
              if (generation !== startGeneration || !enabled) return
              onError(error)
            })
            .finally(() => stopTyping(token))
        }, delay)
        pending.add(handle)
        scheduled.push(persona.id)
      })
      return scheduled
    },

    cancelPending,
  }
}
