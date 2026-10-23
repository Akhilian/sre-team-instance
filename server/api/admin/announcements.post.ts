export default defineEventHandler(async (event) => {
  // Code vérifié avant toute lecture du corps
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }

  // Corps absent ou non-objet : traité comme une annonce vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}
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
