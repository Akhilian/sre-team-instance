import type { TeamActionsResponse } from '~~/shared/types/scenario'

// Actions d'équipe du scénario en cours (panneau ChatOps) ; liste vide sans scénario running déclarant des actions
export default defineEventHandler((): TeamActionsResponse => {
  const actions = listTeamActions()
  const channelId = teamActionsChannelId()
  if (actions.length === 0 || !channelId) return { actions: [] }
  const healthUrl = processEnv().GRAFANA_DASHBOARD_URL?.trim()
  return healthUrl ? { actions, channelId, healthUrl } : { actions, channelId }
})
