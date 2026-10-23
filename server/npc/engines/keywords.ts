// Moteur `keywords` : repli déterministe, sans modèle (défaut et base des tests). La réponse est la phrase
// de ton du PNJ suivie des extraits retenus par le retriever ; sans extrait, sa phrase d'esquive.
import type { NpcRequest, NpcResponder } from '../../../shared/types/npc'

export function createKeywordsResponder(): NpcResponder {
  return {
    respond(request: NpcRequest): Promise<string> {
      const { persona, excerpts } = request
      if (excerpts.length === 0) return Promise.resolve(persona.deflection)
      return Promise.resolve([persona.tone, ...excerpts.map(excerpt => excerpt.text)].join(' '))
    },
  }
}
