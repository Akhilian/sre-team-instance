// Store en mémoire des canaux et messages : une seule instance Render, pas de persistance.
// Module pur (sans auto-import Nuxt) pour être testable directement avec Vitest.
import type { Channel, ChannelSummary, Message } from '../../shared/types/chat'
import { isReactionEmoji } from '../../shared/utils/reactions'

export const AUTHOR_MAX_LENGTH = 50
export const TEXT_MAX_LENGTH = 2000
export const CHANNEL_NAME_MAX_LENGTH = 50

const DEFAULT_CHANNELS: readonly Channel[] = [
  { id: 'general', name: 'Général' },
  { id: 'incident-en-cours', name: 'Incident en cours' },
]

let channels: Channel[] = []
let messagesByChannel = new Map<string, Message[]>()

export class ChannelNotFoundError extends Error {
  constructor(channelId: string) {
    super(`Canal inconnu : ${channelId}`)
    this.name = 'ChannelNotFoundError'
  }
}

export class MessageNotFoundError extends Error {
  constructor(messageId: string) {
    super(`Message inconnu : ${messageId}`)
    this.name = 'MessageNotFoundError'
  }
}

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageValidationError'
  }
}

export class ChannelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChannelValidationError'
  }
}

export class ChannelConflictError extends Error {
  constructor(channelId: string) {
    super(`Un canal existe déjà avec l'identifiant ${channelId}`)
    this.name = 'ChannelConflictError'
  }
}

/** Remet le store dans son état initial (canaux pré-créés, aucun message). */
export function resetChatStore(): void {
  channels = DEFAULT_CHANNELS.map(channel => ({ ...channel }))
  messagesByChannel = new Map(channels.map(channel => [channel.id, []]))
}

resetChatStore()

export function listChannels(): Channel[] {
  return channels.map(channel => ({ ...channel }))
}

/** Même ordre que listChannels, avec le nombre de messages et la date du plus récent. */
export function listChannelSummaries(): ChannelSummary[] {
  return channels.map((channel) => {
    const messages = messagesByChannel.get(channel.id) ?? []
    const last = messages[messages.length - 1]
    // Ordre des clés fixe (id, name, messageCount, lastMessageAt) : il se retrouve dans le JSON
    return {
      id: channel.id,
      name: channel.name,
      messageCount: messages.length,
      lastMessageAt: last ? last.createdAt : null,
    }
  })
}

export function hasChannel(channelId: string): boolean {
  return messagesByChannel.has(channelId)
}

/** Copie profonde : les réactions renvoyées ne partagent rien avec le store. */
function copyMessage(message: Message): Message {
  const copy = { ...message }
  if (message.reactions) {
    copy.reactions = message.reactions.map(reaction => ({ emoji: reaction.emoji, authors: [...reaction.authors] }))
  }
  return copy
}

/** Messages du canal, du plus ancien au plus récent. */
export function listMessages(channelId: string): Message[] {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  return messages.map(copyMessage)
}

function requireText(value: unknown, field: string, maxLength: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) {
    throw new MessageValidationError(`${field} est obligatoire`)
  }
  if (trimmed.length > maxLength) {
    throw new MessageValidationError(`${field} dépasse ${maxLength} caractères`)
  }
  return trimmed
}

/** Un parentId doit désigner un message racine du même canal : un seul niveau de fil. */
function requireParentId(value: unknown, messages: readonly Message[]): string {
  if (typeof value !== 'string') {
    throw new MessageValidationError('parentId doit être une chaîne')
  }
  const parent = messages.find(message => message.id === value)
  if (!parent) {
    throw new MessageValidationError('parentId ne désigne aucun message de ce canal')
  }
  if (parent.parentId !== undefined) {
    throw new MessageValidationError('parentId doit désigner un message racine, pas une réponse')
  }
  return value
}

/** Valide puis ajoute un message ; lève une erreur sans rien ajouter si l'entrée est invalide. */
export function addMessage(
  channelId: string,
  input: { author?: unknown, text?: unknown, parentId?: unknown },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)

  const author = requireText(input?.author, 'author', AUTHOR_MAX_LENGTH)
  const text = requireText(input?.text, 'text', TEXT_MAX_LENGTH)
  const parentId = input?.parentId === undefined ? undefined : requireParentId(input.parentId, messages)

  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author,
    text,
    createdAt: new Date().toISOString(),
  }
  // Les racines restent sans champ parentId
  if (parentId !== undefined) message.parentId = parentId
  messages.push(message)
  return copyMessage(message)
}

export const ANNOUNCEMENT_AUTHOR = 'Animateur'

/** Annonce de l'animateur : message racine signé « Animateur », mêmes règles de texte que addMessage. */
export function addAnnouncement(channelId: string, input: { text?: unknown }): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)

  const text = requireText(input?.text, 'text', TEXT_MAX_LENGTH)
  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author: ANNOUNCEMENT_AUTHOR,
    text,
    createdAt: new Date().toISOString(),
    kind: 'announcement',
  }
  messages.push(message)
  return copyMessage(message)
}

/** Vide les messages de tous les canaux ; les canaux, y compris ceux créés par les participants, restent. */
export function clearMessages(): void {
  for (const channelId of messagesByChannel.keys()) messagesByChannel.set(channelId, [])
}

/**
 * Bascule la réaction emoji de author sur un message (racine ou réponse) : ajoutée si absente,
 * retirée sinon. Une entrée sans auteur est retirée, et le champ reactions supprimé s'il est vide.
 */
export function toggleReaction(
  channelId: string,
  messageId: string,
  input: { emoji?: unknown, author?: unknown },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  const message = messages.find(candidate => candidate.id === messageId)
  if (!message) throw new MessageNotFoundError(messageId)

  const emoji = input?.emoji
  if (!isReactionEmoji(emoji)) {
    throw new MessageValidationError('emoji ne fait pas partie des réactions disponibles')
  }
  const author = requireText(input?.author, 'author', AUTHOR_MAX_LENGTH)

  const reactions = message.reactions ?? []
  const reaction = reactions.find(candidate => candidate.emoji === emoji)
  if (!reaction) {
    reactions.push({ emoji, authors: [author] })
  }
  else if (reaction.authors.includes(author)) {
    reaction.authors = reaction.authors.filter(name => name !== author)
  }
  else {
    reaction.authors.push(author)
  }

  const remaining = reactions.filter(candidate => candidate.authors.length > 0)
  if (remaining.length > 0) message.reactions = remaining
  else delete message.reactions
  return copyMessage(message)
}

/** Id d'URL dérivé du nom : minuscules, sans accents, tout caractère hors [a-z0-9] devient un tiret. */
export function slugifyChannelName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Valide puis crée un canal vide en fin de liste ; lève une erreur sans rien créer sinon. */
export function addChannel(input: { name?: unknown }): Channel {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) {
    throw new ChannelValidationError('name est obligatoire')
  }
  if (name.length > CHANNEL_NAME_MAX_LENGTH) {
    throw new ChannelValidationError(`name dépasse ${CHANNEL_NAME_MAX_LENGTH} caractères`)
  }

  const id = slugifyChannelName(name)
  if (id === '') {
    throw new ChannelValidationError('name doit contenir au moins une lettre ou un chiffre')
  }
  if (messagesByChannel.has(id)) throw new ChannelConflictError(id)

  const channel: Channel = { id, name }
  channels.push(channel)
  messagesByChannel.set(id, [])
  return { ...channel }
}
