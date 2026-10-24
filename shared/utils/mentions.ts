// Détection des mentions `@nom` dans le texte d'un message, partagée par le front et le serveur (PNJ). Module pur, testé directement par Vitest

export type MessageSegment =
  | { type: 'text', value: string }
  /** value : texte tel que saisi (« @bob ») ; name : nom connu correspondant (« Bob ») */
  | { type: 'mention', value: string, name: string }

/** Frontière d'une mention : espace ou ponctuation (une lettre ou un chiffre colle au mot, comme dans ops@bob.fr). */
function isBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s\p{P}\p{S}]/u.test(char)
}

/** Noms connus nettoyés, dédoublonnés sans tenir compte de la casse, le plus long d'abord. */
function candidates(knownNames: readonly string[]): string[] {
  const byKey = new Map<string, string>()
  for (const raw of knownNames) {
    const name = raw.trim()
    if (name !== '' && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name)
  }
  return [...byKey.values()].sort((a, b) => b.length - a.length)
}

/**
 * Prénoms (premier mot d'un nom à plusieurs mots, en minuscules) → nom complet. Un prénom partagé par deux
 * noms distincts, ou égal à un nom connu d'un seul mot, est ambigu et absent de la table.
 */
function firstNames(names: readonly string[]): Map<string, string> {
  const table = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const name of names) {
    const lower = name.toLowerCase()
    if (!/\s/.test(name)) ambiguous.add(lower)
  }
  for (const name of names) {
    if (!/\s/.test(name)) continue
    const first = name.split(/\s+/)[0]!.toLowerCase()
    if (table.has(first) && table.get(first)!.toLowerCase() !== name.toLowerCase()) ambiguous.add(first)
    else table.set(first, name)
  }
  for (const first of ambiguous) table.delete(first)
  return table
}

/** Nom connu mentionné à la position `at` (sur le `@`) et longueur du texte saisi, ou undefined. */
function mentionAt(
  text: string,
  at: number,
  names: readonly string[],
  firsts: ReadonlyMap<string, string>,
): { name: string, length: number } | undefined {
  if (text[at] !== '@' || !isBoundary(text[at - 1])) return undefined
  const matches = (word: string) => {
    const end = at + 1 + word.length
    return text.slice(at + 1, end).toLowerCase() === word.toLowerCase() && isBoundary(text[end])
  }
  const full = names.find(matches)
  if (full !== undefined) return { name: full, length: full.length }
  for (const [first, name] of firsts) {
    if (matches(first)) return { name, length: first.length }
  }
  return undefined
}

/** Découpe un texte en segments texte / mention ; un `@mot` sans nom connu reste du texte. */
export function splitMentions(text: string, knownNames: readonly string[]): MessageSegment[] {
  const names = candidates(knownNames)
  const firsts = firstNames(names)
  const segments: MessageSegment[] = []
  let textStart = 0
  let i = 0
  while (i < text.length) {
    const found = names.length > 0 ? mentionAt(text, i, names, firsts) : undefined
    if (found === undefined) {
      i++
      continue
    }
    if (i > textStart) segments.push({ type: 'text', value: text.slice(textStart, i) })
    const end = i + 1 + found.length
    segments.push({ type: 'mention', value: text.slice(i, end), name: found.name })
    i = end
    textStart = end
  }
  if (textStart < text.length || segments.length === 0) {
    segments.push({ type: 'text', value: text.slice(textStart) })
  }
  return segments
}

/** Vrai si `name` désigne `me` (insensible à la casse) ; faux si `me` est vide. */
export function isMe(name: string, me: string): boolean {
  const mine = me.trim()
  return mine !== '' && name.trim().toLowerCase() === mine.toLowerCase()
}

/** Vrai si le texte contient une mention désignant `me`. */
export function mentionsName(text: string, knownNames: readonly string[], me: string): boolean {
  if (me.trim() === '') return false
  return splitMentions(text, [...knownNames, me]).some(
    segment => segment.type === 'mention' && isMe(segment.name, me),
  )
}

/** Requête de mention en cours de saisie : `start` = position du `@`, `query` = texte tapé après */
export interface MentionQuery {
  start: number
  query: string
}

const QUERY_AT_END = /(^|[\s\p{P}\p{S}])@((?:\p{L}[\p{L}'’-]*(?: \p{L}[\p{L}'’-]*){0,2})?)$/u

/**
 * Requête de mention en cours avant le curseur : un `@` en frontière, suivi de lettres et d'au plus deux
 * espaces (sans espace final) jusqu'au curseur ; sinon null. « @ » seul donne une requête vide.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const match = QUERY_AT_END.exec(text.slice(0, caret))
  if (!match) return null
  return { start: match.index + match[1]!.length, query: match[2]! }
}

/** Candidat à l'autocomplétion : un nom, éventuellement suivi d'une fonction */
export interface MentionCandidate {
  name: string
  role?: string
}

/** Minuscules sans accents */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * Candidats dont le nom complet, le prénom ou un autre mot du nom commence par `query` (casse et accents
 * ignorés). Nom complet ou prénom d'abord, puis alphabétique ; sans doublon ; sans `me` ; au plus `max`.
 */
export function suggestMentions<T extends MentionCandidate | string>(
  query: string,
  candidates: readonly T[],
  max = 5,
  me = '',
): T[] {
  const wanted = fold(query.trim()).replace(/\s+/g, ' ')
  if (wanted === '') return []
  const mine = fold(me.trim())
  const seen = new Set<string>()
  const ranked: { item: T, name: string, rank: number }[] = []
  for (const item of candidates) {
    const name = (typeof item === 'string' ? item : item.name).trim()
    const key = fold(name)
    if (key === '' || key === mine || seen.has(key)) continue
    seen.add(key)
    const words = key.split(/\s+/)
    let rank: number | undefined
    if (key.startsWith(wanted) || words[0]!.startsWith(wanted)) rank = 0
    else if (words.slice(1).some(word => word.startsWith(wanted))) rank = 1
    if (rank !== undefined) ranked.push({ item, name, rank })
  }
  ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'fr'))
  return ranked.slice(0, max).map(entry => entry.item)
}

/** Minuscules sans accents, longueur conservée (une lettre qui change de longueur reste en minuscules) */
function foldKeepLength(text: string): string {
  let out = ''
  for (const char of text) {
    const folded = fold(char)
    out += folded.length === char.length ? folded : char.toLowerCase()
  }
  return out
}

/**
 * Noms complets cités en clair (sans `@`), dans l'ordre du texte et sans doublon : nom complet, ou prénom seul
 * s'il n'est pas ambigu (même règle que les mentions). Mot entier, casse et accents ignorés ; les segments
 * déjà reconnus comme `@mention` et les adresses (ops@claire.fr) sont ignorés.
 */
export function namedPersons(text: string, knownNames: readonly string[]): string[] {
  const names = candidates(knownNames)
  if (names.length === 0) return []
  const firsts = firstNames(names)
  // Mots cherchés, nom complet d'abord (le plus long en premier), puis prénoms
  const words: { word: string, name: string }[] = [
    ...names.map(name => ({ word: foldKeepLength(name), name })),
    ...[...firsts].map(([first, name]) => ({ word: foldKeepLength(first), name })),
  ]
  const folded = foldKeepLength(text)
  // Zones des @mentions reconnues
  const masked: [number, number][] = []
  let offset = 0
  for (const segment of splitMentions(text, knownNames)) {
    if (segment.type === 'mention') masked.push([offset, offset + segment.value.length])
    offset += segment.value.length
  }
  const found: string[] = []
  let i = 0
  while (i < folded.length) {
    const zone = masked.find(([from, to]) => i >= from && i < to)
    if (zone) {
      i = zone[1]
      continue
    }
    const before = folded[i - 1]
    const match = (before === '@' || !isBoundary(before))
      ? undefined
      : words.find(({ word }) => folded.startsWith(word, i) && isBoundary(folded[i + word.length]))
    if (match) {
      if (!found.some(name => name.toLowerCase() === match.name.toLowerCase())) found.push(match.name)
      i += match.word.length
    }
    else i++
  }
  return found
}
