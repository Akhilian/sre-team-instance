// Corps { enabled?: boolean, spontaneous?: boolean, pace?: 'instant'|'realistic'|'busy' } (au moins un) : active ou
// coupe les PNJ du scénario courant, l'interrupteur « Interventions spontanées » et/ou le rythme de réponse
// (état en mémoire seulement).
// La coupure des PNJ annule les réponses en attente. Renvoie le nouvel état, comme GET /api/admin/npcs.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const body = await readBody<unknown>(event).catch(() => null)
  const { enabled, spontaneous, pace } = (body && typeof body === 'object' ? body : {}) as { enabled?: unknown, spontaneous?: unknown, pace?: unknown }
  if (enabled === undefined && spontaneous === undefined && pace === undefined) {
    throw createError({ statusCode: 400, message: 'enabled, spontaneous ou pace est attendu' })
  }
  if (pace !== undefined && !['instant', 'realistic', 'busy'].includes(pace as string)) {
    throw createError({ statusCode: 400, message: 'pace doit valoir instant, realistic ou busy' })
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'enabled doit valoir true ou false' })
  }
  if (spontaneous !== undefined && typeof spontaneous !== 'boolean') {
    throw createError({ statusCode: 400, message: 'spontaneous doit valoir true ou false' })
  }
  if (enabled !== undefined) await setNpcsEnabled(enabled)
  if (spontaneous !== undefined) await setSpontaneousEnabled(spontaneous)
  if (pace !== undefined) setNpcPace(pace)
  return npcAdminState()
})
