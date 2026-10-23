// Jeu fixe de réactions façon Teams, dans l'ordre de la palette.
// Chaînes comparées telles quelles : ❤️ inclut le sélecteur de variante U+FE0F.
export const REACTION_EMOJIS = ['👍', '❤️', '😆', '😮', '😢', '😡'] as const

export type ReactionEmoji = typeof REACTION_EMOJIS[number]

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (REACTION_EMOJIS as readonly string[]).includes(value)
}
