export default defineEventHandler((event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const run = stopScenario()
  if (!run) {
    throw createError({ statusCode: 409, message: 'Aucun scénario en cours' })
  }
  return run
})
