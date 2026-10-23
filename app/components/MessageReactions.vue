<script setup lang="ts">
// Réactions façon Teams sous une bulle : pastilles (emoji + compteur) et palette des 6 emojis.
// Un clic sur une pastille ou un emoji de la palette bascule la réaction du participant courant.
import type { Reaction } from '~~/shared/types/chat'
import { REACTION_EMOJIS } from '~~/shared/utils/reactions'

const props = defineProps<{
  reactions: readonly Reaction[] | undefined
  /** Nom du participant courant ; vide = boutons désactivés */
  me: string
  /** Bascule la réaction du participant courant */
  react: (emoji: string) => Promise<void>
}>()

const root = ref<HTMLElement | null>(null)
const pickerOpen = ref(false)

const disabled = computed(() => props.me === '')

function isMine(reaction: Reaction): boolean {
  return props.me !== '' && reaction.authors.includes(props.me)
}

async function toggle(emoji: string) {
  if (disabled.value) return
  pickerOpen.value = false
  try {
    await props.react(emoji)
  }
  catch {
    // Échec réseau : le polling suivant ramène l'état du serveur
  }
}

// Fermeture de la palette : Échap ou clic hors du composant
function onDocumentPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) pickerOpen.value = false
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    pickerOpen.value = false
  }
}

function removeListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
}

watch(pickerOpen, (open) => {
  removeListeners()
  if (open) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(removeListeners)
</script>

<template>
  <div
    ref="root"
    class="reactions"
    :class="{ 'reactions--empty': !reactions?.length, 'reactions--open': pickerOpen }"
  >
    <button
      v-for="reaction in reactions ?? []"
      :key="reaction.emoji"
      data-testid="reaction"
      :title="reaction.authors.join(', ')"
      type="button"
      class="reaction"
      :class="{ 'reaction--mine': isMine(reaction) }"
      :aria-pressed="isMine(reaction) ? 'true' : 'false'"
      :disabled="disabled"
      @click="toggle(reaction.emoji)"
    >
      <span class="reaction__emoji">{{ reaction.emoji }}</span>
      <span class="reaction__count">{{ reaction.authors.length }}</span>
    </button>

    <div class="reactions__add-wrapper">
      <button
        type="button"
        class="reactions__add"
        data-testid="reaction-add"
        title="Ajouter une réaction"
        aria-label="Ajouter une réaction"
        :aria-expanded="pickerOpen ? 'true' : 'false'"
        :disabled="disabled"
        @click="pickerOpen = !pickerOpen"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 14.5a4 4 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="8.5" cy="10" r="1" fill="currentColor" />
          <circle cx="13.5" cy="10" r="1" fill="currentColor" />
          <path d="M20 3v5M17.5 5.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>

      <div v-if="pickerOpen" class="reaction-picker" data-testid="reaction-picker" role="menu">
        <button
          v-for="emoji in REACTION_EMOJIS"
          :key="emoji"
          type="button"
          class="reaction-picker__emoji"
          role="menuitem"
          :disabled="disabled"
          @click="toggle(emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Rangée de pastilles sous la bulle ; vide, elle ne prend pas de place */
.reactions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.reactions:not(.reactions--empty) {
  margin-top: 4px;
}

.reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--teams-border);
  border-radius: 12px;
  background: #fff;
  color: var(--teams-text);
  font-size: 12px;
  cursor: pointer;
}

.reaction:hover:not(:disabled) {
  border-color: var(--teams-purple);
}

.reaction:disabled {
  cursor: default;
}

/* Réaction du participant courant : fond et bordure violets, façon Teams */
.reaction--mine {
  border-color: var(--teams-purple);
  background: var(--teams-purple-tint);
  color: var(--teams-purple);
  font-weight: 600;
}

.reaction__emoji {
  font-size: 14px;
  line-height: 1;
}

/* Bouton d'ajout flottant sur le coin haut droit de la bulle (positionné par .message__body),
   visible au survol du message, au focus clavier ou palette ouverte : pas de décalage du fil */
.reactions__add-wrapper {
  position: absolute;
  top: -12px;
  right: -10px;
  z-index: 5;
}

.reactions__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--teams-border);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  color: var(--teams-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.1s;
}

:global(.message:hover) .reactions__add,
.reactions__add:focus-visible,
.reactions--open .reactions__add {
  opacity: 1;
}

.reactions__add:hover:not(:disabled) {
  color: var(--teams-purple);
}

.reactions__add:disabled {
  color: #bdbdbd;
  cursor: default;
}

/* Palette ouverte : au-dessus des boutons d'ajout des messages voisins */
.reactions--open .reactions__add-wrapper {
  z-index: 20;
}

/* Palette flottante à droite du bouton, dans la marge laissée à droite des bulles (max 70 %) :
   ne recouvre le texte ni du message suivant ni du précédent. Grille 3 × 2 pour rester étroite. */
.reaction-picker {
  position: absolute;
  top: 0;
  left: calc(100% + 4px);
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(3, 32px);
  gap: 2px;
  padding: 4px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

.reaction-picker__emoji {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.reaction-picker__emoji:hover:not(:disabled) {
  background: var(--teams-purple-tint);
}
</style>
