// Scénarios fournis avec le dépôt, dans l'ordre d'affichage de /admin
import type { Scenario } from '../../shared/types/scenario'
import { demoExpress } from './demo-express'
import { fuiteDonnees } from './fuite-donnees'
import { panneCheckout } from './panne-checkout'

export const SCENARIOS: readonly Scenario[] = [panneCheckout, fuiteDonnees, demoExpress]

/** Scénario de PNJ activé au lancement de scenario : npcScenarioId, sinon son propre id */
export function npcScenarioIdOf(scenario: Scenario): string {
  return scenario.npcScenarioId ?? scenario.id
}

/** Scénario de PNJ du scénario scenarioId ; scenarioId lui-même s'il est inconnu */
export function npcScenarioIdFor(scenarioId: string): string {
  const scenario = SCENARIOS.find(candidate => candidate.id === scenarioId)
  return scenario ? npcScenarioIdOf(scenario) : scenarioId
}
