// PNJ du scénario courant (public) : le front ajoute leurs noms aux mentions reconnues
import type { NpcsResponse } from '../../shared/types/npc'

export default defineEventHandler(async (): Promise<NpcsResponse> => {
  const { enabled, npcs } = await npcAdminState()
  return { enabled, npcs }
})
