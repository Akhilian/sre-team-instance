// Anti-répétition des PNJ (040) : un petit modèle recopie ses dernières phrases ou celles de l'historique.
// Une réponse identique (après normalisation) à l'une des dernières du même PNJ est rejetée au profit de
// l'extrait de fiche, puis du repli keywords. Module pur.
import type { NpcPersona, NpcRequest, NpcResponder } from '../../shared/types/npc'
import { NPC_ACK_TEXTS, NPC_BUSY_REPLY } from './generic-phrases'
import { allWords } from './lexical-retriever'
import { markReplyOutcome } from '../utils/war-room-metrics'

/** Dernières réponses du PNJ comparées à la nouvelle */
export const NPC_REPEAT_WINDOW = 3
/** Recouvrement de mots (Jaccard) à partir duquel deux textes sont « quasi identiques » */
export const NEAR_DUPLICATE_RATIO = 0.8
/** En dessous, seule l'égalité compte (deux messages très courts partagent vite tous leurs mots) */
const NEAR_DUPLICATE_MIN_WORDS = 5

/** Minuscules, sans accents ni ponctuation, espaces simples */
export function normalizeReply(text: string): string {
  return allWords(text).join(' ')
}

/** Accusés et réponse « sollicité » : jamais comptés ni réinjectés dans l'historique du modèle */
export function isSystemPhrase(text: string): boolean {
  const key = normalizeReply(text)
  return key === normalizeReply(NPC_BUSY_REPLY) || NPC_ACK_TEXTS.some(ack => normalizeReply(ack) === key)
}

/** Phrase générique de la fiche ou du système : n'apporte rien au modèle, qui la recopierait */
export function isGenericPhrase(text: string, persona: Pick<NpcPersona, 'deflection'>): boolean {
  return isSystemPhrase(text) || normalizeReply(text) === normalizeReply(persona.deflection)
}

export function isRepeat(text: string, previous: readonly string[]): boolean {
  const key = normalizeReply(text)
  return key !== '' && previous.some(candidate => normalizeReply(candidate) === key)
}

/** Identique ou quasi identique (recouvrement de mots ≥ NEAR_DUPLICATE_RATIO) à l'un des textes */
export function isNearDuplicate(text: string, previous: readonly string[]): boolean {
  const words = new Set(allWords(text))
  if (words.size === 0) return false
  return previous.some((candidate) => {
    const other = new Set(allWords(candidate))
    if (normalizeReply(text) === normalizeReply(candidate)) return true
    if (words.size < NEAR_DUPLICATE_MIN_WORDS || other.size < NEAR_DUPLICATE_MIN_WORDS) return false
    const common = [...words].filter(word => other.has(word)).length
    return common / (words.size + other.size - common) >= NEAR_DUPLICATE_RATIO
  })
}

/** Les NPC_REPEAT_WINDOW dernières réponses du PNJ (fil et canal lus), hors accusés et réponse « sollicité » */
export function recentOwnReplies(request: Pick<NpcRequest, 'persona' | 'history' | 'channelContext'>): string[] {
  const seen = new Set<string>()
  return [...request.history, ...(request.channelContext ?? [])]
    .filter(message => message.npc?.id === request.persona.id && !seen.has(message.id) && seen.add(message.id) && !isSystemPhrase(message.text))
    .sort((a, b) => a.rev - b.rev)
    .slice(-NPC_REPEAT_WINDOW)
    .map(message => message.text)
}

/**
 * Enveloppe un moteur à modèle : si sa réponse répète l'une des dernières du PNJ, on retombe sur le premier
 * extrait de fiche non répété, puis sur le repli. Les interventions spontanées ne sont pas concernées
 * (leur doublon est filtré à la publication).
 */
export function withoutRepeats(responder: NpcResponder, fallback: NpcResponder): NpcResponder {
  return {
    async respond(request) {
      const text = await responder.respond(request)
      if (request.spontaneous) return text
      const recent = recentOwnReplies(request)
      if (!isRepeat(text, recent)) return text
      markReplyOutcome(request, 'rejected_repeat')
      const fresh = request.excerpts.find(excerpt => !isRepeat(excerpt.text, recent))
      if (fresh) return fresh.text
      return fallback.respond(request)
    },
  }
}
