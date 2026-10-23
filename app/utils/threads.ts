// Regroupement des messages en fils façon Teams (sans auto-import Nuxt : testé directement par Vitest)
import type { Message } from '../../shared/types/chat'

/** Un fil : le message racine et ses réponses. */
export type Thread = Message & { replies: Message[] }

function byCreatedAt(a: Message, b: Message): number {
  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * Racines dans l'ordre chronologique, chacune avec ses réponses triées chronologiquement.
 * Une réponse dont la racine est absente de la liste est ignorée. Tri stable : à date égale,
 * l'ordre d'entrée (celui du store) est conservé.
 */
export function groupThreads(messages: readonly Message[]): Thread[] {
  const sorted = [...messages].sort(byCreatedAt)
  const threads: Thread[] = []
  const byId = new Map<string, Thread>()
  for (const message of sorted) {
    if (message.parentId !== undefined) continue
    const thread: Thread = { ...message, replies: [] }
    threads.push(thread)
    byId.set(message.id, thread)
  }
  for (const message of sorted) {
    if (message.parentId === undefined) continue
    byId.get(message.parentId)?.replies.push(message)
  }
  return threads
}
