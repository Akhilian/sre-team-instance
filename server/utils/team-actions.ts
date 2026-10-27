// Actions d'équipe ChatOps : exécuteur des actions déclarées par le scénario en cours (panneau d'actions).
// Les appels à DocShare, l'horloge et les publications sont injectés ; l'état « en cours » est en mémoire.
// Les messages Ops ne contiennent ni jeton ni URL : seules des phrases lisibles y figurent.
import type { Scenario, ScenarioAction, ScenarioRun, TeamActionSummary } from '../../shared/types/scenario'
import { SCENARIOS, INCIDENT_CHANNEL_ID } from '../scenarios'
import { addOpsMessage } from './chat-store'
import { docshareClientFromEnv } from './docshare-client'
import type { DocshareClient } from './docshare-client'
import { faultState } from './fault-state'
import type { FaultState } from './fault-state'
import { getScenarioRun, onScenarioReset } from './scenario-runner'

export const REINDEX_POLL_MS = 5000
export const REINDEX_MAX_MS = 10 * 60 * 1000
export const ACTION_ERROR_TEXT = 'Le service ne répond pas, réessayez dans un instant.'

export type OpsPhase = 'start' | 'progress' | 'done' | 'error'

/** Action ou scénario inconnu, ou aucun scénario en cours déclarant des actions : 404 */
export class TeamActionNotFoundError extends Error {
  constructor() {
    super('Action inconnue')
    this.name = 'TeamActionNotFoundError'
  }
}

export interface TeamActionsDeps<Handle = unknown> {
  client: () => DocshareClient
  faults?: FaultState
  getRun: () => ScenarioRun | null
  scenarios?: () => readonly Scenario[]
  /** Publie un message Ops dans le canal d'incident */
  postOps: (channelId: string, text: string, ops: { action: string, by: string, phase: OpsPhase }) => void
  schedule: (fn: () => void, delayMs: number) => Handle
  cancel: (handle: Handle) => void
  now?: () => number
  pollIntervalMs?: number
  reindexMaxMs?: number
}

export type TeamActionResult
  = { status: 'done' | 'started' }
    | { status: 'conflict', message: string }

export interface TeamActions {
  /** Actions du scénario en cours ; vide sans scénario running déclarant des actions */
  list: () => TeamActionSummary[]
  /** Canal où sont publiés les messages Ops ; null sans scénario running déclarant des actions */
  channelId: () => string | null
  /** Lance l'action ; lève TeamActionNotFoundError si inconnue ou hors scénario */
  run: (actionId: string, author: string) => Promise<TeamActionResult>
  /** Annule timers et sondages, vide l'état running ; aucun message ensuite */
  stop: () => void
}

function typeOf(action: ScenarioAction) {
  return action.type ?? 'simulated'
}

function incidentChannelOf(scenario: Scenario): string {
  for (const step of scenario.steps) {
    if (step.kind !== 'fault') return step.channelId
  }
  return INCIDENT_CHANNEL_ID
}

export function createTeamActions<Handle>(deps: TeamActionsDeps<Handle>): TeamActions {
  const faults = deps.faults ?? faultState
  const now = deps.now ?? (() => Date.now())
  const pollMs = deps.pollIntervalMs ?? REINDEX_POLL_MS
  const reindexMaxMs = deps.reindexMaxMs ?? REINDEX_MAX_MS
  const scenarios = deps.scenarios ?? (() => SCENARIOS)
  // Génération : incrémentée par stop(), les rappels d'une génération périmée ne publient rien
  let epoch = 0
  const running = new Set<string>()
  const handles = new Set<Handle>()
  let reindexProgress: { processed: number, total: number } | null = null

  function active(): { scenario: Scenario, actions: ScenarioAction[] } | null {
    const run = deps.getRun()
    if (!run || run.status !== 'running') return null
    const scenario = scenarios().find(candidate => candidate.id === run.scenarioId)
    if (!scenario?.actions?.length) return null
    return { scenario, actions: scenario.actions }
  }

  function later(generation: number, fn: () => void, delayMs: number) {
    const handle = deps.schedule(() => {
      handles.delete(handle)
      if (generation === epoch) fn()
    }, delayMs)
    handles.add(handle)
  }

  function post(channelId: string, action: ScenarioAction, by: string, phase: OpsPhase, text: string) {
    try {
      deps.postOps(channelId, text, { action: action.label, by, phase })
    }
    catch (error) {
      console.error(`[actions] publication impossible : ${error instanceof Error ? error.message : 'erreur'}`)
    }
  }

  function fail(generation: number, channelId: string, action: ScenarioAction, by: string) {
    if (generation !== epoch) return
    running.delete(action.id)
    if (typeOf(action) === 'reindex') reindexProgress = null
    post(channelId, action, by, 'error', ACTION_ERROR_TEXT)
  }

  async function runSimulated(generation: number, channelId: string, action: ScenarioAction, by: string) {
    running.add(action.id)
    post(channelId, action, by, 'start', action.startText ?? `${action.label} : démarré.`)
    later(generation, () => {
      void (async () => {
        try {
          for (const fault of action.faults ?? []) {
            await deps.client().setFault(fault.name, fault.value)
            if (generation !== epoch) return
            faults.set(fault.name, fault.value)
          }
        }
        catch {
          fail(generation, channelId, action, by)
          return
        }
        if (generation !== epoch) return
        running.delete(action.id)
        post(channelId, action, by, 'done', action.doneText ?? `${action.label} : terminé.`)
      })()
    }, (action.delaySeconds ?? 0) * 1000)
  }

  function progressText(action: ScenarioAction, processed: number, total: number): string {
    return `${action.label} : ${processed}/${total}`
  }

  async function runReindex(generation: number, channelId: string, action: ScenarioAction, by: string): Promise<TeamActionResult> {
    if (running.has(action.id)) {
      // Pas de second POST /ops/reindex : on affiche la progression courante
      let text = `${action.label} est déjà en cours.`
      try {
        const current = await deps.client().getReindex()
        if (generation !== epoch) return { status: 'conflict', message: text }
        reindexProgress = { processed: current.processed, total: current.total }
        text = `${action.label} est déjà en cours : ${current.processed}/${current.total}.`
      }
      catch {
        if (generation === epoch && reindexProgress) text = `${action.label} est déjà en cours : ${reindexProgress.processed}/${reindexProgress.total}.`
      }
      if (generation === epoch) post(channelId, action, by, 'progress', text)
      return { status: 'conflict', message: text }
    }
    running.add(action.id)
    const startedAt = now()
    let last: number
    try {
      const started = await deps.client().startReindex()
      if (generation !== epoch) return { status: 'started' }
      last = started.processed
      reindexProgress = { processed: started.processed, total: started.total }
      post(channelId, action, by, 'start', action.startText ?? `${action.label} : démarrée.`)
      if (started.state === 'done') {
        running.delete(action.id)
        reindexProgress = null
        post(channelId, action, by, 'done', started.summary ?? action.doneText ?? `${action.label} : terminée.`)
        return { status: 'done' }
      }
    }
    catch {
      fail(generation, channelId, action, by)
      return { status: 'done' }
    }

    const poll = async () => {
      try {
        const status = await deps.client().getReindex()
        if (generation !== epoch) return
        if (status.processed !== last) {
          last = status.processed
          reindexProgress = { processed: status.processed, total: status.total }
          post(channelId, action, by, 'progress', progressText(action, status.processed, status.total))
        }
        if (status.state === 'done') {
          running.delete(action.id)
          reindexProgress = null
          post(channelId, action, by, 'done', status.summary ?? action.doneText ?? `${action.label} : terminée.`)
          return
        }
        if (now() - startedAt >= reindexMaxMs) {
          fail(generation, channelId, action, by)
          return
        }
        later(generation, () => void poll(), pollMs)
      }
      catch {
        fail(generation, channelId, action, by)
      }
    }
    later(generation, () => void poll(), pollMs)
    return { status: 'started' }
  }

  return {
    list() {
      const current = active()
      if (!current) return []
      return current.actions.map(action => ({
        id: action.id,
        label: action.label,
        type: typeOf(action),
        running: running.has(action.id),
      }))
    },

    channelId() {
      const current = active()
      return current ? incidentChannelOf(current.scenario) : null
    },

    async run(actionId, author) {
      const current = active()
      const action = current?.actions.find(candidate => candidate.id === actionId)
      if (!current || !action) throw new TeamActionNotFoundError()
      const generation = epoch
      const channelId = incidentChannelOf(current.scenario)
      const type = typeOf(action)

      if (type === 'changelog') {
        post(channelId, action, author, 'done', action.text ?? action.label)
        return { status: 'done' }
      }
      if (type === 'index-check') {
        try {
          const result = await deps.client().indexCheck()
          if (generation !== epoch) return { status: 'done' }
          post(channelId, action, author, 'done', result.summary || action.doneText || `${action.label} : terminé.`)
        }
        catch {
          fail(generation, channelId, action, author)
        }
        return { status: 'done' }
      }
      if (type === 'reindex') return runReindex(generation, channelId, action, author)

      if (running.has(action.id)) {
        return { status: 'conflict', message: `${action.label} est déjà en cours.` }
      }
      await runSimulated(generation, channelId, action, author)
      return { status: 'started' }
    },

    stop() {
      epoch++
      for (const handle of handles) deps.cancel(handle)
      handles.clear()
      running.clear()
      reindexProgress = null
    },
  }
}

const defaultActions = createTeamActions({
  client: () => docshareClientFromEnv(),
  getRun: getScenarioRun,
  postOps: (channelId, text, ops) => { addOpsMessage(channelId, { text, ops }) },
  schedule: (fn, delayMs) => setTimeout(fn, delayMs),
  cancel: handle => clearTimeout(handle),
})

// Lancement, arrêt ou reset d'un scénario : timers et sondages en attente annulés
onScenarioReset(() => defaultActions.stop())

export function listTeamActions(): TeamActionSummary[] {
  return defaultActions.list()
}

export function teamActionsChannelId(): string | null {
  return defaultActions.channelId()
}

export function runTeamAction(actionId: string, author: string): Promise<TeamActionResult> {
  return defaultActions.run(actionId, author)
}
