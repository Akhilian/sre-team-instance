// Fonctions pures d'affichage des messages (sans auto-import Nuxt : testées directement par Vitest)

/** Initiales d'un nom : première lettre du premier et du dernier mot, en majuscules (2 lettres max). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]!
  const last = words.length > 1 ? words[words.length - 1]! : ''
  // Array.from pour ne pas couper un caractère hors BMP (emoji, etc.)
  const letters = [first, last].filter(Boolean).map(word => Array.from(word)[0] ?? '')
  return letters.join('').toLocaleUpperCase('fr-FR')
}

const AVATAR_COLORS = ['#5b5fc7', '#c4314b', '#0f6cbd', '#038387', '#8764b8', '#ca5010', '#498205', '#986f0b']

/** Couleur d'avatar stable pour un nom donné (même rendu côté serveur et client). */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name.trim()) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

/** Heure HH:MM en heure de Paris : déterministe entre le rendu SSR et l'hydratation client. */
export function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
  })
}
