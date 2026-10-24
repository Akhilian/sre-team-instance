// Corps { enabled?: boolean, spontaneous?: boolean } (au moins un des deux) : active ou coupe les PNJ du
// scénario courant, et/ou l'interrupteur « Interventions spontanées » (état en mémoire seulement).
// La coupure des PNJ annule les réponses en attente. Renvoie le nouvel état, comme GET /api/admin/npcs.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const body = await readBody<unknown>(event).catch(() => null)
  const { enabled, spontaneous } = (body && typeof body === 'object' ? body : {}) as { enabled?: unknown, spontaneous?: unknown }
  if (enabled === undefined && spontaneous === undefined) {
    throw createError({ statusCode: 400, message: 'enabled ou spontaneous doit valoir true ou false' })
  }
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'enabled doit valoir true ou false' })
  }
  if (spontaneous !== undefined && typeof spontaneous !== 'boolean') {
    throw createError({ statusCode: 400, message: 'spontaneous doit valoir true ou false' })
  }
  if (enabled !== undefined) await setNpcsEnabled(enabled)
  if (spontaneous !== undefined) await setSpontaneousEnabled(spontaneous)
  return npcAdminState()
})
