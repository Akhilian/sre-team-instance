// Le lancement d'un scénario sélectionne les PNJ de son npcScenarioId (le sien par défaut ; panne-checkout
// pour demo-express) et les active, sauf enableNpcs: false (demo-express : laissés coupés). Les fiches
// sont chargées avant le lancement : l'étape npc-message à at: 0 (lanceur d'alerte) est publiée pendant
// startScenario.
//
// Corps facultatif { existingMessages?: "clear" | "keep" }. S'il reste au moins un message (tous canaux)
// et qu'existingMessages est absent : 409 { reason: "messages-exist", messageCount } sans rien lancer.
// "clear" fait l'équivalent de « Effacer les messages » avant le lancement, "keep" lance sans effacer.
import { SCENARIOS } from '../../../../scenarios'

const EXISTING_MESSAGES = ['clear', 'keep'] as const
type ExistingMessages = typeof EXISTING_MESSAGES[number]

function isExistingMessages(value: unknown): value is ExistingMessages {
  return EXISTING_MESSAGES.includes(value as ExistingMessages)
}

export default defineEventHandler(async (event) => {
  // Code vérifié avant toute recherche du scénario
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  // Corps vide toléré (readBody renvoie undefined)
  const body = await readBody<unknown>(event)
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw createError({ statusCode: 400, message: 'Le corps doit être un objet { existingMessages }' })
  }
  const existingMessages = (body as { existingMessages?: unknown } | null | undefined)?.existingMessages
  if (existingMessages !== undefined && !isExistingMessages(existingMessages)) {
    throw createError({ statusCode: 400, message: 'existingMessages doit valoir clear ou keep' })
  }

  const scenario = SCENARIOS.find(candidate => candidate.id === getRouterParam(event, 'id'))
  if (!scenario) {
    throw createError({ statusCode: 404, message: 'Scénario inconnu' })
  }
  // Conflit vérifié avant l'effacement : un lancement refusé n'efface rien
  const current = getScenarioRun()
  if (current?.status === 'running') {
    throw createError({ statusCode: 409, message: new ScenarioConflictError(current.title).message })
  }
  const messageCount = countMessages()
  if (messageCount > 0 && existingMessages === undefined) {
    throw createError({
      statusCode: 409,
      message: `${messageCount} messages existent`,
      data: { reason: 'messages-exist', messageCount },
    })
  }

  await useNpcDispatcher()
  if (messageCount > 0 && existingMessages === 'clear') {
    // Comme reset { scope: messages } : réponses en attente annulées, puis messages et conversations directes effacés
    await cancelPendingNpcReplies()
    clearMessages()
  }
  try {
    const run = startScenario(scenario.id)
    await activateScenarioNpcs(run.scenarioId, scenario.enableNpcs !== false)
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
