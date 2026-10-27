// Scénarios d'incident pré-écrits et état de leur exécution, partagés entre l'API et /admin
import type { AlertSeverity } from '../utils/alerts'

interface ScenarioStepBase {
  /** Délai en secondes depuis le lancement du scénario */
  at: number
  /**
   * Condition, ou liste de conditions évaluées en ET (liste vide : toujours vraie), à l'instant d'émission
   * sur le registre des pannes ; fausse → étape cancelled
   */
  when?: ScenarioCondition | ScenarioCondition[]
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

export type ScenarioActionType = 'simulated' | 'index-check' | 'reindex' | 'changelog'

/** Bouton du panneau d'actions d'équipe (ChatOps) ; seul le type est codé, le reste est de la donnée */
export interface ScenarioAction {
  id: string
  label: string
  /** Défaut : simulated */
  type?: ScenarioActionType
  /** simulated : délai avant l'application des pannes et du message de fin */
  delaySeconds?: number
  startText?: string
  doneText?: string
  /** simulated : pannes appliquées à l'échéance */
  faults?: { name: string, value: number }[]
  /** changelog : texte posté */
  text?: string
}

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
  /** Actions d'équipe proposées pendant le scénario (panneau ChatOps) */
  actions?: ScenarioAction[]
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

/** Action telle que listée par GET /api/actions */
export interface TeamActionSummary {
  id: string
  label: string
  type: ScenarioActionType
  running: boolean
}

export interface TeamActionsResponse {
  actions: TeamActionSummary[]
  /** Canal d'incident où s'affiche le panneau ; présent avec des actions */
  channelId?: string
  /** Présent seulement si GRAFANA_DASHBOARD_URL est défini */
  healthUrl?: string
}
