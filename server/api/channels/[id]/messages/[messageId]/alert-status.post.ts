export default defineEventHandler(async (event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  const messageId = getRouterParam(event, 'messageId') ?? ''

  // Corps absent ou non-objet : traité comme un statut vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  // Conversation directe : seul son propriétaire (même slug) peut acquitter ou résoudre une alerte ; nom vide ou invalide → 400 plus bas
  const direct = getChannel(channelId)?.direct
  const name = (input as { name?: unknown }).name
  if (direct && typeof name === 'string' && name.trim() !== '' && !isDirectOwner(direct, name)) {
    throw createError({ statusCode: 403, message: 'Seul le participant de cette conversation peut acquitter ou résoudre une alerte' })
  }

  try {
    return setAlertStatus(channelId, messageId, input)
  }
  catch (error) {
    if (error instanceof ChannelNotFoundError) {
      throw createError({ statusCode: 404, message: 'Canal inconnu' })
    }
    if (error instanceof MessageNotFoundError) {
      throw createError({ statusCode: 404, message: 'Message inconnu' })
    }
    if (error instanceof MessageValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    if (error instanceof AlertTransitionError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
