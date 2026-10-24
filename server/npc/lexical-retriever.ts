// Retriever lexical (« RAG » minimal, sans modèle) : recouvrement de mots entre la question et chaque puce
// de la fiche. Remplaçable par un retriever à embeddings derrière la même interface KnowledgeRetriever.
// Module pur et déterministe.
import type { KnowledgeExcerpt, KnowledgeRetriever, NpcPersona, NpcPreciseEntry } from '../../shared/types/npc'

/** Extraits retenus au plus */
export const EXCERPTS_MAX = 2
/** Longueur minimale pour qu'un mot en préfixe un autre (coût / coûte, récent / récente) */
const PREFIX_MIN_LENGTH = 4
/** Écart de longueur toléré entre un mot et son préfixe (terminaisons) */
const PREFIX_MAX_SUFFIX = 3
/**
 * Pour un déclencheur, lettres finales que le mot de la question peut omettre (publie → publier,
 * connexion → connexions). Au-delà, un mot de la question plus court ne déclenche pas : « change » ne
 * déclenche pas « changelog » (il faut le déclencheur « changé »).
 */
const TRIGGER_MAX_MISSING_SUFFIX = 1

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
export function allWords(text: string): string[] {
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

/**
 * Mot d'un déclencheur et mot de la question : identiques, ou le mot de la question est une forme
 * fléchie du déclencheur (débit → débités, jusqu'à PREFIX_MAX_SUFFIX lettres en plus), ou il lui manque
 * au plus TRIGGER_MAX_MISSING_SUFFIX lettre finale.
 */
export function triggerWordMatches(triggerWord: string, questionWord: string): boolean {
  if (triggerWord === questionWord) return true
  if (questionWord.length > triggerWord.length) {
    return triggerWord.length >= PREFIX_MIN_LENGTH
      && questionWord.length - triggerWord.length <= PREFIX_MAX_SUFFIX
      && questionWord.startsWith(triggerWord)
  }
  return questionWord.length >= PREFIX_MIN_LENGTH
    && triggerWord.length - questionWord.length <= TRIGGER_MAX_MISSING_SUFFIX
    && triggerWord.startsWith(questionWord)
}

/** Nombre de mots de question présents dans words */
function overlap(question: readonly string[], words: readonly string[]): number {
  return question.filter(word => words.some(candidate => wordsMatch(word, candidate))).length
}

/**
 * Positions où un déclencheur (mot ou expression) figure dans la question : tous ses mots, dans l'ordre et
 * à la suite (« mise en production » ne compte que si les trois mots se suivent). Plages [début, fin).
 */
function triggerSpans(trigger: string, question: readonly string[]): [number, number][] {
  const words = allWords(trigger)
  if (words.length === 0) return []
  const spans: [number, number][] = []
  question.forEach((_, start) => {
    const present = words.every((word, offset) => {
      const candidate = question[start + offset]
      return candidate !== undefined && triggerWordMatches(word, candidate)
    })
    if (present) spans.push([start, start + words.length])
  })
  return spans
}

/**
 * Déclencheurs de l'entrée présents dans la question : nombre de déclencheurs distincts, c'est-à-dire
 * trouvés sur des mots différents de la question (« débit » et « débités » sur le même mot, ou « point » et
 * « prochain point » qui se chevauchent, comptent pour un), et présence d'un déclencheur spécifique.
 */
function triggersFound(entry: NpcPreciseEntry, question: readonly string[]): { distinct: number, specific: boolean } {
  const found = entry.triggers
    .map(trigger => ({ trigger, spans: triggerSpans(trigger.text, question) }))
    .filter(({ spans }) => spans.length > 0)
  // Glouton, expressions les plus longues d'abord : chaque déclencheur compte une fois, sans chevauchement
  const taken: [number, number][] = []
  let distinct = 0
  for (const { spans } of [...found].sort((a, b) => (b.spans[0]![1] - b.spans[0]![0]) - (a.spans[0]![1] - a.spans[0]![0]))) {
    const free = spans.find(([start, end]) => taken.every(([otherStart, otherEnd]) => end <= otherStart || start >= otherEnd))
    if (!free) continue
    taken.push(free)
    distinct += 1
  }
  return { distinct, specific: found.some(({ trigger }) => trigger.specific) }
}

/** Poids d'un déclencheur présent : la question vise précisément cette information */
const TRIGGER_WEIGHT = 2
/** Déclencheurs distincts requis pour une entrée précise sans déclencheur spécifique présent */
export const PRECISE_MIN_TRIGGERS = 2

/**
 * Score chaque puce « Sait » par recouvrement de mots ; une puce « Sur question précise » n'est
 * éligible que si la question contient au moins PRECISE_MIN_TRIGGERS de ses déclencheurs distincts, ou
 * l'un de ses déclencheurs spécifiques (score : recouvrement + TRIGGER_WEIGHT par déclencheur distinct
 * présent). Garde les EXCERPTS_MAX meilleures de score > 0 ; à égalité, les puces « Sur question
 * précise » d'abord, puis l'ordre de la fiche.
 */
export function rankExcerpts(persona: NpcPersona, question: string): KnowledgeExcerpt[] {
  const words = significantWords(question)
  if (words.length === 0) return []
  const sequence = allWords(question)

  const candidates: KnowledgeExcerpt[] = []
  for (const entry of persona.onPreciseQuestion) {
    const { distinct: triggered, specific } = triggersFound(entry, sequence)
    if (!specific && triggered < PRECISE_MIN_TRIGGERS) continue
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
