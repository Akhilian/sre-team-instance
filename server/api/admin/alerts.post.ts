export default defineEventHandler(async (event) => {
  // Code vérifié avant toute lecture du corps
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }

  // Corps non-objet ou channelId absent/vide : 400 avant le store, qui vérifie le canal (404)
  // avant les champs de l'alerte (400)
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Corps JSON attendu : { channelId, severity, title, service, text }' })
  }
  const input = body as { channelId?: unknown, severity?: unknown, title?: unknown, service?: unknown, text?: unknown }
  if (typeof input.channelId !== 'string' || input.channelId.trim() === '') {
    throw createError({ statusCode: 400, message: 'channelId est obligatoire' })
  }
  const channelId = input.channelId

  try {
    const message = addAlert(channelId, input)
    setResponseStatus(event, 201)
    return message
  }
  catch (error) {
    if (error instanceof ChannelNotFoundError) {
      throw createError({ statusCode: 404, message: 'Canal inconnu' })
    }
    if (error instanceof MessageValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }
})
