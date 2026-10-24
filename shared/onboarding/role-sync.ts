// Synchronisation du rôle entre le choix local et le serveur (qui fait foi une fois le choix confirmé).
import { isRoleId, type RoleId } from './roles'

export type RoleSyncAction
  = { type: 'none' }
  // Adopter le rôle du serveur (réattribution par l'animateur)
  | { type: 'adopt', role: RoleId }
  // Renvoyer un rôle au serveur : choix en attente de confirmation, ou rôle local inconnu du serveur
  | { type: 'push', role: RoleId }

export function decideRoleSync(input: {
  /** Choix local pas encore confirmé par le serveur */
  pending: RoleId | null
  local: RoleId | ''
  server: string | undefined
}): RoleSyncAction {
  // Un choix non confirmé n'est jamais écrasé : on le renvoie à chaque battement
  if (input.pending) return { type: 'push', role: input.pending }
  if (isRoleId(input.server)) {
    return input.server === input.local ? { type: 'none' } : { type: 'adopt', role: input.server }
  }
  return input.local ? { type: 'push', role: input.local } : { type: 'none' }
}
