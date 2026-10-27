// Types partagés entre l'API (server/) et le front (app/)
import type { AlertSeverity } from '../utils/alerts'

export interface Channel {
  id: string
  name: string
  /** Présent seulement sur une conversation directe entre un participant et un PNJ */
  direct?: DirectChannel
}

/** Propriétaire et interlocuteur d'une conversation directe (id dm-<slug(participant)>--<npcId>) */
export interface DirectChannel {
  /** Nom du participant tel qu'à la création ; comparé par slug (casse et accents ignorés) */
  participant: string
  npcId: string
  /** Nom du PNJ à la création (affichage) ; l'id du PNJ pour un instantané antérieur à 030 */
  npcName: string
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
  /** 'announcement' (annonce de l'animateur), 'alert' (carte d'alerte), 'system' (avis court du serveur) ou 'ops' (action d'équipe ChatOps) ; absent pour un message ordinaire */
  kind?: 'announcement' | 'alert' | 'system' | 'ops'
  /** Détails de l'alerte, présent seulement quand kind === 'alert' ; text en est la description */
  alert?: Alert
  /** Détails de l'action d'équipe, présent seulement quand kind === 'ops' ; text en est le message */
  ops?: MessageOps
  /** Présent seulement sur la réponse d'un PNJ (posé par le serveur, jamais par le corps HTTP) */
  npc?: MessageNpc
}

/** Action d'équipe ChatOps à l'origine d'un message Ops */
export interface MessageOps {
  /** Libellé de l'action */
  action: string
  /** Participant qui l'a lancée (nom déclaré) */
  by: string
  phase: 'start' | 'progress' | 'done' | 'error'
}

/** Signature d'un message de PNJ : author porte son nom */
export interface MessageNpc {
  id: string
  role: string
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
}

export interface Reaction {
  emoji: string
  /** Noms des participants, dans l'ordre d'arrivée */
  authors: string[]
}
