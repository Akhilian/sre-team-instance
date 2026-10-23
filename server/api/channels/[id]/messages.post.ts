export default defineEventHandler(async (event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  if (!hasChannel(channelId)) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }

  // Corps absent ou non-objet : traité comme un message vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}
  // Les noms des PNJ leur sont réservés : un participant ne peut pas parler à leur place
  if (await isNpcName((input as { author?: unknown }).author)) {
    throw createError({ statusCode: 400, message: 'Ce nom est réservé à un personnage du scénario' })
  }

  try {
    const message = addMessage(channelId, input)
    // Réponses des PNJ mentionnés, publiées plus tard dans le fil : jamais d'échec du POST pour autant
    dispatchNpcReplies(message).catch(error => console.error('[npc] planification en échec', error))
    setResponseStatus(event, 201)
    return message
  }
  catch (error) {
    if (error instanceof MessageValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }
})
