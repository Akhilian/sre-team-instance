// Corps { participant, npcId } : ouvre (201) ou retrouve (200) la conversation directe du participant avec
// un PNJ du scénario courant ; même corps Channel dans les deux cas. Passe par le limiteur d'écriture.
// Ordre des refus : participant invalide ou réservé (400), PNJ inconnu (404), PNJ coupés ou plafond (409).
export default defineEventHandler(async (event) => {
  // Corps absent ou non-objet : traité comme un participant vide, donc refusé en 400
  const body = await readBody(event).catch(() => null)
  const input = (body && typeof body === 'object' ? body : {}) as { participant?: unknown, npcId?: unknown }

  try {
    validateDirectParticipant(input.participant)
  }
  catch (error) {
    if (error instanceof ChannelValidationError) {
      throw createError({ statusCode: 400, message: error.message })
    }
    throw error
  }
  // Les noms des PNJ leur sont réservés, ici comme pour author
  if (await isNpcName(input.participant)) {
    throw createError({ statusCode: 400, message: 'Ce nom est réservé à un personnage du scénario' })
  }

  const { persona, enabled } = await currentScenarioNpc(typeof input.npcId === 'string' ? input.npcId : '')
  if (!persona) {
    throw createError({ statusCode: 404, message: 'PNJ inconnu dans le scénario en cours' })
  }
  if (!enabled) {
    throw createError({ statusCode: 409, message: 'Les PNJ sont coupés' })
  }

  try {
    const { channel, created } = addDirectChannel({ participant: input.participant, npc: persona })
    setResponseStatus(event, created ? 201 : 200)
    return channel
  }
  catch (error) {
    if (error instanceof DirectChannelLimitError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
