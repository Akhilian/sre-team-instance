// Corps { enabled: boolean } : active ou coupe les PNJ du scénario courant (état en mémoire seulement).
// La coupure annule les réponses en attente. Renvoie le nouvel état, comme GET /api/admin/npcs.
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const body = await readBody<unknown>(event).catch(() => null)
  const enabled = (body as { enabled?: unknown } | null | undefined)?.enabled
  if (typeof enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'enabled doit valoir true ou false' })
  }
  await setNpcsEnabled(enabled)
  return npcAdminState()
})
