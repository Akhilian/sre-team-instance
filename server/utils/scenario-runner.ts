// Exécuteur de scénarios d'incident en mémoire : un seul scénario en cours à la fois, perdu au redémarrage.
// Module pur (sans auto-import Nuxt) : planificateur, horloge et publication injectés par createScenarioRunner.
import type {
  Scenario,
  ScenarioRun,
  ScenarioStep,
  ScenarioSummary,
} from '../../shared/types/scenario'
import { scenarioStepLabel } from '../../shared/utils/scenarios'
import { SCENARIOS } from '../scenarios'
import { addAlert, addAnnouncement } from './chat-store'

/** Scénario inconnu : 404 */
export class ScenarioNotFoundError extends Error {
  constructor(scenarioId: string) {
    super(`Scénario inconnu : ${scenarioId}`)
    this.name = 'ScenarioNotFoundError'
  }
}

/** Un scénario est déjà en cours : 409 */
export class ScenarioConflictError extends Error {
  constructor(title: string) {
    super(`Le scénario « ${title} » est déjà en cours`)
    this.name = 'ScenarioConflictError'
  }
}

export interface ScenarioRunnerDeps<Handle = unknown> {
  /** Appelle fn après delayMs millisecondes */
  schedule: (fn: () => void, delayMs: number) => Handle
  cancel: (handle: Handle) => void
  /** Horloge en millisecondes epoch */
  now: () => number
  /** Publie l'étape dans son canal ; une exception marque l'étape failed */
  publish: (step: ScenarioStep) => void
  scenarios?: readonly Scenario[]
}

export interface ScenarioRunner {
  list: () => ScenarioSummary[]
  /** Copie de la dernière exécution, ou null si aucun lancement */
  getRun: () => ScenarioRun | null
  /** Lance le scénario ; les étapes à at <= 0 sont publiées avant le retour */
  start: (scenarioId: string) => ScenarioRun
  /** Arrête le scénario en cours (étapes restantes cancelled) ; null si rien n'est en cours */
  stop: () => ScenarioRun | null
}

function copyRun(run: ScenarioRun): ScenarioRun {
  return { ...run, steps: run.steps.map(step => ({ ...step })) }
}

export function createScenarioRunner<Handle>(deps: ScenarioRunnerDeps<Handle>): ScenarioRunner {
  const scenarios = deps.scenarios ?? SCENARIOS
  let run: ScenarioRun | null = null
  let handles: Handle[] = []

  function finishIfDone(current: ScenarioRun) {
    if (current.status === 'running' && current.steps.every(step => step.status !== 'pending')) {
      current.status = 'finished'
      handles = []
    }
  }

  function publishStep(current: ScenarioRun, step: ScenarioStep, index: number) {
    const runStep = current.steps[index]
    // Run remplacé ou arrêté entre-temps : rien à publier
    if (run !== current || current.status !== 'running' || !runStep || runStep.status !== 'pending') return
    try {
      deps.publish(step)
      runStep.status = 'published'
      runStep.publishedAt = new Date(deps.now()).toISOString()
    }
    catch {
      runStep.status = 'failed'
    }
    finishIfDone(current)
  }

  return {
    list() {
      return scenarios.map(scenario => ({
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        stepCount: scenario.steps.length,
        durationSeconds: scenario.steps.reduce((max, step) => Math.max(max, step.at), 0),
      }))
    },

    getRun() {
      return run ? copyRun(run) : null
    },

    start(scenarioId) {
      const scenario = scenarios.find(candidate => candidate.id === scenarioId)
      if (!scenario) throw new ScenarioNotFoundError(scenarioId)
      if (run?.status === 'running') throw new ScenarioConflictError(run.title)

      const current: ScenarioRun = {
        scenarioId: scenario.id,
        title: scenario.title,
        status: 'running',
        startedAt: new Date(deps.now()).toISOString(),
        steps: scenario.steps.map((step, index) => ({
          index,
          at: step.at,
          kind: step.kind,
          channelId: step.channelId,
          label: scenarioStepLabel(step),
          status: 'pending',
        })),
      }
      run = current
      handles = []

      scenario.steps.forEach((step, index) => {
        if (step.at <= 0) publishStep(current, step, index)
        else handles.push(deps.schedule(() => publishStep(current, step, index), step.at * 1000))
      })
      finishIfDone(current)
      return copyRun(current)
    },

    stop() {
      if (!run || run.status !== 'running') return null
      for (const handle of handles) deps.cancel(handle)
      handles = []
      run.status = 'stopped'
      for (const step of run.steps) {
        if (step.status === 'pending') step.status = 'cancelled'
      }
      return copyRun(run)
    },
  }
}

/** Publication réelle dans le store des canaux */
export function publishScenarioStep(step: ScenarioStep): void {
  if (step.kind === 'alert') addAlert(step.channelId, step)
  else addAnnouncement(step.channelId, { text: step.text })
}

const defaultRunner = createScenarioRunner({
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: handle => clearTimeout(handle),
  now: () => Date.now(),
  publish: publishScenarioStep,
})

export function listScenarioSummaries(): ScenarioSummary[] {
  return defaultRunner.list()
}

export function getScenarioRun(): ScenarioRun | null {
  return defaultRunner.getRun()
}

export function startScenario(scenarioId: string): ScenarioRun {
  return defaultRunner.start(scenarioId)
}

/** Arrête le scénario en cours ; renvoie null, sans erreur, si rien n'est en cours. */
export function stopScenario(): ScenarioRun | null {
  return defaultRunner.stop()
}
