// Scénarios fournis avec le dépôt, dans l'ordre d'affichage de /admin
import type { Scenario } from '../../shared/types/scenario'
import { demoExpress } from './demo-express'
import { panneCheckout } from './panne-checkout'

export const SCENARIOS: readonly Scenario[] = [panneCheckout, demoExpress]
