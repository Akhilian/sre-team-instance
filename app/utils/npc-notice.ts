// Avis local « PNJ coupés » affiché après un envoi (sans auto-import Nuxt : testé directement par Vitest).
// Calculé côté client à partir de /api/npcs, jamais envoyé au serveur ni stocké.
import { splitMentions } from '~~/shared/utils/mentions'

export interface NpcNoticeContext {
  /** PNJ actifs (/api/npcs) */
  enabled: boolean
  /** Noms des PNJ du scénario courant */
  npcNames: readonly string[]
  /** Conversation directe : nom de son PNJ */
  directNpcName?: string
}

/** « A », « A et B », « A, B et C » */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`
}

/**
 * Avis à afficher après l'envoi de text, ou null : PNJ actifs, ou aucun PNJ concerné (ni mentionné, ni
 * interlocuteur de la conversation directe). Noms sans doublon, PNJ de la conversation d'abord, puis dans
 * l'ordre du texte.
 */
export function npcNoticeFor(text: string, context: NpcNoticeContext): string | null {
  if (context.enabled) return null
  const names: string[] = []
  const add = (name: string) => {
    if (!names.some(known => known.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  if (context.directNpcName) add(context.directNpcName)
  for (const segment of splitMentions(text, context.npcNames)) {
    if (segment.type === 'mention') add(segment.name)
  }
  if (names.length === 0) return null
  const verb = names.length > 1 ? 'ne répondront pas' : 'ne répondra pas'
  return `Les PNJ ne sont pas actifs pour le moment : ${joinNames(names)} ${verb}.`
}
