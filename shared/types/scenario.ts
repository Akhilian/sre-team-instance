// Scénarios d'incident pré-écrits et état de leur exécution, partagés entre l'API et /admin
import type { AlertSeverity } from '../utils/alerts'

interface ScenarioStepBase {
  /** Délai en secondes depuis le lancement du scénario */
  at: number
  channelId: string
}

export interface ScenarioAlertStep extends ScenarioStepBase {
  kind: 'alert'
  severity: AlertSeverity
  title: string
  service: string
  text: string
}

export interface ScenarioAnnouncementStep extends ScenarioStepBase {
  kind: 'announcement'
  text: string
}

export type ScenarioStep = ScenarioAlertStep | ScenarioAnnouncementStep

export interface Scenario {
  id: string
  title: string
  description: string
  /** Triées par at croissant */
  steps: ScenarioStep[]
}

/** Scénario tel que listé par GET /api/admin/scenarios */
export interface ScenarioSummary {
  id: string
  title: string
  description: string
  stepCount: number
  /** at de la dernière étape */
  durationSeconds: number
}

export type ScenarioRunStatus = 'running' | 'finished' | 'stopped'
export type ScenarioStepStatus = 'pending' | 'published' | 'failed' | 'cancelled'

export interface ScenarioRunStep {
  index: number
  at: number
  kind: ScenarioStep['kind']
  channelId: string
  /** Titre de l'alerte ou début de l'annonce */
  label: string
  status: ScenarioStepStatus
  /** Date ISO 8601, présente une fois l'étape publiée */
  publishedAt?: string
}

export interface ScenarioRun {
  scenarioId: string
  title: string
  status: ScenarioRunStatus
  /** Date ISO 8601 */
  startedAt: string
  steps: ScenarioRunStep[]
}

export interface ScenariosResponse {
  scenarios: ScenarioSummary[]
  /** Dernière exécution, même terminée ou arrêtée ; null si aucun lancement depuis le démarrage */
  run: ScenarioRun | null
}
