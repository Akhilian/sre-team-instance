// Réattribution du rôle d'un participant par l'animateur
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
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
