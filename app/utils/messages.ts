// Fusion côté client des messages reçus par le polling incrémental (sans auto-import Nuxt : testé directement par Vitest)
import type { Message } from '../../shared/types/chat'

function byCreatedAt(a: Message, b: Message): number {
  return a.createdAt.localeCompare(b.createdAt)
}

/**
 * Fusionne incoming dans current par id : un message connu est remplacé sur place, un nouveau est
 * ajouté en fin de liste (les nouveaux entre eux par createdAt, tri stable). Ne garde que les max
 * derniers (CHANNEL_MESSAGES_MAX côté page), comme l'éviction FIFO du serveur. Renvoie une nouvelle liste, current n'est pas modifié.
 */
export function mergeMessages(
  current: readonly Message[],
  incoming: readonly Message[],
  max: number,
): Message[] {
  const merged = [...current]
  const indexById = new Map(merged.map((message, index) => [message.id, index]))
  const added: Message[] = []
  for (const message of incoming) {
    const index = indexById.get(message.id)
    if (index !== undefined) merged[index] = message
    else added.push(message)
  }
  merged.push(...added.sort(byCreatedAt))
  return merged.length > max ? merged.slice(-max) : merged
}
