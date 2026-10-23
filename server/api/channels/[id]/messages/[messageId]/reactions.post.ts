export default defineEventHandler(async (event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  const messageId = getRouterParam(event, 'messageId') ?? ''

  // Corps absent ou non-objet : traité comme une réaction vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}
  // Conversation directe : seul son propriétaire (même slug) peut réagir ; nom vide ou invalide → 400 plus bas
  const direct = getChannel(channelId)?.direct
  const author = (input as { author?: unknown }).author
  if (direct && typeof author === 'string' && author.trim() !== '' && !isDirectOwner(direct, author)) {
    throw createError({ statusCode: 403, message: 'Seul le participant de cette conversation peut réagir' })
  }

  try {
    return toggleReaction(channelId, messageId, input)
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
    if (error instanceof ReactionLimitError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
