// Types partagés entre l'API (server/) et le front (app/)
import type { AlertSeverity, AlertStatus } from '../utils/alerts'

export interface Channel {
  id: string
  name: string
}

/** Canal avec de quoi calculer les non-lus côté client (GET /api/channels) */
export interface ChannelSummary extends Channel {
  /** Tous les messages du canal : racines, réponses et annonces */
  messageCount: number
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
  /** Id du message racine du fil ; absent pour un message racine */
  parentId?: string
  /** Réactions dans l'ordre de première réaction ; absent sans aucune réaction */
  reactions?: Reaction[]
  /** 'announcement' (annonce de l'animateur) ou 'alert' (carte d'alerte) ; absent pour un message ordinaire */
  kind?: 'announcement' | 'alert'
  /** Détails de l'alerte, présent seulement quand kind === 'alert' ; text en est la description */
  alert?: Alert
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
