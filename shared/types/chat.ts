// Types partagés entre l'API (server/) et le front (app/)
export interface Channel {
  id: string
  name: string
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
}

export interface Reaction {
  emoji: string
  /** Noms des participants, dans l'ordre d'arrivée */
  authors: string[]
}
