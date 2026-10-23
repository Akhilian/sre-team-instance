// Détection des mentions `@nom` dans le texte d'un message (sans auto-import Nuxt : testée directement par Vitest)

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

/** Nom connu mentionné à la position `at` (sur le `@`), ou undefined. */
function mentionAt(text: string, at: number, names: readonly string[]): string | undefined {
  if (text[at] !== '@' || !isBoundary(text[at - 1])) return undefined
  return names.find((name) => {
    const end = at + 1 + name.length
    return text.slice(at + 1, end).toLowerCase() === name.toLowerCase() && isBoundary(text[end])
  })
}

/** Découpe un texte en segments texte / mention ; un `@mot` sans nom connu reste du texte. */
export function splitMentions(text: string, knownNames: readonly string[]): MessageSegment[] {
  const names = candidates(knownNames)
  const segments: MessageSegment[] = []
  let textStart = 0
  let i = 0
  while (i < text.length) {
    const name = names.length > 0 ? mentionAt(text, i, names) : undefined
    if (name === undefined) {
      i++
      continue
    }
    if (i > textStart) segments.push({ type: 'text', value: text.slice(textStart, i) })
    const end = i + 1 + name.length
    segments.push({ type: 'mention', value: text.slice(i, end), name })
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
