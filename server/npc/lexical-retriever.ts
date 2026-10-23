// Retriever lexical (« RAG » minimal, sans modèle) : recouvrement de mots entre la question et chaque puce
// de la fiche. Remplaçable par un retriever à embeddings derrière la même interface KnowledgeRetriever.
// Module pur et déterministe.
import type { KnowledgeExcerpt, KnowledgeRetriever, NpcPersona } from '../../shared/types/npc'

/** Extraits retenus au plus */
export const EXCERPTS_MAX = 2
/** Longueur minimale pour qu'un mot en préfixe un autre (coût / coûte, récent / récente) */
const PREFIX_MIN_LENGTH = 4
/** Écart de longueur toléré entre un mot et son préfixe (terminaisons) */
const PREFIX_MAX_SUFFIX = 3

// Mots vides français, sans accents, et formules de politesse qui ne portent aucune information
const STOP_WORDS = new Set([
  'a', 'ai', 'aie', 'as', 'au', 'aux', 'avec', 'avez', 'avons', 'c', 'ca', 'ce', 'ces', 'cet', 'cette', 'd', 'dans',
  'de', 'des', 'du', 'elle', 'en', 'est', 'et', 'etait', 'ete', 'etre', 'eu', 'il', 'ils', 'j', 'je', 'l', 'la', 'le',
  'les', 'leur', 'lui', 'm', 'ma', 'mais', 'me', 'mes', 'moi', 'mon', 'n', 'ne', 'ni', 'nos', 'notre', 'nous', 'on',
  'ont', 'ou', 'par', 'pas', 'peu', 'peut', 'peux', 'plus', 'pour', 'qu', 'que', 'quel', 'quelle', 'quelles', 'quels',
  'qui', 'quoi', 's', 'sa', 'sans', 'se', 'ses', 'si', 'son', 'sont', 'sur', 't', 'ta', 'te', 'tes', 'toi', 'ton', 'tu',
  'un', 'une', 'vos', 'votre', 'vous', 'y', 'sais', 'sait', 'savez', 'dis', 'dire', 'faut', 'fait', 'faire',
  'comment', 'combien', 'pourquoi', 'quand', 'ici', 'tout', 'tous', 'toute', 'toutes', 'bien', 'tres', 'deja',
  'bonjour', 'salut', 'hello', 'coucou', 'merci', 'svp', 'stp', 'please', 'nouvelle', 'nouvelles', 'news', 'ok', 'oui', 'non',
])

/** Minuscules, sans accents (é → e, œ → oe) */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Tous les mots, mots vides compris : lettres, chiffres et points internes (v2.41.0 reste un mot) */
function allWords(text: string): string[] {
  return normalizeText(text).match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? []
}

/**
 * Mots significatifs : normalisés, mots vides retirés, dédoublonnés dans l'ordre d'apparition.
 */
export function significantWords(text: string): string[] {
  return [...new Set(allWords(text).filter(word => !STOP_WORDS.has(word)))]
}

/** Même mot, ou l'un préfixe l'autre (assez long, terminaison courte) : déploiement / déploiements */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= PREFIX_MIN_LENGTH && long.length - short.length <= PREFIX_MAX_SUFFIX && long.startsWith(short)
}

/** Nombre de mots de question présents dans words */
function overlap(question: readonly string[], words: readonly string[]): number {
  return question.filter(word => words.some(candidate => wordsMatch(word, candidate))).length
}

/** Un déclencheur (mot ou expression) est présent dans la question : tous ses mots y figurent, dans l'ordre */
function triggerPresent(trigger: string, question: readonly string[]): boolean {
  const words = allWords(trigger)
  if (words.length === 0) return false
  // Recherche de la séquence : « mise en production » ne compte que si les trois mots se suivent
  return question.some((_, start) => words.every((word, offset) => {
    const candidate = question[start + offset]
    return candidate !== undefined && wordsMatch(word, candidate)
  }))
}

/** Poids d'un déclencheur présent : la question vise précisément cette information */
const TRIGGER_WEIGHT = 2

/**
 * Score chaque puce « Sait » par recouvrement de mots ; une puce « Sur question précise » n'est
 * éligible que si l'un de ses déclencheurs est dans la question (score : recouvrement + TRIGGER_WEIGHT
 * par déclencheur présent). Garde les EXCERPTS_MAX meilleures de score > 0 ; à égalité, les puces
 * « Sur question précise » d'abord, puis l'ordre de la fiche.
 */
export function rankExcerpts(persona: NpcPersona, question: string): KnowledgeExcerpt[] {
  const words = significantWords(question)
  if (words.length === 0) return []
  const sequence = allWords(question)

  const candidates: KnowledgeExcerpt[] = []
  for (const entry of persona.onPreciseQuestion) {
    const triggered = entry.triggers.filter(trigger => triggerPresent(trigger, sequence)).length
    if (triggered === 0) continue
    candidates.push({
      source: 'precise',
      text: entry.text,
      score: TRIGGER_WEIGHT * triggered + overlap(words, significantWords(entry.text)),
    })
  }
  for (const text of persona.knows) {
    candidates.push({ source: 'knows', text, score: overlap(words, significantWords(text)) })
  }

  return candidates
    .map((excerpt, index) => ({ excerpt, index }))
    .filter(({ excerpt }) => excerpt.score > 0)
    // Tri stable et total : score décroissant, puis ordre d'insertion (précises, puis « Sait »)
    .sort((a, b) => b.excerpt.score - a.excerpt.score || a.index - b.index)
    .slice(0, EXCERPTS_MAX)
    .map(({ excerpt }) => excerpt)
}

/** Retriever lexical, derrière l'interface asynchrone commune (calcul synchrone : rankExcerpts) */
export function createLexicalRetriever(): KnowledgeRetriever {
  return {
    retrieve: (persona, question) => Promise.resolve(rankExcerpts(persona, question)),
  }
}
