// Libellés FR et mise en forme des scénarios d'incident. Module pur, partagé serveur / /admin / tests.
import type { ScenarioRunStatus, ScenarioStep, ScenarioStepStatus } from '../types/scenario'

export const SCENARIO_STEP_STATUS_LABELS: Record<ScenarioStepStatus, string> = {
  pending: 'À venir',
  published: 'Publiée',
  failed: 'Échec',
  cancelled: 'Annulée',
}

export const SCENARIO_RUN_STATUS_LABELS: Record<ScenarioRunStatus, string> = {
  running: 'En cours',
  finished: 'Terminé',
  stopped: 'Arrêté',
}

export const SCENARIO_LABEL_MAX_LENGTH = 80

/** Délai depuis le lancement au format +MM:SS (les minutes ne sont pas bornées à 59). */
export function formatScenarioOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `+${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Titre de l'alerte, ou début de l'annonce tronqué à SCENARIO_LABEL_MAX_LENGTH caractères avec « … ». */
export function scenarioStepLabel(step: ScenarioStep): string {
  if (step.kind === 'alert') return step.title
  const text = step.text.trim().replace(/\s+/g, ' ')
  if (text.length <= SCENARIO_LABEL_MAX_LENGTH) return text
  return `${text.slice(0, SCENARIO_LABEL_MAX_LENGTH - 1).trimEnd()}…`
}
