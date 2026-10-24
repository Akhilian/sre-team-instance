// Store en mémoire de la présence et de la frappe : aucun timer, l'expiration se calcule à la lecture.
// Module pur (sans auto-import Nuxt) ; l'horloge est injectée par `now` (ms) pour les tests.
import { AUTHOR_MAX_LENGTH, PRESENCE_ENTRIES_MAX } from '../../shared/utils/limits'

/** Présent si le dernier battement date de moins de 15 s */
export const PRESENCE_TTL_MS = 15_000
/** En train d'écrire si le dernier `typing: true` date de moins de 5 s */
export const TYPING_TTL_MS = 5_000
/** Filet de la frappe d'un PNJ : effacée au bout de 5 min (délai « occupé » de 3 min + génération) même si la fin n'a jamais été signalée */
export const NPC_TYPING_TTL_MS = 300_000

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

interface NpcTypingEntry {
  /** Réponses en préparation de ce PNJ dans ce canal (plusieurs messages peuvent le solliciter) */
  count: number
  /** Expiration (ms) : repoussée à chaque début de réponse */
  until: number
}
// Frappe des PNJ, à part des participants : hors PRESENCE_ENTRIES_MAX, jamais dans present.
// Par canal, puis par nom de PNJ.
let npcTyping = new Map<string, Map<string, NpcTypingEntry>>()

export function resetPresenceStore(): void {
  entries = new Map()
  npcTyping = new Map()
}

/**
 * Début (typing: true) ou fin (typing: false) d'une réponse du PNJ name dans channelId, signalés par
 * l'orchestrateur. Le PNJ reste « en train d'écrire » tant qu'une de ses réponses y est en préparation,
 * au plus NPC_TYPING_TTL_MS après le dernier début.
 */
export function setNpcTyping(input: { channelId: string, name: string, typing: boolean }, now: number): void {
  const byName = npcTyping.get(input.channelId) ?? new Map<string, NpcTypingEntry>()
  const current = byName.get(input.name)
  const live = current && now < current.until ? current : undefined
  if (input.typing) {
    byName.set(input.name, { count: (live?.count ?? 0) + 1, until: now + NPC_TYPING_TTL_MS })
  }
  else if (live && live.count > 1) {
    live.count -= 1
  }
  else {
    byName.delete(input.name)
  }
  if (byName.size > 0) npcTyping.set(input.channelId, byName)
  else npcTyping.delete(input.channelId)
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
  for (const [name, entry] of npcTyping.get(channelId) ?? []) {
    if (now < entry.until && !typing.includes(name)) typing.push(name)
  }
  return { present: present.sort(byName), typing: typing.sort(byName) }
}

export interface PresentParticipant {
  name: string
  channelId: string
}

/** Participants présents (battement de moins de 15 s), tous canaux confondus, triés par nom. */
export function presentParticipants(now: number): PresentParticipant[] {
  const result: PresentParticipant[] = []
  for (const [name, entry] of entries) {
    if (now - entry.lastSeen < PRESENCE_TTL_MS) result.push({ name, channelId: entry.channelId })
  }
  return result.sort((a, b) => byName(a.name, b.name))
}
