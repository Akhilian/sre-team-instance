// Relit la source des fiches en service (NPC_PERSONAS_DIR ou fiches embarquées) et remplace les fiches
// valides à chaud. Le corps est ignoré : aucune requête ne choisit ce qui est lu. Rapport
// { source, loaded, errors, kept } ; 422 avec le même rapport si aucune fiche n'est valide.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const { replaced, report } = await reloadNpcPersonas()
  if (!replaced) setResponseStatus(event, 422)
  return report
})
