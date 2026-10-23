// Libellé de l'indicateur « en train d'écrire » (fonction pure, testée directement par Vitest)

/** Libellé façon Teams pour les noms en train d'écrire, sans soi-même (`me`). */
export function typingLabel(names: readonly string[], me: string): string {
  const self = me.trim()
  const others = names.filter(name => name !== self)
  if (others.length === 0) return ''
  if (others.length === 1) return `${others[0]} écrit…`
  if (others.length === 2) return `${others[0]} et ${others[1]} écrivent…`
  return 'Plusieurs personnes écrivent…'
}
