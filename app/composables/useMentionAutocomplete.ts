import type { MentionCandidate } from '~~/shared/utils/mentions'
import { mentionQueryAt, suggestMentions } from '~~/shared/utils/mentions'

/**
 * Autocomplétion des `@mentions` d'un champ texte : liste de suggestions, clavier (↑ ↓ Entrée Tab Échap),
 * insertion de `@Nom Complet ` à la place de la requête. Le composant branche `onKeydown` (renvoie true si
 * l'événement est consommé), `refresh` (frappe, clic, flèches) et les attributs ARIA.
 */
export function useMentionAutocomplete(options: {
  text: Ref<string>
  input: Ref<HTMLTextAreaElement | null>
  candidates: () => readonly MentionCandidate[]
  me: () => string
}) {
  const id = useId()
  const listId = `mention-list-${id}`
  const optionId = (index: number) => `mention-option-${id}-${index}`

  const query = ref<{ start: number, query: string, caret: number } | null>(null)
  const active = ref(0)
  // Requête fermée par Échap : la liste ne revient que si la requête change
  const dismissed = ref('')

  const suggestions = computed(() => {
    const current = query.value
    if (!current || current.query === '') return []
    return suggestMentions(current.query, options.candidates(), 5, options.me())
  })
  const open = computed(() => {
    const current = query.value
    return suggestions.value.length > 0 && current !== null && dismissed.value !== `${current.start}:${current.query}`
  })
  const activeDescendant = computed(() => open.value ? optionId(active.value) : undefined)

  /** À rappeler après chaque frappe ou déplacement du curseur */
  function refresh() {
    const el = options.input.value
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    const found = mentionQueryAt(el.value, caret)
    const previous = query.value
    query.value = found ? { ...found, caret } : null
    if (!previous || !found || previous.start !== found.start || previous.query !== found.query) active.value = 0
  }

  function select(index: number) {
    const current = query.value
    const picked = suggestions.value[index]
    if (!current || !picked) return
    const value = options.text.value
    const inserted = `@${picked.name} `
    options.text.value = value.slice(0, current.start) + inserted + value.slice(current.caret)
    const caret = current.start + inserted.length
    query.value = null
    nextTick(() => {
      const el = options.input.value
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function onKeydown(event: KeyboardEvent): boolean {
    if (!open.value || event.isComposing) return false
    const count = suggestions.value.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      select(active.value)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      const current = query.value!
      dismissed.value = `${current.start}:${current.query}`
      return true
    }
    return false
  }

  return { listId, optionId, suggestions, open, active, activeDescendant, refresh, select, onKeydown }
}
