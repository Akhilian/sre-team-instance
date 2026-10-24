// Architecture en service pour /admin : hébergement, stockage, moteur des PNJ, scénario, fiches (sans secret)
export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const [npc, files] = await Promise.all([npcAdminState(), npcPersonaFiles()])
  return buildArchitecture(processEnv(), {
    npc,
    run: getScenarioRun(),
    personas: { source: files.source, count: files.personas.length },
  })
})
