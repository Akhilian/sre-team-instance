export default defineEventHandler((event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  // Arrête d'abord le scénario en cours (sans erreur si aucun) : rien n'est publié après l'effacement
  stopScenario()
  clearMessages()
  return { cleared: true }
})
