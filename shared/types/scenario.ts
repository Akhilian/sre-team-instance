// Scénarios d'incident pré-écrits et état de leur exécution, partagés entre l'API et /admin
import type { AlertSeverity } from '../utils/alerts'

interface ScenarioStepBase {
  /** Délai en secondes depuis le lancement du scénario */
  at: number
  /** Condition évaluée à l'instant d'émission sur le registre des pannes ; fausse → étape cancelled */
  when?: ScenarioCondition
}

export interface ScenarioCondition {
  fault: string
  active: boolean
}

interface ScenarioChannelStepBase extends ScenarioStepBase {
  channelId: string
}

export interface ScenarioAlertStep extends ScenarioChannelStepBase {
  kind: 'alert'
  severity: AlertSeverity
  title: string
  service: string
  text: string
}

export interface ScenarioAnnouncementStep extends ScenarioChannelStepBase {
  kind: 'announcement'
  text: string
}

/** Message racine d'un PNJ (lanceur d'alerte, direction…), publié même si les PNJ sont coupés */
export interface ScenarioNpcMessageStep extends ScenarioChannelStepBase {
  kind: 'npc-message'
  /** Id d'une fiche, cherché parmi toutes les fiches chargées ; introuvable → étape failed */
  npcId: string
  text: string
}

/** Active (value > 0) ou coupe (value 0) une panne DocShare ; pas de canal */
export interface ScenarioFaultStep extends ScenarioStepBase {
  kind: 'fault'
  name: string
  value: number
}

export type ScenarioStep = ScenarioFaultStep | ScenarioAlertStep | ScenarioAnnouncementStep | ScenarioNpcMessageStep

export type ScenarioStepKind = ScenarioStep['kind']

export interface Scenario {
  id: string
  title: string
  description: string
  /**
   * Scénario des fiches de PNJ activées au lancement (server/npc/personas/<npcScenarioId>/) ; défaut : id.
   * Un scénario sans fiches propres (demo-express) emprunte les PNJ d'un autre.
   */
  npcScenarioId?: string
  /** false : le lancement sélectionne les PNJ de npcScenarioId mais les laisse coupés (défaut : activés) */
  enableNpcs?: boolean
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
  kind: ScenarioStepKind
  /** Vide pour une étape fault */
  channelId: string
  /** Titre de l'alerte, début de l'annonce, ou « Nom : début du texte » pour un message de PNJ */
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
