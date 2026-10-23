// Chronologie de l'incident pour le post-mortem (GET /api/admin/timeline), partagée entre l'API et /admin

export type TimelineEventType =
  | 'message'
  | 'reply'
  | 'announcement'
  | 'alert'
  | 'alert-acknowledged'
  | 'alert-resolved'

export interface TimelineEvent {
  /** Date ISO 8601 */
  at: string
  channelId: string
  channelName: string
  author: string
  type: TimelineEventType
  text: string
  /** Id du message racine, présent seulement pour une réponse */
  parentId?: string
}

export interface TimelineResponse {
  events: TimelineEvent[]
}
