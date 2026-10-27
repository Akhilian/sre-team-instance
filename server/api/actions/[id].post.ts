import { AUTHOR_MAX_LENGTH } from '~~/shared/utils/limits'

// Corps { author } : nom déclaré, comme les messages. 404 hors scénario, 409 si l'action est déjà en cours.
export default defineEventHandler(async (event) => {
  const actionId = getRouterParam(event, 'id') ?? ''
  const body = await readBody(event).catch(() => null)
  const author = body && typeof body === 'object' ? (body as { author?: unknown }).author : undefined
  if (typeof author !== 'string' || author.trim() === '' || author.trim().length > AUTHOR_MAX_LENGTH) {
    throw createError({ statusCode: 400, message: `author est obligatoire (${AUTHOR_MAX_LENGTH} caractères au plus)` })
  }
  if (await isNpcName(author)) {
    throw createError({ statusCode: 400, message: 'Ce nom est réservé à un personnage du scénario' })
  }
  try {
    const result = await runTeamAction(actionId, author.trim())
    if (result.status === 'conflict') {
      throw createError({ statusCode: 409, message: result.message })
    }
    setResponseStatus(event, result.status === 'started' ? 202 : 200)
    return { status: result.status }
  }
  catch (error) {
    if (error instanceof TeamActionNotFoundError) {
      throw createError({ statusCode: 404, message: 'Action inconnue' })
    }
    throw error
  }
})
