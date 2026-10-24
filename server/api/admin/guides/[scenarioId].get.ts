// Guide Markdown de l'animateur pour un scénario (docs/guide-animateur/, embarqué dans le build)
import { SCENARIOS } from '../../../scenarios'

export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const scenarioId = getRouterParam(event, 'scenarioId') ?? ''
  if (!SCENARIOS.some(scenario => scenario.id === scenarioId)) {
    throw createError({ statusCode: 404, message: 'Scénario inconnu' })
  }
  const markdown = await useStorage('assets:guides').getItem<string>(`${scenarioId}.md`)
  if (typeof markdown !== 'string') {
    throw createError({ statusCode: 404, message: 'Guide introuvable' })
  }
  return { scenarioId, markdown }
})
