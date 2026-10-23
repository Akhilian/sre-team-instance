export default defineEventHandler(async (event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  if (!hasChannel(channelId)) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }

  // Corps absent ou non-objet : traité comme un message vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}

  try {
    const message = addMessage(channelId, input)
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
