// Store en mémoire des canaux et messages : une seule instance Render. La persistance éventuelle
// (instantané exportSnapshot / importSnapshot) est branchée par server/utils/chat-persistence.ts.
// Module pur (sans auto-import Nuxt) pour être testable directement avec Vitest.
import type { Channel, ChannelSummary, DirectChannel, Message, MessagesDelta } from '../../shared/types/chat'
import { recordMessagePosted } from './war-room-metrics'
import { isReactionEmoji } from '../../shared/utils/reactions'
import {
  ALERT_SERVICE_MAX_LENGTH,
  ALERT_TITLE_MAX_LENGTH,
  isAlertSeverity,
} from '../../shared/utils/alerts'
import {
  AUTHOR_MAX_LENGTH,
  CHANNELS_MAX,
  CHANNEL_MESSAGES_MAX,
  CHANNEL_NAME_MAX_LENGTH,
  DIRECT_CHANNELS_MAX,
  NPC_REPLY_MAX_LENGTH,
  REACTION_AUTHORS_MAX,
  TEXT_MAX_LENGTH,
} from '../../shared/utils/limits'

const DEFAULT_CHANNELS: readonly Channel[] = [
  { id: 'general', name: 'Général' },
  { id: 'incident-en-cours', name: 'Incident en cours' },
]
/** Identifiants des canaux pré-créés (présents après un reset complet) */
export const DEFAULT_CHANNEL_IDS: readonly string[] = DEFAULT_CHANNELS.map(channel => channel.id)

let channels: Channel[] = []
let messagesByChannel = new Map<string, Message[]>()

// Curseur de révision global, entier et monotone : chaque création ou modification de message l'incrémente
// et l'inscrit dans Message.rev. Seul resetChatStore (tests) le remet à zéro.
let rev = 0
// Messages jamais publiés par slug de canal : ni l'éviction ni les resets ne les décrémentent, et un canal
// supprimé puis recréé reprend son compteur
let totalCounts = new Map<string, number>()
// Par canal, rev du dernier reset ou de la dernière éviction : un curseur antérieur n'est plus valable
let resetRevs = new Map<string, number>()

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

export class ChannelConflictError extends Error {
  constructor(channelId: string) {
    super(`Un canal existe déjà avec l'identifiant ${channelId}`)
    this.name = 'ChannelConflictError'
  }
}

/** Plafond CHANNELS_MAX atteint : 409 */
export class ChannelLimitError extends Error {
  constructor() {
    super(`Nombre maximal de canaux atteint (${CHANNELS_MAX})`)
    this.name = 'ChannelLimitError'
  }
}

/** Plafond DIRECT_CHANNELS_MAX atteint : 409 */
export class DirectChannelLimitError extends Error {
  constructor() {
    super(`Nombre maximal de conversations directes atteint (${DIRECT_CHANNELS_MAX})`)
    this.name = 'DirectChannelLimitError'
  }
}

/** Plafond REACTION_AUTHORS_MAX atteint pour un nouvel auteur : 409 */
export class ReactionLimitError extends Error {
  constructor() {
    super(`Nombre maximal d'auteurs atteint pour cette réaction (${REACTION_AUTHORS_MAX})`)
    this.name = 'ReactionLimitError'
  }
}

/** Remet le store dans son état initial (canaux pré-créés, aucun message, compteurs à zéro) : tests. */
export function resetChatStore(): void {
  channels = DEFAULT_CHANNELS.map(channel => ({ ...channel }))
  messagesByChannel = new Map(channels.map(channel => [channel.id, []]))
  rev = 0
  totalCounts = new Map()
  resetRevs = new Map()
}

/** Révision courante du store */
export function currentRev(): number {
  return rev
}

/** Inscrit une nouvelle révision sur message (création ou modification). */
function bumpRev(message: Message): void {
  rev += 1
  message.rev = rev
}

/** Après un reset : tout curseur antérieur à cette révision donne full, dans tous les canaux connus. */
function markReset(channelIds: Iterable<string>): void {
  rev += 1
  for (const channelId of channelIds) resetRevs.set(channelId, rev)
}

resetChatStore()

function copyChannel(channel: Channel): Channel {
  const copy: Channel = { id: channel.id, name: channel.name }
  if (channel.direct) copy.direct = { ...channel.direct }
  return copy
}

/** Tous les canaux, conversations directes comprises (chronologie, instantané). */
export function listChannels(): Channel[] {
  return channels.map(copyChannel)
}

/** Canal d'id channelId (copie), ou undefined */
export function getChannel(channelId: string): Channel | undefined {
  const channel = channels.find(candidate => candidate.id === channelId)
  return channel ? copyChannel(channel) : undefined
}

/** Vrai si participant (comparé par slug : casse et accents ignorés) possède la conversation directe */
export function isDirectOwner(direct: DirectChannel, participant: string): boolean {
  const slug = slugifyChannelName(participant)
  return slug !== '' && slug === slugifyChannelName(direct.participant)
}

/**
 * Canaux d'équipe dans l'ordre de listChannels, avec le nombre de messages et la date du plus récent ;
 * avec participant, suivis de ses conversations directes (comparées par slug). Les conversations des
 * autres ne sont jamais listées.
 */
export function listChannelSummaries(participant?: string): ChannelSummary[] {
  const visible = channels.filter(channel => !channel.direct
    || (participant !== undefined && isDirectOwner(channel.direct, participant)))
  return visible.map((channel) => {
    const messages = messagesByChannel.get(channel.id) ?? []
    const last = messages[messages.length - 1]
    // Ordre des clés fixe (id, name, direct?, messageCount, totalCount, lastMessageAt) : il se retrouve dans le JSON
    return {
      id: channel.id,
      name: channel.name,
      ...(channel.direct ? { direct: { ...channel.direct } } : {}),
      messageCount: messages.length,
      totalCount: totalCounts.get(channel.id) ?? 0,
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
  if (message.alert) copy.alert = { severity: message.alert.severity, title: message.alert.title, service: message.alert.service }
  if (message.npc) copy.npc = { ...message.npc }
  if (message.ops) copy.ops = { ...message.ops }
  return copy
}

/** Messages présents dans tous les canaux, conversations directes comprises */
export function countMessages(): number {
  let count = 0
  for (const messages of messagesByChannel.values()) count += messages.length
  return count
}

/** Messages du canal, du plus ancien au plus récent. */
export function listMessages(channelId: string): Message[] {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  return messages.map(copyMessage)
}

/**
 * Messages créés ou modifiés après la révision since, triés par rev croissant. Liste complète
 * (full: true, ordre du canal) si le curseur n'est plus valable : antérieur au dernier reset ou à la
 * dernière éviction du canal, ou postérieur à la révision courante (redémarrage sans persistance).
 */
export function listMessagesSince(channelId: string, since: number): MessagesDelta {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  if (since > rev || since < (resetRevs.get(channelId) ?? 0)) {
    return { rev, full: true, messages: messages.map(copyMessage) }
  }
  const changed = messages.filter(message => message.rev > since).sort((a, b) => a.rev - b.rev)
  return { rev, full: false, messages: changed.map(copyMessage) }
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

/**
 * Ajoute message en fin de canal avec une nouvelle révision et compte la publication ; au-delà de
 * CHANNEL_MESSAGES_MAX, les plus anciens sont retirés (FIFO). La révision d'éviction retenue est la plus
 * haute des messages retirés : un curseur qui ne l'a pas vue repart d'une liste complète.
 */
function pushMessage(messages: Message[], message: Message): void {
  bumpRev(message)
  messages.push(message)
  recordMessagePosted(message.npc ? 'npc' : message.kind !== undefined ? 'system' : 'human')
  totalCounts.set(message.channelId, (totalCounts.get(message.channelId) ?? 0) + 1)
  if (messages.length > CHANNEL_MESSAGES_MAX) {
    const evicted = messages.splice(0, messages.length - CHANNEL_MESSAGES_MAX)
    const evictedRev = Math.max(...evicted.map(old => old.rev))
    resetRevs.set(message.channelId, Math.max(resetRevs.get(message.channelId) ?? 0, evictedRev))
  }
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
    rev: 0,
  }
  // Les racines restent sans champ parentId
  if (parentId !== undefined) message.parentId = parentId
  pushMessage(messages, message)
  notifyChange()
  return copyMessage(message)
}

/** Texte ramené à maxLength caractères au plus, points de suspension compris */
export function truncateText(text: string, maxLength: number): string {
  const chars = [...text]
  return chars.length <= maxLength ? text : `${chars.slice(0, maxLength - 1).join('').trimEnd()}…`
}

/**
 * Réponse d'un PNJ, publiée par le serveur (jamais via le corps HTTP) : signée de son nom, marquée npc,
 * dans le fil parentId (racine du même canal). Texte tronqué à NPC_REPLY_MAX_LENGTH ; même plafond FIFO
 * et même curseur rev que les autres messages, pour apparaître dans les deltas du polling.
 */
export function addNpcMessage(
  channelId: string,
  input: { npc: { id: string, name: string, role: string }, text: string, parentId?: string },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)

  const author = requireText(input.npc.name, 'author', AUTHOR_MAX_LENGTH)
  const raw = typeof input.text === 'string' ? input.text.trim() : ''
  const text = requireText(truncateText(raw, Math.min(NPC_REPLY_MAX_LENGTH, TEXT_MAX_LENGTH)), 'text', TEXT_MAX_LENGTH)
  const parentId = input.parentId === undefined ? undefined : requireParentId(input.parentId, messages)

  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author,
    text,
    createdAt: new Date().toISOString(),
    rev: 0,
    npc: { id: input.npc.id, role: input.npc.role },
  }
  if (parentId !== undefined) message.parentId = parentId
  pushMessage(messages, message)
  notifyChange()
  return copyMessage(message)
}

export const SYSTEM_AUTHOR = 'Système'

/** Avis court du serveur (ex. « X n'est pas dans ce scénario »), dans un fil ou à la racine ; jamais posé par le corps HTTP. */
export function addSystemMessage(channelId: string, input: { text: string, parentId?: string }): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  const text = requireText(truncateText(input.text.trim(), TEXT_MAX_LENGTH), 'text', TEXT_MAX_LENGTH)
  const parentId = input.parentId === undefined ? undefined : requireParentId(input.parentId, messages)
  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author: SYSTEM_AUTHOR,
    text,
    createdAt: new Date().toISOString(),
    rev: 0,
    kind: 'system',
  }
  if (parentId !== undefined) message.parentId = parentId
  pushMessage(messages, message)
  notifyChange()
  return copyMessage(message)
}

export const OPS_AUTHOR = 'Ops'

/** Message du compte Ops (actions d'équipe ChatOps) : racine du canal, kind 'ops', jamais posé par le corps HTTP. */
export function addOpsMessage(
  channelId: string,
  input: { text: string, ops: { action: string, by: string, phase: 'start' | 'progress' | 'done' | 'error' } },
): Message {
  const messages = messagesByChannel.get(channelId)
  if (!messages) throw new ChannelNotFoundError(channelId)
  const text = requireText(truncateText(input.text.trim(), TEXT_MAX_LENGTH), 'text', TEXT_MAX_LENGTH)
  const message: Message = {
    id: crypto.randomUUID(),
    channelId,
    author: OPS_AUTHOR,
    text,
    createdAt: new Date().toISOString(),
    rev: 0,
    kind: 'ops',
    ops: { action: input.ops.action, by: input.ops.by, phase: input.ops.phase },
  }
  pushMessage(messages, message)
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
    rev: 0,
    kind: 'announcement',
  }
  pushMessage(messages, message)
  notifyChange()
  return copyMessage(message)
}

export const ALERT_AUTHOR = 'Alerting'

/** Carte d'alerte publiée par l'animateur : message racine signé « Alerting », sans suivi de statut. */
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
    rev: 0,
    kind: 'alert',
    alert: { severity, title, service },
  }
  pushMessage(messages, message)
  notifyChange()
  return copyMessage(message)
}

/**
 * Vide les messages de tous les canaux et supprime les conversations directes ; les canaux d'équipe, y
 * compris ceux créés par les participants, restent. Les compteurs totalCount ne baissent pas et rev
 * avance (les curseurs antérieurs donnent full).
 */
export function clearMessages(): void {
  const previousIds = [...messagesByChannel.keys()]
  channels = channels.filter(channel => !channel.direct)
  messagesByChannel = new Map(channels.map(channel => [channel.id, []]))
  markReset(previousIds)
  notifyChange()
}

/**
 * Reset complet : canaux ramenés à DEFAULT_CHANNELS (ceux des participants et les conversations directes
 * sont supprimés), messages
 * effacés. Contrairement à resetChatStore, rev et totalCount ne reculent jamais.
 */
export function resetAll(): void {
  const previousIds = [...messagesByChannel.keys()]
  channels = DEFAULT_CHANNELS.map(channel => ({ ...channel }))
  messagesByChannel = new Map(channels.map(channel => [channel.id, []]))
  markReset([...previousIds, ...messagesByChannel.keys()])
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
    if (reaction.authors.length >= REACTION_AUTHORS_MAX) throw new ReactionLimitError()
    reaction.authors.push(author)
  }

  const remaining = reactions.filter(candidate => candidate.authors.length > 0)
  if (remaining.length > 0) message.reactions = remaining
  else delete message.reactions
  bumpRev(message)
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
  // Les conversations directes ne comptent pas dans CHANNELS_MAX
  if (channels.filter(channel => !channel.direct).length >= CHANNELS_MAX) throw new ChannelLimitError()

  const channel: Channel = { id, name }
  channels.push(channel)
  messagesByChannel.set(id, [])
  notifyChange()
  return { ...channel }
}

/** Id d'une conversation directe : dm-<slug(participant)>--<npcId> (un slug ne contient jamais « -- ») */
export function directChannelId(participant: string, npcId: string): string {
  return `dm-${slugifyChannelName(participant)}--${npcId}`
}

/** Participant d'une conversation directe : règles de author, slug non vide ; renvoie le nom rogné. */
export function validateDirectParticipant(value: unknown): string {
  const participant = typeof value === 'string' ? value.trim() : ''
  if (participant.length === 0) {
    throw new ChannelValidationError('participant est obligatoire')
  }
  if (participant.length > AUTHOR_MAX_LENGTH) {
    throw new ChannelValidationError(`participant dépasse ${AUTHOR_MAX_LENGTH} caractères`)
  }
  if (slugifyChannelName(participant) === '') {
    throw new ChannelValidationError('participant doit contenir au moins une lettre ou un chiffre')
  }
  return participant
}

/**
 * Crée la conversation directe de participant avec le PNJ npc, ou renvoie celle qui existe déjà (même
 * slug de participant) avec created: false. Le participant suit les règles de author ; les règles propres
 * aux PNJ (nom réservé, PNJ du scénario, PNJ coupés) sont vérifiées par la route.
 */
export function addDirectChannel(input: {
  participant?: unknown
  npc: { id: string, name: string }
}): { channel: Channel, created: boolean } {
  const participant = validateDirectParticipant(input?.participant)

  const id = directChannelId(participant, input.npc.id)
  const existing = channels.find(channel => channel.id === id)
  if (existing) return { channel: copyChannel(existing), created: false }
  if (channels.filter(channel => channel.direct).length >= DIRECT_CHANNELS_MAX) throw new DirectChannelLimitError()

  const channel: Channel = {
    id,
    name: `${participant} ↔ ${input.npc.name}`,
    direct: { participant, npcId: input.npc.id, npcName: input.npc.name },
  }
  channels.push(channel)
  messagesByChannel.set(id, [])
  notifyChange()
  return { channel: copyChannel(channel), created: true }
}

export const SNAPSHOT_VERSION = 2

/**
 * Instantané persistable : canaux (dans l'ordre), messages par canal (réactions, alertes et rev compris),
 * révision courante et compteurs totalCount (y compris ceux des canaux supprimés). La version 1, sans
 * rev ni totalCounts, reste importable.
 */
export interface ChatSnapshot {
  version: typeof SNAPSHOT_VERSION
  savedAt: string
  channels: Channel[]
  messages: Record<string, Message[]>
  rev: number
  totalCounts: Record<string, number>
}

export function exportSnapshot(): ChatSnapshot {
  const messages: Record<string, Message[]> = {}
  for (const [channelId, list] of messagesByChannel) messages[channelId] = list.map(copyMessage)
  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    channels: listChannels(),
    messages,
    rev,
    totalCounts: Object.fromEntries(totalCounts),
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Conversation directe : participant et npcId en chaînes non vides, npcName chaîne si présent */
function isValidDirect(value: unknown): value is Omit<DirectChannel, 'npcName'> & { npcName?: string } {
  return isRecord(value) && typeof value.participant === 'string' && value.participant !== ''
    && typeof value.npcId === 'string' && value.npcId !== ''
    && (value.npcName === undefined || typeof value.npcName === 'string')
}

/** Canal importé : npcName absent ou vide (instantané antérieur à 030) → id du PNJ */
function importedChannel(channel: Channel): Channel {
  const copy = copyChannel(channel)
  if (copy.direct) {
    const direct = channel.direct!
    copy.direct = {
      participant: direct.participant,
      npcId: direct.npcId,
      npcName: typeof direct.npcName === 'string' && direct.npcName !== '' ? direct.npcName : direct.npcId,
    }
  }
  return copy
}

function isValidChannel(value: unknown): value is Channel {
  return isRecord(value) && typeof value.id === 'string' && value.id !== '' && typeof value.name === 'string'
    && (value.direct === undefined || isValidDirect(value.direct))
}

/** Réaction : emoji du jeu fixe, auteurs en tableau de chaînes */
function isValidReaction(value: unknown): boolean {
  return isRecord(value)
    && isReactionEmoji(value.emoji)
    && Array.isArray(value.authors)
    && value.authors.every(author => typeof author === 'string')
}

/** Alerte : sévérité connue (d'anciens champs de statut sont tolérés et ignorés) */
function isValidAlert(value: unknown): boolean {
  return isRecord(value) && isAlertSeverity(value.severity)
}

/** Signature de PNJ : id et rôle en chaînes */
function isValidNpc(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.role === 'string'
}

/** En v2, Message.rev est obligatoire ; en v1 il est absent et attribué à l'import. */
function isValidMessage(value: unknown, channelId: string, withRev: boolean): value is Message {
  return isRecord(value)
    && (!withRev || (isNonNegativeInteger(value.rev) && value.rev > 0))
    && typeof value.id === 'string'
    && value.channelId === channelId
    && typeof value.author === 'string'
    && typeof value.text === 'string'
    && typeof value.createdAt === 'string'
    && (value.reactions === undefined || (Array.isArray(value.reactions) && value.reactions.every(isValidReaction)))
    && (value.alert === undefined || isValidAlert(value.alert))
    && (value.npc === undefined || isValidNpc(value.npc))
}

/**
 * Remplace l'état par celui de l'instantané s'il est valide (version 1 ou 2) et renvoie true.
 * Migration v1 : rev attribué dans l'ordre des messages (canal par canal), totalCounts = messages présents.
 * Sinon renvoie false sans rien modifier ni lever d'exception. Ne notifie pas onChatChange.
 */
export function importSnapshot(data: unknown): boolean {
  // Filet de sécurité : un instantané corrompu ne doit jamais faire échouer la réhydratation
  try {
    return importValidSnapshot(data)
  }
  catch {
    return false
  }
}

function importValidSnapshot(data: unknown): boolean {
  if (!isRecord(data) || (data.version !== 1 && data.version !== SNAPSHOT_VERSION)) return false
  const v2 = data.version === SNAPSHOT_VERSION
  const rawChannels = data.channels
  const rawMessages = data.messages
  if (!Array.isArray(rawChannels) || !rawChannels.every(isValidChannel) || !isRecord(rawMessages)) return false
  const rawTotals = data.totalCounts
  if (v2 && (!isNonNegativeInteger(data.rev) || !isRecord(rawTotals)
    || !Object.values(rawTotals).every(isNonNegativeInteger))) return false

  const ids = new Set(rawChannels.map(channel => channel.id))
  if (ids.size !== rawChannels.length) return false
  // Messages rattachés à un canal absent de la liste : instantané incohérent
  if (Object.keys(rawMessages).some(channelId => !ids.has(channelId))) return false

  const nextMessages = new Map<string, Message[]>()
  for (const channel of rawChannels) {
    const list = rawMessages[channel.id] ?? []
    if (!Array.isArray(list) || !list.every(message => isValidMessage(message, channel.id, v2))) return false
    // Plafond FIFO appliqué aussi à un instantané plus ancien que la limite
    nextMessages.set(channel.id, list.slice(-CHANNEL_MESSAGES_MAX).map(copyMessage))
  }

  let nextRev: number
  const nextTotals = new Map<string, number>()
  if (v2) {
    nextRev = data.rev as number
    // Un message plus récent que la révision de l'instantané : incohérent
    for (const list of nextMessages.values()) {
      if (list.some(message => message.rev > nextRev)) return false
    }
    for (const [channelId, count] of Object.entries(rawTotals as Record<string, number>)) nextTotals.set(channelId, count)
  }
  else {
    nextRev = 0
    for (const list of nextMessages.values()) {
      for (const message of list) message.rev = ++nextRev
    }
  }
  // Le compteur ne peut pas être inférieur aux messages présents
  for (const [channelId, list] of nextMessages) {
    nextTotals.set(channelId, Math.max(nextTotals.get(channelId) ?? 0, list.length))
  }

  // direct conservé (conversations directes) ; tout autre champ inconnu est ignoré
  channels = rawChannels.map(importedChannel)
  messagesByChannel = nextMessages
  // rev ne recule jamais dans un même processus (import après un reset, par exemple)
  rev = Math.max(rev, nextRev)
  totalCounts = nextTotals
  // Curseurs antérieurs à l'import (autre processus, redémarrage) : liste complète une fois
  resetRevs = new Map([...nextMessages.keys()].map(channelId => [channelId, rev]))
  return true
}
