// Calcul pur des messages non lus par canal (sans auto-import Nuxt : testé directement par Vitest), à partir des résumés de GET /api/channels
// et du nombre de messages déjà vus par canal (mémorisé dans le localStorage).
import type { ChannelSummary } from '../../shared/types/chat'

export const LAST_SEEN_STORAGE_KEY = 'sre-team-instance:last-seen'

export interface UnreadState {
  /** Non-lus par id de canal (0 pour le canal courant) */
  counts: Record<string, number>
  /** Nouvel état « vu » à mémoriser ; les canaux disparus n'y figurent plus */
  nextSeen: Record<string, number>
}

export function computeUnread(
  summaries: readonly ChannelSummary[],
  seen: Readonly<Record<string, number>>,
  currentId: string,
): UnreadState {
  const counts: Record<string, number> = {}
  const nextSeen: Record<string, number> = {}
  for (const { id, messageCount } of summaries) {
    const previous = seen[id]
    // Canal courant : tout est vu. Première observation : l'historique n'est pas compté.
    // Compteur en baisse (réinitialisation par l'animateur) : on repart du compteur actuel.
    if (id === currentId || previous === undefined || messageCount < previous) {
      nextSeen[id] = messageCount
      counts[id] = 0
    }
    else {
      nextSeen[id] = previous
      counts[id] = messageCount - previous
    }
  }
  return { counts, nextSeen }
}

/** Total des non-lus hors canal courant, pour le préfixe du titre de l'onglet. */
export function totalUnread(counts: Readonly<Record<string, number>>, currentId: string): number {
  return Object.entries(counts).reduce((sum, [id, count]) => id === currentId ? sum : sum + count, 0)
}

/** Lecture tolérante du localStorage : toute valeur invalide est ignorée. */
export function parseSeen(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const seen: Record<string, number> = {}
    for (const [id, count] of Object.entries(value)) {
      if (Number.isInteger(count) && (count as number) >= 0) seen[id] = count as number
    }
    return seen
  }
  catch {
    return {}
  }
}

/** Texte de la pastille : « 99+ » au-delà de 99. */
export function unreadBadgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
