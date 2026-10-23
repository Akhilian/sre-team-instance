// Le lancement d'un scénario qui a des PNJ (panne-checkout) les active. Les fiches sont chargées avant
// le lancement : l'étape npc-message à at: 0 (lanceur d'alerte) est publiée pendant startScenario.
export default defineEventHandler(async (event) => {
  // Code vérifié avant toute recherche du scénario
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }

  await useNpcDispatcher()
  try {
    const run = startScenario(getRouterParam(event, 'id') ?? '')
    await activateScenarioNpcs(run.scenarioId)
    setResponseStatus(event, 201)
    return run
  }
  catch (error) {
    if (error instanceof ScenarioNotFoundError) {
      throw createError({ statusCode: 404, message: 'Scénario inconnu' })
    }
    if (error instanceof ScenarioConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
