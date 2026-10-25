// Nom d'affichage du participant, mémorisé dans le localStorage du navigateur.
// Lu uniquement côté client (après montage) pour ne pas créer d'écart d'hydratation.
import { AUTHOR_MAX_LENGTH } from '~~/shared/utils/limits'

export const DISPLAY_NAME_STORAGE_KEY = 'sre-war-room:display-name'
// Même limite que l'auteur d'un message côté API
export const DISPLAY_NAME_MAX_LENGTH = AUTHOR_MAX_LENGTH

export function useDisplayName() {
  const displayName = useState('display-name', () => '')
  // Vrai une fois le localStorage lu : évite d'afficher la modale avant de savoir si un nom existe
  const loaded = useState('display-name-loaded', () => false)

  onMounted(() => {
    if (loaded.value) return
    displayName.value = localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)?.trim().slice(0, DISPLAY_NAME_MAX_LENGTH) ?? ''
    loaded.value = true
  })

  function setDisplayName(name: string) {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX_LENGTH) return
    displayName.value = trimmed
    localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, trimmed)
  }

  return { displayName: readonly(displayName), loaded: readonly(loaded), setDisplayName }
}
