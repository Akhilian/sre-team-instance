// Store en mémoire des rôles d'incident, par nom de participant. Module pur (sans auto-import Nuxt) :
// les présents sont passés en argument, jamais lus ici. Perdu au redémarrage comme la présence,
// et non touché par les resets (le rôle suit le participant, pas la conversation).
import { AUTHOR_MAX_LENGTH, PRESENCE_ENTRIES_MAX } from '../../shared/utils/limits'
import { isRoleId, type RoleId } from '../../shared/onboarding/roles'

export class RoleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RoleValidationError'
  }
}

// L'ordre d'insertion de la Map sert d'ancienneté : une réaffectation replace le nom en dernier
let roles = new Map<string, RoleId>()

export function resetRoleStore(): void {
  roles = new Map()
}

/** Valide `name` (même règle que l'auteur) et `role` ; renvoie le nom rogné. */
export function validateRoleInput(input: { name?: unknown, role?: unknown }): { name: string, role: RoleId } {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (name.length === 0) throw new RoleValidationError('name est obligatoire')
  if (name.length > AUTHOR_MAX_LENGTH) throw new RoleValidationError(`name dépasse ${AUTHOR_MAX_LENGTH} caractères`)
  if (!isRoleId(input.role)) throw new RoleValidationError('role est invalide')
  return { name, role: input.role }
}

/** Affecte (ou réaffecte) un rôle ; au-delà de PRESENCE_ENTRIES_MAX noms, l'affectation la plus ancienne est écartée. */
export function setRole(input: { name?: unknown, role?: unknown }): { name: string, role: RoleId } {
  const valid = validateRoleInput(input)
  roles.delete(valid.name)
  roles.set(valid.name, valid.role)
  while (roles.size > PRESENCE_ENTRIES_MAX) {
    roles.delete(roles.keys().next().value!)
  }
  return valid
}

export function getRole(name: string): RoleId | undefined {
  return roles.get(name)
}

/** Rôles des seuls noms donnés (les présents) qui en ont un. */
export function rolesOf(names: readonly string[]): Record<string, RoleId> {
  const result: Record<string, RoleId> = {}
  for (const name of names) {
    const role = roles.get(name)
    if (role) result[name] = role
  }
  return result
}

/** Vrai si au moins un des noms donnés (les présents) est Responsable d'incident. */
export function hasIncidentCommander(names: readonly string[]): boolean {
  return names.some(name => roles.get(name) === 'incident-commander')
}
