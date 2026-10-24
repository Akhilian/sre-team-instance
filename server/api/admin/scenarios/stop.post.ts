// Corps facultatif { disableNpcs?: boolean } (défaut true) : l'arrêt coupe aussi les PNJ (réponses en
// attente annulées) ; avec false, ils restent actifs.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  // Corps vide toléré (readBody renvoie undefined)
  const body = await readBody<unknown>(event)
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw createError({ statusCode: 400, message: 'Le corps doit être un objet { disableNpcs }' })
  }
  const disableNpcs = (body as { disableNpcs?: unknown } | null | undefined)?.disableNpcs ?? true
  if (typeof disableNpcs !== 'boolean') {
    throw createError({ statusCode: 400, message: 'disableNpcs doit être un booléen' })
  }
  const run = stopScenario()
  if (!run) {
    throw createError({ statusCode: 409, message: 'Aucun scénario en cours' })
  }
  if (disableNpcs) await setNpcsEnabled(false)
  return run
})
