// Store en mémoire des canaux et messages : une seule instance Render, pas de persistance.
// Module pur (sans auto-import Nuxt) pour être testable directement avec Vitest.
import type { Channel, Message } from '../../shared/types/chat'

export const AUTHOR_MAX_LENGTH = 50
export const TEXT_MAX_LENGTH = 2000

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

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageValidationError'
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

export function hasChannel(channelId: string): boolean {
  return messagesByChannel.has(channelId)
}

/** Messages du canal, du plus ancien au plus récent. */
export function listMessages(channelId: string): Message[] {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  return messages.map(message => ({ ...message }))
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

/** Valide puis ajoute un message ; lève une erreur sans rien ajouter si l'entrée est invalide. */
export function addMessage(channelId: string, input: { author?: unknown, text?: unknown }): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)

  const author = requireText(input?.author, 'author', AUTHOR_MAX_LENGTH)
  const text = requireText(input?.text, 'text', TEXT_MAX_LENGTH)

  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author,
    text,
    createdAt: new Date().toISOString(),
  }
  messages.push(message)
  return { ...message }
}
