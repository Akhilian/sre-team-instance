// Rôle d'incident du participant et indicateur « onboarding déjà suivi », mémorisés dans le localStorage.
// Lus uniquement côté client (après montage), comme le nom d'affichage, pour éviter tout écart d'hydratation.
import { DEFAULT_ROLE_ID, isRoleId, type RoleId } from '~~/shared/onboarding/roles'

export const ROLE_STORAGE_KEY = 'sre-war-room:role'
export const ONBOARDING_STORAGE_KEY = 'sre-war-room:onboarding-done'

export function useRole() {
  // Rôle choisi ou reçu du serveur ; '' tant qu'aucun n'est connu
  const role = useState<RoleId | ''>('role', () => '')
  const onboardingSeen = useState('onboarding-seen', () => false)
  const roleLoaded = useState('role-loaded', () => false)

  onMounted(() => {
    if (roleLoaded.value) return
    const stored = localStorage.getItem(ROLE_STORAGE_KEY)
    role.value = isRoleId(stored) ? stored : ''
    onboardingSeen.value = localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
    roleLoaded.value = true
  })

  function setRole(next: RoleId) {
    role.value = next
    localStorage.setItem(ROLE_STORAGE_KEY, next)
  }

  function markOnboardingSeen() {
    onboardingSeen.value = true
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  }

  return {
    role: readonly(role),
    roleLoaded: readonly(roleLoaded),
    onboardingSeen: readonly(onboardingSeen),
    setRole,
    markOnboardingSeen,
    defaultRole: DEFAULT_ROLE_ID,
  }
}
