export default defineEventHandler(async (event) => {
  // Corps absent ou non-objet : traité comme un nom vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}

  try {
    const channel = addChannel(input)
    setResponseStatus(event, 201)
    return channel
  }
  catch (error) {
    if (error instanceof ChannelValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    if (error instanceof ChannelConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
