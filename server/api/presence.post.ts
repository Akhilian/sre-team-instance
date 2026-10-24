export default defineEventHandler(async (event) => {
  // Corps absent ou non-objet : traité comme un nom vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}

  try {
    validatePresenceInput(input)
  }
  catch (error) {
    if (error instanceof PresenceValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }

  const channelId = typeof input.channelId === 'string' ? input.channelId : ''
  if (!hasChannel(channelId)) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }

  const now = Date.now()
  try {
    recordPresence({ name: input.name, channelId, typing: input.typing }, now)
  }
  catch (error) {
    if (error instanceof PresenceLimitError) {
      throw createError({ statusCode: 429, message: error.message })
    }
    throw error
  }
  const roles = rolesOf(presentParticipants(now).map(participant => participant.name))
  return { ...channelPresence(channelId, now), roles }
})
