// Interventions spontanées des PNJ (035) : pendant un scénario, certains personnages suivent le canal
// d'incident et interviennent sans être sollicités (le CFO s'inquiète des pertes, le CEO réclame un point).
// Les règles viennent de la section « Intervient spontanément » des fiches. Le moteur évalue les règles à
// chaque message du canal et à un tic périodique (une « minute » / 4), publie un message racine signé du
// PNJ, et applique les garde-fous : une fois par règle et par lancement, 4 minutes entre deux interventions
// d'un même PNJ, 2 par minute au total. Module pur, sur le modèle de dispatcher.ts : horloge,
// planificateur, formulation et publication injectés.
import type { Message } from '../../shared/types/chat'
import type { NpcPersona, NpcSpontaneousRule } from '../../shared/types/npc'
import { NPC_SPONTANEOUS_GAP_MINUTES, NPC_SPONTANEOUS_PER_MINUTE } from '../../shared/utils/limits'
import { namedPersons, splitMentions } from '../../shared/utils/mentions'
import { allWords, triggerWordMatches } from './lexical-retriever'

/** Durée d'une « minute » des règles et des délais, par défaut (NPC_SPONTANEOUS_MINUTE_MS la fixe pour les tests) */
export const NPC_SPONTANEOUS_MINUTE_MS = 60_000
/** Un tic toutes les (minute / 4) : 15 s */
const TICKS_PER_MINUTE = 4
/** Délai maximal de la formulation par le modèle : au-delà, le texte de base est publié */
export const NPC_SPONTANEOUS_FORMULATE_TIMEOUT_MS = 15_000

/** Mots d'un point de situation (comparés sur mots entiers, pluriel toléré) */
const STATUS_WORDS = ['point', 'statut', 'status', 'update', 'situation', 'eta']
/** Expression d'un point de situation, mots à la suite */
const STATUS_PHRASES = [['mise', 'a', 'jour']]

export interface SpontaneousDeps<Handle = unknown> {
  /** Appelle fn après delayMs millisecondes */
  schedule: (fn: () => void, delayMs: number) => Handle
  cancel: (handle: Handle) => void
  /** Horloge en millisecondes epoch */
  now: () => number
  /** Durée d'une « minute » (défaut NPC_SPONTANEOUS_MINUTE_MS) */
  minuteMs?: number
  /** PNJ actifs (activés, scénario courant) ; vide si les PNJ sont coupés */
  personas: () => readonly NpcPersona[]
  /** Publie le message racine signé du PNJ dans le canal d'incident ; une exception l'abandonne */
  publish: (persona: NpcPersona, channelId: string, text: string) => void
  /** Formule le message à partir du texte de base (moteur à modèle) ; absent : le texte de base est publié tel quel */
  formulate?: (persona: NpcPersona, base: string, channelId: string) => Promise<string>
  /** Délai maximal de la formulation (défaut NPC_SPONTANEOUS_FORMULATE_TIMEOUT_MS) */
  formulateTimeoutMs?: number
  /** Réserve une place dans le plafond global d'appels au modèle ; faux : la règle attend */
  takeSlot?: () => boolean
  /** Délai simulé entre le déclenchement (début de frappe) et la publication (défaut 0) */
  delayMs?: () => number
  /** Début (true) et fin (false) de frappe : exactement une fin par début */
  onTyping?: (persona: NpcPersona, channelId: string, typing: boolean) => void
  /** Échec de publication (défaut : une ligne sur console.error) */
  onError?: (error: unknown) => void
}

export interface SpontaneousEngine {
  /** Interrupteur « Interventions spontanées » (actif par défaut) */
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  /** Scénario en cours dont channelId est le canal d'incident : remet à zéro les règles et lance le tic */
  start: (channelId: string) => void
  /** Scénario arrêté ou réinitialisé : plus aucune publication */
  stop: () => void
  isRunning: () => boolean
  /** Message publié (tout canal) : évalue les règles s'il s'agit d'un message humain du canal d'incident */
  onMessage: (message: Message) => void
  /** Annule les interventions en préparation (frappe comprise) sans arrêter le moteur */
  cancelPending: () => void
}

function logAbandoned(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
  console.error(`[npc] intervention spontanée abandonnée : ${message}`)
}

/** Les mots (ou expression à la suite) de phrase figurent dans words */
function containsPhrase(words: readonly string[], phrase: readonly string[], match: (a: string, b: string) => boolean): boolean {
  return words.some((_, start) => phrase.every((word, offset) => {
    const candidate = words[start + offset]
    return candidate !== undefined && match(word, candidate)
  }))
}

/** Mot de point de situation dans le texte (mots entiers, pluriel toléré) */
export function isStatusRequest(text: string): boolean {
  const words = allWords(text)
  const same = (a: string, b: string) => a === b || b === `${a}s`
  return STATUS_WORDS.some(word => words.some(candidate => same(word, candidate)))
    || STATUS_PHRASES.some(phrase => containsPhrase(words, phrase, same))
}

/** Un des mots de la règle figure dans le texte (même normalisation et tolérance de forme que le retriever) */
export function matchesKeywords(text: string, keywords: readonly string[]): boolean {
  const words = allWords(text)
  return keywords.some((keyword) => {
    const phrase = allWords(keyword)
    return phrase.length > 0 && containsPhrase(words, phrase, triggerWordMatches)
  })
}

export function createSpontaneousEngine<Handle>(deps: SpontaneousDeps<Handle>): SpontaneousEngine {
  const minuteMs = deps.minuteMs ?? NPC_SPONTANEOUS_MINUTE_MS
  const onError = deps.onError ?? logAbandoned
  let enabled = true
  let running = false
  let channelId = ''
  let startedAt = 0
  let lastStatusAt = 0
  // Règles (clé `personaId#index`) déjà déclenchées pendant ce lancement, et règles `mots` dont le message
  // déclencheur a été vu mais que les délais ont retenues
  let fired = new Set<string>()
  let armed = new Set<string>()
  let lastByNpc = new Map<string, number>()
  let recent: number[] = []
  let tickHandle: Handle | undefined
  const pending = new Set<Handle>()
  const typing = new Map<number, { persona: NpcPersona, channelId: string }>()
  let nextTypingToken = 1
  // Incrémentée à chaque arrêt ou annulation : une intervention préparée avant ne publie plus rien
  let generation = 0

  function startTyping(persona: NpcPersona): number {
    const token = nextTypingToken++
    typing.set(token, { persona, channelId })
    deps.onTyping?.(persona, channelId, true)
    return token
  }

  function stopTyping(token: number) {
    const entry = typing.get(token)
    if (!entry) return
    typing.delete(token)
    deps.onTyping?.(entry.persona, entry.channelId, false)
  }

  function cancelPending() {
    generation += 1
    for (const handle of pending) deps.cancel(handle)
    pending.clear()
    for (const token of [...typing.keys()]) stopTyping(token)
  }

  function isActive(persona: NpcPersona): boolean {
    return running && enabled && deps.personas().some(candidate => candidate.id === persona.id)
  }

  /** Rejette si promise n'est pas réglée en ms ; le minuteur est annulé dès qu'elle l'est */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let handle: Handle | undefined
    const timeout = new Promise<never>((_, reject) => {
      handle = deps.schedule(() => reject(new Error(`formulation sans réponse après ${ms} ms`)), ms)
    })
    return Promise.race([promise, timeout]).finally(() => {
      if (handle !== undefined) deps.cancel(handle)
    })
  }

  /** Texte à publier : la formulation du modèle, ou le texte de base si elle échoue, expire ou est vide */
  async function textFor(persona: NpcPersona, base: string): Promise<string> {
    if (!deps.formulate) return base
    try {
      const text = (await withTimeout(deps.formulate(persona, base, channelId), deps.formulateTimeoutMs ?? NPC_SPONTANEOUS_FORMULATE_TIMEOUT_MS)).trim()
      return text === '' ? base : text
    }
    catch {
      return base
    }
  }

  function launch(persona: NpcPersona, rule: NpcSpontaneousRule) {
    const startGeneration = generation
    const token = startTyping(persona)
    const handle: Handle = deps.schedule(() => {
      pending.delete(handle)
      if (generation !== startGeneration) {
        stopTyping(token)
        return
      }
      void textFor(persona, rule.text).then((text) => {
        stopTyping(token)
        // Coupé, arrêté ou réinitialisé pendant la formulation : rien n'est publié
        if (generation !== startGeneration || !isActive(persona)) return
        try {
          deps.publish(persona, channelId, text)
        }
        catch (error) {
          onError(error)
        }
      })
    }, deps.delayMs?.() ?? 0)
    pending.add(handle)
  }

  /** Déclenche la règle si les garde-fous le permettent ; faux : elle reste en attente */
  function tryFire(persona: NpcPersona, index: number): boolean {
    const key = `${persona.id}#${index}`
    if (fired.has(key) || !isActive(persona)) return false
    const now = deps.now()
    const last = lastByNpc.get(persona.id)
    if (last !== undefined && now - last < NPC_SPONTANEOUS_GAP_MINUTES * minuteMs) return false
    recent = recent.filter(at => at > now - minuteMs)
    if (recent.length >= NPC_SPONTANEOUS_PER_MINUTE) return false
    if (deps.takeSlot && !deps.takeSlot()) return false
    fired.add(key)
    armed.delete(key)
    lastByNpc.set(persona.id, now)
    recent.push(now)
    launch(persona, persona.spontaneous[index]!)
    return true
  }

  /** Vrai si le message nomme ce PNJ (@mention ou nom en clair) : il va répondre, pas de règle `mots` */
  function mentionsPersona(text: string, persona: NpcPersona, candidates: readonly NpcPersona[]): boolean {
    const known = candidates.map(candidate => candidate.name)
    const segments = splitMentions(text, known)
    const names = segments.some(segment => segment.type === 'mention')
      ? segments.flatMap(segment => segment.type === 'mention' ? [segment.name] : [])
      : namedPersons(text, known)
    return names.some(name => name.toLowerCase() === persona.name.toLowerCase())
  }

  /** Évalue toutes les règles non déclenchées ; message : le message humain qui vient d'être publié, s'il y en a un */
  function evaluate(message?: Message) {
    const now = deps.now()
    const candidates = deps.personas()
    for (const persona of candidates) {
      persona.spontaneous.forEach((rule, index) => {
        const key = `${persona.id}#${index}`
        if (fired.has(key)) return
        const { trigger } = rule
        if (trigger.type === 'keywords') {
          if (message && matchesKeywords(message.text, trigger.words) && !mentionsPersona(message.text, persona, candidates)) armed.add(key)
          if (armed.has(key)) tryFire(persona, index)
        }
        else if (trigger.type === 'after') {
          if (now - startedAt >= trigger.minutes * minuteMs) tryFire(persona, index)
        }
        else if (now - Math.max(startedAt, lastStatusAt) >= trigger.minutes * minuteMs) tryFire(persona, index)
      })
    }
  }

  function tick() {
    tickHandle = undefined
    if (!running) return
    evaluate()
    if (running) tickHandle = deps.schedule(tick, Math.max(1, Math.floor(minuteMs / TICKS_PER_MINUTE)))
  }

  function stop() {
    if (tickHandle !== undefined) deps.cancel(tickHandle)
    tickHandle = undefined
    running = false
    cancelPending()
    fired = new Set()
    armed = new Set()
    lastByNpc = new Map()
    recent = []
  }

  return {
    isEnabled: () => enabled,

    setEnabled(next) {
      if (!next) cancelPending()
      enabled = next
    },

    start(nextChannelId) {
      stop()
      running = true
      channelId = nextChannelId
      startedAt = deps.now()
      lastStatusAt = startedAt
      tickHandle = deps.schedule(tick, Math.max(1, Math.floor(minuteMs / TICKS_PER_MINUTE)))
    },

    stop,

    isRunning: () => running,

    onMessage(message) {
      // Jamais déclenchée par un PNJ, une annonce, une alerte, ni hors du canal d'incident (conversations directes comprises)
      if (!running || message.channelId !== channelId || message.npc || message.kind !== undefined) return
      if (isStatusRequest(message.text)) lastStatusAt = deps.now()
      evaluate(message)
    },

    cancelPending,
  }
}
