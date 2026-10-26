// Orchestrateur des PNJ : après chaque message publié, chaque PNJ actif mentionné (@Nom complet) répond
// dans le fil du message, après un délai simulé ; une réponse en fil sans aucune mention s'adresse au PNJ
// qui a écrit le dernier message du fil ; dans une conversation directe, le PNJ de la conversation
// répond à tout message, sans mention. Plafond atteint : une réponse fixe « je reviens vers vous », au plus
// une fois par minute par PNJ et par canal. Activation, plafonds de débit et garde-fous ici ;
// la formulation revient au retriever et au moteur injectés. Module pur, sur le modèle de
// scenario-runner.ts : planificateur, horloge et publication injectés.
import type { Message } from '../../shared/types/chat'
import type { KnowledgeRetriever, NpcPersona, NpcResponder, NpcSummary } from '../../shared/types/npc'
import { namedPersons, splitMentions } from '../../shared/utils/mentions'
import { NPC_ACK_TEXTS, NPC_BUSY_REPLY } from './generic-phrases'
import type { Acknowledgement } from './pace'
import {
  NPC_CHANNEL_CONTEXT_MAX,
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
export { NPC_BUSY_REPLY }
/** Intervalle avant la réponse où la frappe reprend après un accusé */
const NPC_RETYPE_LEAD_MS = 8000
/** Accusés mémorisés par PNJ et canal (jamais deux fois la même formule) */
const NPC_ACKS_KEPT = NPC_ACK_TEXTS.length
/** Écart minimal entre deux réponses fixes d'un même PNJ dans un même canal */
const NPC_BUSY_WINDOW_MS = 60_000
/** Mention @… quelconque (PNJ ou humain) : @ en début de texte ou après une espace ou ponctuation, suivi d'un non-blanc */
const ANY_MENTION = /(?:^|[\s\p{P}\p{S}])@\S/u

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
  /** Scénario courant avant tout lancement (défaut, ou s'il n'a aucune fiche : celui de la première fiche) */
  initialScenarioId?: string
  /**
   * Délai avant la publication de chaque réponse (défaut 1500 ms), indicateur de frappe affiché dès la
   * sollicitation. Il court en même temps que la génération du modèle : la réponse part au plus tard des deux.
   */
  delayMs?: (persona: NpcPersona) => number
  /**
   * Accusé bref (« je regarde, je reviens vers vous ») publié avant une réponse lointaine ; already : formules
   * déjà dites par ce PNJ dans ce canal. Absent ou undefined : aucun accusé.
   */
  ack?: (persona: NpcPersona, delayMs: number, already: readonly string[]) => Acknowledgement | undefined
  /** Message système court dans le fil (ex. « X n'est pas dans ce scénario ») ; absent : aucun avis */
  notice?: (channelId: string, parentId: string | undefined, text: string) => void
  /** Messages récents du fil ou du canal, question comprise ou non (elle est retirée) */
  history?: (message: Message) => Message[]
  /**
   * Messages du canal lu par le PNJ (en conversation directe : le canal d'incident), du plus ancien au
   * plus récent, question et fil courant compris ou non (ils sont retirés) ; les NPC_CHANNEL_CONTEXT_MAX derniers sont transmis
   */
  channelContext?: (message: Message) => Message[]
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
  /**
   * Issues que le moteur ne voit pas (métriques) : `capped` (réponse fixe au plafond) et `timeout` (moteur
   * sans réponse dans le délai du dispatcher)
   */
  onReplyOutcome?: (outcome: 'capped' | 'timeout', persona: NpcPersona) => void
}

export interface NpcDispatcher {
  isEnabled: () => boolean
  /** Scénario dont les PNJ sont proposés (activés ou non) */
  scenarioId: () => string
  /** Active ou coupe les PNJ du scénario courant ; la coupure annule les réponses en attente */
  setEnabled: (enabled: boolean) => void
  /** Active les PNJ de scenarioId s'il en a ; sinon ne change rien et renvoie false */
  activateScenario: (scenarioId: string) => boolean
  /**
   * Coupe les PNJ et revient au scénario du démarrage (initialScenarioId, ou celui de la première fiche) ;
   * les réponses en attente sont annulées. Appelée par « Tout réinitialiser ».
   */
  resetScenario: () => void
  /** PNJ du scénario courant, dans l'ordre des fiches */
  list: () => NpcSummary[]
  /** Fiches des PNJ actifs (activés, scénario courant), dans l'ordre des fiches ; vide s'ils sont coupés */
  activePersonas: () => NpcPersona[]
  /**
   * Réserve une place dans le plafond global d'appels au modèle (NPC_REPLIES_GLOBAL_PER_MINUTE, canaux
   * d'équipe) pour une publication hors réponse, comme une intervention spontanée ; faux s'il est atteint
   */
  takeGlobalSlot: () => boolean
  /**
   * Remplace les fiches (rechargement à chaud) : l'état activé ou coupé est conservé, ainsi que le
   * scénario courant s'il a encore des fiches (sinon celui de la première fiche). Les réponses déjà
   * planifiées ne sont pas annulées (elles gardent la fiche d'avant).
   */
  replacePersonas: (personas: readonly NpcPersona[]) => void
  /** Fiche dont le nom (casse ignorée) est name, tous scénarios confondus */
  findByName: (name: string) => NpcPersona | undefined
  /**
   * Planifie les réponses au message ; renvoie les ids des PNJ qui vont répondre par le moteur (les
   * réponses fixes de plafond atteint, publiées tout de suite, n'y figurent pas)
   */
  handle: (message: Message) => string[]
  /**
   * Annule les réponses en attente (planifiées ou en cours de formulation) : ni publication ni onError
   * ensuite. Appelée par la coupure et par le reset des messages (leurs fils ont disparu).
   */
  cancelPending: () => void
}

/** Délai du dispatcher dépassé (distinct des échecs du moteur, pour les métriques) */
class NpcTimeoutError extends Error {}

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
  /** Scénario du démarrage : initialScenarioId s'il a des fiches, sinon celui de la première fiche */
  function initialScenarioId(): string {
    const initial = deps.initialScenarioId
    return initial !== undefined && personas.some(persona => persona.scenarioId === initial)
      ? initial
      : personas[0]?.scenarioId ?? ''
  }
  let currentScenarioId = initialScenarioId()
  let enabled = false
  // Horodatages des réponses planifiées (fenêtre glissante d'une minute), par clé : `channelId` (tous PNJ
  // du canal) et `channelId:personaId` ; allReplies (canaux d'équipe) et directReplies (conversations
  // directes, budget séparé) bornent les appels au moteur
  const repliesByKey = new Map<string, number[]>()
  // Dernière réponse fixe « sollicité de toutes parts », par `channelId:personaId` (hors budgets)
  const busyRepliesByKey = new Map<string, number>()
  // Accusés déjà publiés, par `channelId:personaId`
  const acksByKey = new Map<string, string[]>()
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

  /**
   * PNJ actifs interpellés, dans l'ordre du texte, sans doublon, au plus NPC_MENTIONS_PER_MESSAGE_MAX :
   * s'il y a une @mention d'une personne connue, seuls les PNJ @mentionnés ; sinon les PNJ nommés en clair
   * (« Claire, tu es là ? »). `others` : noms des auteurs du canal, pour détecter un prénom ambigu
   * (« @Claire » avec une Claire Martin au canal) ; tous les PNJ du scénario courant, actifs ou non, comptent aussi.
   */
  function mentioned(text: string, candidates: readonly NpcPersona[], others: readonly string[]): NpcPersona[] {
    const byName = new Map(candidates.map(persona => [persona.name.toLowerCase(), persona]))
    const scenarioNames = personas.filter(persona => persona.scenarioId === currentScenarioId).map(persona => persona.name)
    const known = [...scenarioNames, ...others]
    const segments = splitMentions(text, known)
    const names = segments.some(segment => segment.type === 'mention')
      ? segments.flatMap(segment => segment.type === 'mention' ? [segment.name] : [])
      : namedPersons(text, known)
    const found: NpcPersona[] = []
    for (const name of names) {
      const persona = byName.get(name.toLowerCase())
      if (persona && !found.includes(persona)) found.push(persona)
    }
    return found.slice(0, NPC_MENTIONS_PER_MESSAGE_MAX)
  }

  /** Noms des PNJ d'un autre scénario @mentionnés dans le texte (dans l'ordre, sans doublon) */
  function foreignMentions(text: string, others: readonly string[]): string[] {
    const foreign = personas.filter(persona => persona.scenarioId !== currentScenarioId).map(persona => persona.name)
    if (foreign.length === 0) return []
    const known = [...personas.filter(persona => persona.scenarioId === currentScenarioId).map(persona => persona.name), ...others, ...foreign]
    const names = splitMentions(text, known).flatMap(segment => segment.type === 'mention' ? [segment.name] : [])
    return [...new Set(names.filter(name => foreign.some(candidate => candidate.toLowerCase() === name.toLowerCase())))]
  }

  /** Avis « X n'est pas dans ce scénario », au plus un par minute pour un même nom dans un canal */
  function noticeForeign(message: Message, parentId: string | undefined, names: readonly string[]) {
    if (!deps.notice) return
    const now = deps.now()
    for (const name of names) {
      const key = `foreign:${message.channelId}:${name.toLowerCase()}`
      const last = busyRepliesByKey.get(key)
      if (last !== undefined && now - last < NPC_BUSY_WINDOW_MS) continue
      busyRepliesByKey.set(key, now)
      try {
        deps.notice(message.channelId, parentId, `${name} n'est pas dans ce scénario.`)
      }
      catch (error) {
        onError(error)
      }
    }
  }

  /**
   * Question à traiter : le texte du message, ou, s'il ne contient que des mentions (« @Julien ? »), la dernière
   * question du même auteur dans le canal (messages avec « ? » d'abord, sinon son dernier message).
   */
  function questionOf(message: Message, direct: boolean): string {
    const rest = splitMentions(message.text, personas.map(persona => persona.name))
      .map(segment => segment.type === 'text' ? segment.value : '')
      .join('')
    if (direct || /[\p{L}\p{N}]/u.test(rest)) return message.text
    const own = (deps.channelContext?.(message) ?? deps.history?.(message) ?? [])
      .filter(candidate => candidate.author === message.author && candidate.id !== message.id && candidate.rev < message.rev && candidate.kind === undefined && !candidate.npc)
      .filter(candidate => /[\p{L}\p{N}]/u.test(candidate.text))
    const previous = own.filter(candidate => candidate.text.includes('?')).at(-1) ?? own.at(-1)
    return previous ? previous.text : message.text
  }

  /**
   * Réponse implicite dans un fil d'équipe (H2) : le PNJ actif auteur du dernier message du fil avant
   * message (racine comprise), si message ne contient aucune mention @… ; sinon aucun.
   */
  function implicitTarget(message: Message, history: readonly Message[], candidates: readonly NpcPersona[]): NpcPersona[] {
    const rootId = message.parentId
    if (rootId === undefined || ANY_MENTION.test(message.text)) return []
    const last = history
      .filter(candidate => (candidate.id === rootId || candidate.parentId === rootId) && candidate.rev < message.rev)
      .at(-1)
    const persona = last?.npc ? candidates.find(candidate => candidate.id === last.npc!.id) : undefined
    return persona ? [persona] : []
  }

  /**
   * Plafond atteint : réponse fixe publiée sans moteur, au plus une fois par minute pour ce PNJ dans ce
   * canal ; hors budgets. Un échec de publication est signalé à onError.
   */
  function publishBusyReply(persona: NpcPersona, channelId: string, parentId: string | undefined) {
    const now = deps.now()
    const key = `${channelId}:${persona.id}`
    const last = busyRepliesByKey.get(key)
    if (last !== undefined && now - last < NPC_BUSY_WINDOW_MS) return
    busyRepliesByKey.set(key, now)
    deps.onReplyOutcome?.('capped', persona)
    const busy: NpcReply = { persona, channelId, text: NPC_BUSY_REPLY }
    if (parentId !== undefined) busy.parentId = parentId
    try {
      deps.publish(busy)
    }
    catch (error) {
      onError(error)
    }
  }

  /** Rejette si promise n'est pas réglée en ms ; le minuteur est annulé dès qu'elle l'est */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let handle: Handle | undefined
    const timeout = new Promise<never>((_, reject) => {
      handle = deps.schedule(() => reject(new NpcTimeoutError(`moteur PNJ sans réponse après ${ms} ms`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => {
      if (handle !== undefined) deps.cancel?.(handle)
    })
  }

  /** Contexte de lecture : derniers messages du canal, hors fil courant (celui de l'historique transmis) et hors question */
  function readChannel(message: Message, history: readonly Message[]): Message[] {
    const rootId = message.parentId ?? message.id
    const inHistory = new Set(history.map(candidate => candidate.id))
    return (deps.channelContext?.(message) ?? [])
      .filter(candidate => candidate.id !== message.id && candidate.id !== rootId && candidate.parentId !== rootId && !inHistory.has(candidate.id))
      .slice(-NPC_CHANNEL_CONTEXT_MAX)
  }

  async function reply(persona: NpcPersona, message: Message, question: string, parentId: string | undefined, history: Message[], peerReplies: Message[] = []): Promise<NpcReply> {
    // Récupération et formulation sous le même délai maximal (retriever ou moteur distants possibles)
    const text = await withTimeout(
      deps.retriever.retrieve(persona, question)
        .then(excerpts => deps.responder.respond({
          persona,
          excerpts,
          history,
          question,
          questionAuthor: message.author,
          channelContext: readChannel(message, history),
          ...(peerReplies.length > 0 ? { peerReplies } : {}),
        })),
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

    resetScenario() {
      cancelPending()
      enabled = false
      currentScenarioId = initialScenarioId()
    },

    list: () => personas.filter(persona => persona.scenarioId === currentScenarioId).map(summary),

    activePersonas: active,

    takeGlobalSlot() {
      const now = deps.now()
      allReplies = allReplies.filter(at => at > now - RATE_WINDOW_MS)
      if (allReplies.length >= NPC_REPLIES_GLOBAL_PER_MINUTE) return false
      allReplies.push(now)
      return true
    },

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
      const candidates = active()
      // Historique lu en canal d'équipe (prénom ambigu, réponse implicite) ou, plus bas, si une réponse est à planifier
      const readHistory = () => (deps.history?.(message) ?? []).filter(candidate => candidate.id !== message.id)
      let fullHistory = !direct && (message.parentId !== undefined || message.text.trim() !== '') ? readHistory() : []
      let targets = direct
        ? candidates.filter(persona => persona.id === directNpcId)
        : mentioned(message.text, candidates, fullHistory.map(candidate => candidate.author))
      if (targets.length > 0 && fullHistory.length === 0) fullHistory = readHistory()
      if (!direct && targets.length === 0) targets = implicitTarget(message, fullHistory, candidates)
      if (!direct) {
        if (fullHistory.length === 0) fullHistory = readHistory()
        const foreign = foreignMentions(message.text, fullHistory.map(candidate => candidate.author))
        if (foreign.length > 0) noticeForeign(message, message.parentId ?? message.id, foreign)
      }
      if (targets.length === 0) return []

      // En canal d'équipe, toujours dans le fil ; en conversation directe, à la racine pour un message racine
      const parentId = direct ? message.parentId : message.parentId ?? message.id
      const history = fullHistory.slice(-NPC_HISTORY_MAX)
      const question = questionOf(message, direct)
      const scheduled: string[] = []
      const startGeneration = generation
      // Génération séquentielle : la formulation de chaque cible attend celle de la précédente et en reçoit le texte
      const formulated: Message[] = []
      let chain: Promise<void> | undefined
      targets.forEach((persona) => {
        if (!takeRateSlot(persona, message.channelId, direct)) {
          publishBusyReply(persona, message.channelId, parentId)
          return
        }
        const delay = (deps.delayMs?.(persona) ?? 1500) + scheduled.length * NPC_STAGGER_MS
        const ackKey = `${message.channelId}:${persona.id}`
        const already = acksByKey.get(ackKey) ?? []
        const ack = deps.ack?.(persona, delay, already)
        // Frappe signalée dès la planification ; l'annulation (cancelPending) la termine aussi
        let token = startTyping(persona, message.channelId)
        const cancelled = () => generation !== startGeneration || !enabled
        // Le délai et la génération courent ensemble : publication quand les deux sont terminés
        let delayDone = false
        let result: NpcReply | undefined
        let failed = false
        let published = false
        const settle = () => {
          if (published || !delayDone || result === undefined) return
          published = true
          if (cancelled()) {
            stopTyping(token)
            return
          }
          stopTyping(token)
          try {
            deps.publish(result)
          }
          catch (error) {
            onError(error)
          }
        }
        const handle: Handle = deps.schedule(() => {
          pending.delete(handle)
          delayDone = true
          if (cancelled()) {
            stopTyping(token)
            return
          }
          settle()
        }, delay)
        pending.add(handle)
        if (ack) {
          const ackHandle: Handle = deps.schedule(() => {
            pending.delete(ackHandle)
            if (cancelled() || delayDone || failed || published) return
            acksByKey.set(ackKey, [...already, ack.text].slice(-NPC_ACKS_KEPT))
            const ackReply: NpcReply = { persona, channelId: message.channelId, text: ack.text }
            if (parentId !== undefined) ackReply.parentId = parentId
            // Pas de frappe entre l'accusé et le moment où la réponse approche
            stopTyping(token)
            try {
              deps.publish(ackReply)
            }
            catch (error) {
              onError(error)
            }
            const resumeIn = Math.max(1, delay - ack.atMs - NPC_RETYPE_LEAD_MS)
            const resume: Handle = deps.schedule(() => {
              pending.delete(resume)
              if (cancelled() || published || failed) return
              token = startTyping(persona, message.channelId)
            }, resumeIn)
            pending.add(resume)
            token = 0
          }, ack.atMs)
          pending.add(ackHandle)
        }
        const run = chain === undefined
          ? reply(persona, message, question, parentId, history)
          : chain.then(() => reply(persona, message, question, parentId, history, [...formulated]))
        chain = run.then((value) => {
          formulated.push({
            id: `peer-${persona.id}-${formulated.length}`,
            channelId: message.channelId,
            author: persona.name,
            text: value.text,
            createdAt: new Date(deps.now()).toISOString(),
            rev: message.rev + formulated.length + 1,
            npc: { id: persona.id, role: persona.role },
          })
        }, () => {})
        run
          .then((value) => {
            result = value
            settle()
          })
          .catch((error: unknown) => {
            failed = true
            published = true
            stopTyping(token)
            // Annulée entre-temps : l'échec (fil effacé, moteur interrompu) est attendu, rien à signaler
            if (cancelled()) return
            if (error instanceof NpcTimeoutError) deps.onReplyOutcome?.('timeout', persona)
            onError(error)
          })
        scheduled.push(persona.id)
      })
      return scheduled
    },

    cancelPending,
  }
}
