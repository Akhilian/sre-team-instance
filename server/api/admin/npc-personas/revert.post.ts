// Supprime la version modifiée d'une fiche de PNJ (026) et remet celle de la source. Corps { path } ;
// 404 si path n'a pas de version modifiée, 409 si l'original n'existe plus à la source (ou si son nom
// est repris par une autre fiche en service). Réponse : la fiche d'origine.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const body = await readBody<{ path?: unknown } | null>(event).catch(() => null)
  const path = body?.path
  if (typeof path !== 'string') throw createError({ statusCode: 400, message: 'Corps attendu : { path } (chaîne)' })
  const outcome = await revertNpcPersona(path)
  if (outcome.ok) return outcome.persona
  throw createError({ statusCode: outcome.status, message: outcome.errors[0]?.message ?? 'Retour refusé' })
})
