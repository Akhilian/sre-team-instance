// Types partagés entre l'API (server/) et le front (app/)
import type { AlertSeverity, AlertStatus } from '../utils/alerts'

export interface Channel {
  id: string
  name: string
}

/** Canal avec de quoi calculer les non-lus côté client (GET /api/channels) */
export interface ChannelSummary extends Channel {
  /** Messages présents dans le canal : racines, réponses et annonces (plafonné par l'éviction FIFO) */
  messageCount: number
  /** Messages jamais publiés dans le canal, monotone : ni l'éviction ni les resets ne le font baisser */
  totalCount: number
  /** createdAt du message le plus récent ; null si le canal est vide */
  lastMessageAt: string | null
}

export interface Message {
  id: string
  channelId: string
  author: string
  text: string
  /** Date ISO 8601 */
  createdAt: string
  /** Révision de la dernière création ou modification (curseur global du store, monotone) */
  rev: number
  /** Id du message racine du fil ; absent pour un message racine */
  parentId?: string
  /** Réactions dans l'ordre de première réaction ; absent sans aucune réaction */
  reactions?: Reaction[]
  /** 'announcement' (annonce de l'animateur) ou 'alert' (carte d'alerte) ; absent pour un message ordinaire */
  kind?: 'announcement' | 'alert'
  /** Détails de l'alerte, présent seulement quand kind === 'alert' ; text en est la description */
  alert?: Alert
}

/** Réponse de GET /api/channels/:id/messages?since=<rev> */
export interface MessagesDelta {
  /** Révision courante du store : prochain since */
  rev: number
  /** true : messages est la liste complète du canal (curseur plus valable), à substituer */
  full: boolean
  /** full: false, messages dont rev > since, triés par rev croissant */
  messages: Message[]
}

export interface Alert {
  severity: AlertSeverity
  title: string
  service: string
  status: AlertStatus
  acknowledgedBy?: string
  /** Date ISO 8601 */
  acknowledgedAt?: string
  resolvedBy?: string
  /** Date ISO 8601 */
  resolvedAt?: string
}

export interface Reaction {
  emoji: string
  /** Noms des participants, dans l'ordre d'arrivée */
  authors: string[]
}
