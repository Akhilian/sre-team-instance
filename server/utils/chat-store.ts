// Store en mémoire des canaux et messages : une seule instance Render. La persistance éventuelle
// (instantané exportSnapshot / importSnapshot) est branchée par server/utils/chat-persistence.ts.
// Module pur (sans auto-import Nuxt) pour être testable directement avec Vitest.
import type { Channel, ChannelSummary, Message } from '../../shared/types/chat'
import { isReactionEmoji } from '../../shared/utils/reactions'
import {
  ALERT_SERVICE_MAX_LENGTH,
  ALERT_TITLE_MAX_LENGTH,
  canTransition,
  isAlertSeverity,
} from '../../shared/utils/alerts'

export const AUTHOR_MAX_LENGTH = 50
export const TEXT_MAX_LENGTH = 2000
export const CHANNEL_NAME_MAX_LENGTH = 50

const DEFAULT_CHANNELS: readonly Channel[] = [
  { id: 'general', name: 'Général' },
  { id: 'incident-en-cours', name: 'Incident en cours' },
]

let channels: Channel[] = []
let messagesByChannel = new Map<string, Message[]>()

type ChatChangeListener = () => void
const changeListeners = new Set<ChatChangeListener>()

/** Abonne listener à chaque mutation réussie (hors resetChatStore / importSnapshot) ; renvoie le désabonnement. */
export function onChatChange(listener: ChatChangeListener): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

function notifyChange(): void {
  for (const listener of changeListeners) {
    // Un abonné en échec (sauvegarde…) ne doit pas faire échouer la mutation
    try {
      listener()
    }
    catch (error) {
      console.error('[chat-store] abonné onChatChange en échec', error)
    }
  }
}

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

/** Changement de statut d'alerte interdit (déjà acquittée, déjà résolue) : 409 */
export class AlertTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlertTransitionError'
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

/** Copie profonde : les réactions et l'alerte renvoyées ne partagent rien avec le store. */
function copyMessage(message: Message): Message {
  const copy = { ...message }
  if (message.reactions) {
    copy.reactions = message.reactions.map(reaction => ({ emoji: reaction.emoji, authors: [...reaction.authors] }))
  }
  if (message.alert) copy.alert = { ...message.alert }
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
  notifyChange()
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
  notifyChange()
  return copyMessage(message)
}

export const ALERT_AUTHOR = 'Alerting'

/** Carte d'alerte publiée par l'animateur : message racine signé « Alerting », au statut triggered. */
export function addAlert(
  channelId: string,
  input: { severity?: unknown, title?: unknown, service?: unknown, text?: unknown },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)

  const severity = input?.severity
  if (!isAlertSeverity(severity)) {
    throw new MessageValidationError('severity doit valoir SEV1, SEV2 ou SEV3')
  }
  const title = requireText(input?.title, 'title', ALERT_TITLE_MAX_LENGTH)
  const service = requireText(input?.service, 'service', ALERT_SERVICE_MAX_LENGTH)
  const text = requireText(input?.text, 'text', TEXT_MAX_LENGTH)

  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author: ALERT_AUTHOR,
    text,
    createdAt: new Date().toISOString(),
    kind: 'alert',
    alert: { severity, title, service, status: 'triggered' },
  }
  messages.push(message)
  notifyChange()
  return copyMessage(message)
}

/**
 * Acquitte ou résout une alerte au nom de name. Transitions : triggered → acknowledged,
 * triggered|acknowledged → resolved ; toute autre transition lève AlertTransitionError.
 */
export function setAlertStatus(
  channelId: string,
  messageId: string,
  input: { status?: unknown, name?: unknown },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  const message = messages.find(candidate => candidate.id === messageId)
  if (!message) throw new MessageNotFoundError(messageId)

  const status = input?.status
  if (status !== 'acknowledged' && status !== 'resolved') {
    throw new MessageValidationError('status doit valoir acknowledged ou resolved')
  }
  const name = requireText(input?.name, 'name', AUTHOR_MAX_LENGTH)
  const alert = message.alert
  if (message.kind !== 'alert' || !alert) {
    throw new MessageValidationError('Ce message n\'est pas une alerte')
  }
  if (!canTransition(alert.status, status)) {
    throw new AlertTransitionError(alert.status === 'resolved' ? 'Alerte déjà résolue' : 'Alerte déjà acquittée')
  }

  const at = new Date().toISOString()
  alert.status = status
  if (status === 'acknowledged') {
    alert.acknowledgedBy = name
    alert.acknowledgedAt = at
  }
  else {
    alert.resolvedBy = name
    alert.resolvedAt = at
  }
  notifyChange()
  return copyMessage(message)
}

/** Vide les messages de tous les canaux ; les canaux, y compris ceux créés par les participants, restent. */
export function clearMessages(): void {
  for (const channelId of messagesByChannel.keys()) messagesByChannel.set(channelId, [])
  notifyChange()
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
  notifyChange()
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
  notifyChange()
  return { ...channel }
}

export const SNAPSHOT_VERSION = 1

/** Instantané persistable : canaux (dans l'ordre) et messages par canal, réactions et alertes comprises. */
export interface ChatSnapshot {
  version: typeof SNAPSHOT_VERSION
  savedAt: string
  channels: Channel[]
  messages: Record<string, Message[]>
}

export function exportSnapshot(): ChatSnapshot {
  const messages: Record<string, Message[]> = {}
  for (const [channelId, list] of messagesByChannel) messages[channelId] = list.map(copyMessage)
  return { version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(), channels: listChannels(), messages }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidChannel(value: unknown): value is Channel {
  return isRecord(value) && typeof value.id === 'string' && value.id !== '' && typeof value.name === 'string'
}

function isValidMessage(value: unknown, channelId: string): value is Message {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.channelId === channelId
    && typeof value.author === 'string'
    && typeof value.text === 'string'
    && typeof value.createdAt === 'string'
    && (value.reactions === undefined || Array.isArray(value.reactions))
    && (value.alert === undefined || isRecord(value.alert))
}

/**
 * Remplace l'état par celui de l'instantané s'il est valide (validation minimale, version 1) et renvoie true.
 * Sinon renvoie false sans rien modifier ni lever d'exception. Ne notifie pas onChatChange.
 */
export function importSnapshot(data: unknown): boolean {
  if (!isRecord(data) || data.version !== SNAPSHOT_VERSION) return false
  const rawChannels = data.channels
  const rawMessages = data.messages
  if (!Array.isArray(rawChannels) || !rawChannels.every(isValidChannel) || !isRecord(rawMessages)) return false

  const ids = new Set(rawChannels.map(channel => channel.id))
  if (ids.size !== rawChannels.length) return false
  // Messages rattachés à un canal absent de la liste : instantané incohérent
  if (Object.keys(rawMessages).some(channelId => !ids.has(channelId))) return false

  const nextMessages = new Map<string, Message[]>()
  for (const channel of rawChannels) {
    const list = rawMessages[channel.id] ?? []
    if (!Array.isArray(list) || !list.every(message => isValidMessage(message, channel.id))) return false
    nextMessages.set(channel.id, list.map(copyMessage))
  }

  channels = rawChannels.map(channel => ({ id: channel.id, name: channel.name }))
  messagesByChannel = nextMessages
  return true
}
