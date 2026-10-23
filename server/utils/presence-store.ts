// Store en mémoire de la présence et de la frappe : aucun timer, l'expiration se calcule à la lecture.
// Module pur (sans auto-import Nuxt) ; l'horloge est injectée par `now` (ms) pour les tests.
import { AUTHOR_MAX_LENGTH, PRESENCE_ENTRIES_MAX } from '../../shared/utils/limits'

/** Présent si le dernier battement date de moins de 15 s */
export const PRESENCE_TTL_MS = 15_000
/** En train d'écrire si le dernier `typing: true` date de moins de 5 s */
export const TYPING_TTL_MS = 5_000

export class PresenceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresenceValidationError'
  }
}

/** Plafond PRESENCE_ENTRIES_MAX atteint pour un nouveau nom : 429 */
export class PresenceLimitError extends Error {
  constructor() {
    super(`Trop de participants présents (${PRESENCE_ENTRIES_MAX}), réessayez plus tard`)
    this.name = 'PresenceLimitError'
  }
}

interface PresenceEntry {
  channelId: string
  lastSeen: number
  /** Instant (ms) jusqu'auquel le nom est affiché comme en train d'écrire ; 0 si non */
  typingUntil: number
}

export interface ChannelPresence {
  present: string[]
  typing: string[]
}

// Une entrée par nom : un nom n'est présent que dans le dernier canal signalé
let entries = new Map<string, PresenceEntry>()

export function resetPresenceStore(): void {
  entries = new Map()
}

/** Valide `name` (même règle que `author`) et `typing` (booléen ou absent) ; renvoie le nom rogné. */
export function validatePresenceInput(input: { name?: unknown, typing?: unknown }): { name: string, typing?: boolean } {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) {
    throw new PresenceValidationError('name est obligatoire')
  }
  if (name.length > AUTHOR_MAX_LENGTH) {
    throw new PresenceValidationError(`name dépasse ${AUTHOR_MAX_LENGTH} caractères`)
  }
  if (input.typing !== undefined && typeof input.typing !== 'boolean') {
    throw new PresenceValidationError('typing doit être un booléen')
  }
  return { name, typing: input.typing }
}

/**
 * Enregistre un battement de `name` dans `channelId` (le canal n'est pas vérifié ici).
 * `typing: true` marque la frappe pour 5 s, `typing: false` l'efface ; absent, le battement
 * ne marque pas de frappe mais n'efface pas celle en cours (le poll ne doit pas la faire clignoter).
 * Purge d'abord les noms expirés, puis lève PresenceLimitError pour un nouveau nom au-delà du plafond.
 */
export function recordPresence(
  input: { name?: unknown, channelId: string, typing?: unknown },
  now: number,
): string {
  const { name } = validatePresenceInput(input)

  // Les noms expirés sont purgés à chaque battement : la map reste bornée sans timer
  for (const [entryName, entry] of entries) {
    if (now - entry.lastSeen >= PRESENCE_TTL_MS) entries.delete(entryName)
  }
  if (!entries.has(name) && entries.size >= PRESENCE_ENTRIES_MAX) throw new PresenceLimitError()

  const previous = entries.get(name)
  // Un battement sans frappe garde la frappe en cours dans le même canal ; `typing: false` l'efface
  let typingUntil = previous && previous.channelId === input.channelId ? previous.typingUntil : 0
  if (input.typing === true) typingUntil = now + TYPING_TTL_MS
  else if (input.typing === false) typingUntil = 0

  entries.set(name, { channelId: input.channelId, lastSeen: now, typingUntil })
  return name
}

const byName = (a: string, b: string) => a.localeCompare(b, 'fr')

export function channelPresence(channelId: string, now: number): ChannelPresence {
  const present: string[] = []
  const typing: string[] = []
  for (const [name, entry] of entries) {
    if (entry.channelId !== channelId || now - entry.lastSeen >= PRESENCE_TTL_MS) continue
    present.push(name)
    if (now < entry.typingUntil) typing.push(name)
  }
  return { present: present.sort(byName), typing: typing.sort(byName) }
}
