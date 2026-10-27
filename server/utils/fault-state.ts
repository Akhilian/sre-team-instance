// Registre mutable des pannes DocShare connues (name -> value), en mémoire. Alimenté par le runner de
// scénarios, réutilisable plus tard par les actions d'équipe.
export interface FaultState {
  set: (name: string, value: number) => void
  get: (name: string) => number | undefined
  /** Valeur > 0 */
  isActive: (name: string) => boolean
  activeNames: () => string[]
  clear: () => void
}

export function createFaultState(): FaultState {
  const faults = new Map<string, number>()
  return {
    set: (name, value) => { faults.set(name, value) },
    get: name => faults.get(name),
    isActive: name => (faults.get(name) ?? 0) > 0,
    activeNames: () => [...faults].filter(([, value]) => value > 0).map(([name]) => name),
    clear: () => { faults.clear() },
  }
}

export const faultState: FaultState = createFaultState()
