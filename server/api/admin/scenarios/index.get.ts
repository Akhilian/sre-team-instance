import type { ScenariosResponse } from '~~/shared/types/scenario'

export default defineEventHandler((event): ScenariosResponse => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  return { scenarios: listScenarioSummaries(), run: getScenarioRun() }
})
