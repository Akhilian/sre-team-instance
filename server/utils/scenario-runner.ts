// Exécuteur de scénarios d'incident en mémoire : un seul scénario en cours à la fois, perdu au redémarrage.
// Module pur (sans auto-import Nuxt) : planificateur, horloge, recherche des fiches de PNJ et publication
// injectés par createScenarioRunner.
import type { NpcPersona } from '../../shared/types/npc'
import type {
  Scenario,
  ScenarioRun,
  ScenarioStep,
  ScenarioSummary,
} from '../../shared/types/scenario'
import { scenarioStepLabel } from '../../shared/utils/scenarios'
import { INCIDENT_CHANNEL_ID, SCENARIOS } from '../scenarios'
import { docshareClientFromEnv } from './docshare-client'
import { faultState } from './fault-state'
import type { FaultState } from './fault-state'
import { addAlert, addAnnouncement, addNpcMessage } from './chat-store'
import { findLoadedNpcPersona, startSpontaneousInterventions, stopSpontaneousInterventions } from './npc'

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
  /**
   * Publie l'étape dans son canal, avec la fiche résolue pour une étape npc-message ; une exception
   * marque l'étape failed
   */
  publish: (step: ScenarioStep, npc?: NpcPersona) => void
  /** Fiche de PNJ d'id npcId (synchrone : fiches déjà chargées) ; absente → étapes npc-message failed */
  findNpc?: (npcId: string) => NpcPersona | undefined
  /** Applique une panne DocShare (étapes fault) ; rejet → étape failed. Absent : toute étape fault échoue */
  applyFault?: (name: string, value: number) => Promise<void>
  /** Registre des pannes (défaut : singleton du module fault-state) */
  faults?: FaultState
  scenarios?: readonly Scenario[]
  /** Appelé quand un scénario est lancé (après la publication des étapes à at <= 0) */
  onStart?: (run: ScenarioRun) => void
  /** Appelé quand le scénario en cours est arrêté (stop) */
  onStop?: (run: ScenarioRun) => void
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
  const faults = deps.faults ?? faultState
  // Pannes activées avec succès par le scénario (valeur > 0), à couper à l'arrêt
  const activated = new Set<string>()

  async function cutFault(name: string) {
    try {
      if (!deps.applyFault) throw new Error('applyFault absent')
      await deps.applyFault(name, 0)
    }
    catch (error) {
      console.error(`[scenario] échec de coupure de la panne ${name} : ${error instanceof Error ? error.message : 'erreur'}`)
    }
  }

  function cutActivatedFaults() {
    const names = [...activated]
    activated.clear()
    faults.clear()
    for (const name of names) void cutFault(name)
  }

  function publishFault(current: ScenarioRun, step: Extract<ScenarioStep, { kind: 'fault' }>, runStep: ScenarioRun['steps'][number]) {
    const apply = deps.applyFault
    if (!apply) {
      runStep.status = 'failed'
      return
    }
    // Reste pending jusqu'à la résolution de l'appel
    let promise: Promise<void>
    try {
      promise = apply(step.name, step.value)
    }
    catch {
      promise = Promise.reject(new Error('échec'))
    }
    promise.then(() => {
      if (run !== current || current.status !== 'running') {
        // Scénario arrêté pendant l'appel : la panne vient d'être posée, on la coupe aussitôt
        if (step.value > 0) void cutFault(step.name)
        return
      }
      faults.set(step.name, step.value)
      if (step.value > 0) activated.add(step.name)
      else activated.delete(step.name)
      runStep.status = 'published'
      runStep.publishedAt = new Date(deps.now()).toISOString()
      finishIfDone(current)
    }, () => {
      if (run !== current || current.status !== 'running') return
      runStep.status = 'failed'
      finishIfDone(current)
    })
  }

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
    if (step.when && faults.isActive(step.when.fault) !== step.when.active) {
      runStep.status = 'cancelled'
      finishIfDone(current)
      return
    }
    if (step.kind === 'fault') {
      publishFault(current, step, runStep)
      finishIfDone(current)
      return
    }
    try {
      if (step.kind === 'npc-message') {
        const npc = deps.findNpc?.(step.npcId)
        if (!npc) throw new Error(`Fiche PNJ inconnue : ${step.npcId}`)
        deps.publish(step, npc)
      }
      else deps.publish(step)
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
          channelId: step.kind === 'fault' ? '' : step.channelId,
          label: scenarioStepLabel(step, step.kind === 'npc-message' ? deps.findNpc?.(step.npcId)?.name : undefined),
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
      deps.onStart?.(copyRun(current))
      return copyRun(current)
    },

    stop() {
      if (!run || run.status !== 'running') {
        // Rien en cours, mais des pannes d'un scénario terminé peuvent rester actives
        cutActivatedFaults()
        return null
      }
      for (const handle of handles) deps.cancel(handle)
      handles = []
      run.status = 'stopped'
      for (const step of run.steps) {
        if (step.status === 'pending') step.status = 'cancelled'
      }
      cutActivatedFaults()
      deps.onStop?.(copyRun(run))
      return copyRun(run)
    },
  }
}

/** Publication réelle dans le store des canaux ; un message de PNJ est un message racine signé de la fiche */
export function publishScenarioStep(step: ScenarioStep, npc?: NpcPersona): void {
  if (step.kind === 'alert') addAlert(step.channelId, step)
  else if (step.kind === 'npc-message') {
    if (!npc) throw new Error(`Fiche PNJ non résolue : ${step.npcId}`)
    addNpcMessage(step.channelId, { npc, text: step.text })
  }
  else if (step.kind === 'fault') throw new Error('Étape fault : appliquée par le runner')
  else addAnnouncement(step.channelId, { text: step.text })
}

const defaultRunner = createScenarioRunner({
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: handle => clearTimeout(handle),
  now: () => Date.now(),
  publish: publishScenarioStep,
  applyFault: (name, value) => docshareClientFromEnv().setFault(name, value),
  // Fiches chargées par useNpcDispatcher(), attendu par la route de lancement avant startScenario
  findNpc: findLoadedNpcPersona,
  // Interventions spontanées des PNJ : actives du lancement à l'arrêt (stop, reset) du scénario
  onStart: () => startSpontaneousInterventions(INCIDENT_CHANNEL_ID),
  onStop: () => stopSpontaneousInterventions(),
})

export function listScenarioSummaries(): ScenarioSummary[] {
  return defaultRunner.list()
}

export function getScenarioRun(): ScenarioRun | null {
  return defaultRunner.getRun()
}

// Modules à remettre à zéro quand un scénario démarre ou s'arrête (ex. actions d'équipe en attente)
const resetListeners = new Set<() => void>()

/** Enregistre fn, appelée après chaque lancement réussi et chaque stopScenario (même sans scénario en cours) */
export function onScenarioReset(fn: () => void): void {
  resetListeners.add(fn)
}

function notifyReset(): void {
  for (const fn of resetListeners) fn()
}

export function startScenario(scenarioId: string): ScenarioRun {
  const run = defaultRunner.start(scenarioId)
  notifyReset()
  return run
}

/** Arrête le scénario en cours ; renvoie null, sans erreur, si rien n'est en cours. */
export function stopScenario(): ScenarioRun | null {
  const run = defaultRunner.stop()
  notifyReset()
  return run
}
