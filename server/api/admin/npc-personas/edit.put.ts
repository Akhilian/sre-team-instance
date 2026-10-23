// Remplace en mémoire une fiche de PNJ en service par un nouveau Markdown (026), avec effet immédiat.
// Corps { path, markdown } (jusqu'à PERSONA_EDIT_BODY_MAX_BYTES, dérogation de 00-body-limit) ; path n'est
// qu'une clé comparée aux fiches en service, jamais un chemin de fichier. 404 si path n'est pas en service,
// 413 au-delà de 32 Ko, 422 { errors: [{ message, line? }] } si la fiche est invalide (rien ne change).
import type { NpcPersonaEditErrorResponse } from '~~/shared/types/npc'

export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const body = await readBody<{ path?: unknown, markdown?: unknown } | null>(event).catch(() => null)
  const path = body?.path
  const markdown = body?.markdown
  if (typeof path !== 'string' || typeof markdown !== 'string') {
    throw createError({ statusCode: 400, message: 'Corps attendu : { path, markdown } (chaînes)' })
  }
  const outcome = await editNpcPersona(path, markdown)
  if (outcome.ok) return outcome.persona
  if (outcome.status === 422) {
    setResponseStatus(event, 422)
    return { errors: outcome.errors } satisfies NpcPersonaEditErrorResponse
  }
  throw createError({ statusCode: outcome.status, message: outcome.errors[0]?.message ?? 'Fiche refusée' })
})
