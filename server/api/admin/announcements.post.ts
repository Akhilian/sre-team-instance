export default defineEventHandler(async (event) => {
  // Code vérifié avant toute lecture du corps
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }

  // Corps absent, illisible ou non-objet (tableau compris) : 400 avant tout appel au store,
  // qui vérifierait sinon le canal avant le texte (404)
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Corps JSON attendu : { channelId, text }' })
  }
  const input = body as { channelId?: unknown, text?: unknown }
  const channelId = typeof input.channelId === 'string' ? input.channelId : ''

  try {
    const message = addAnnouncement(channelId, input)
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
