// Choix de son rôle par un participant
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const input = body && typeof body === 'object' ? body : {}
  try {
    return setRole(input)
  }
  catch (error) {
    if (error instanceof RoleValidationError) throw createError({ statusCode: 400, message: error.message })
    throw error
  }
})
