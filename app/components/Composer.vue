<script setup lang="ts">
import { TEXT_MAX_LENGTH } from '~~/shared/utils/limits'
// Champ de saisie en bas du fil : Entrée envoie, Maj+Entrée passe à la ligne.
const props = defineProps<{
  disabled: boolean
  channelName: string
  send: (text: string) => Promise<void>
}>()

const emit = defineEmits<{
  /** Frappe dans le champ (le throttle est géré par la page) */
  typing: []
}>()

const text = ref('')
const sending = ref(false)
const errorMessage = ref('')

const canSend = computed(() => !props.disabled && !sending.value && text.value.trim().length > 0)

async function submit() {
  if (!canSend.value) return
  sending.value = true
  errorMessage.value = ''
  try {
    await props.send(text.value.trim())
    text.value = ''
  }
  catch {
    errorMessage.value = 'Échec de l\'envoi, réessayez.'
  }
  finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="composer__box" :class="{ 'composer__box--disabled': disabled }">
      <textarea
        v-model="text"
        data-testid="composer"
        class="composer__input"
        rows="1"
        :maxlength="TEXT_MAX_LENGTH"
        :disabled="disabled"
        :placeholder="disabled ? 'Choisissez un nom d\'affichage pour écrire' : `Écrire dans ${channelName}`"
        aria-label="Message"
        @keydown="onKeydown"
        @input="emit('typing')"
      />
      <button type="submit" class="composer__send" :disabled="!canSend" title="Envoyer">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M3 20.5 21 12 3 3.5 5.5 12 3 20.5Zm2.5-8.5H13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
        <span>Envoyer</span>
      </button>
    </div>
    <p v-if="errorMessage" class="composer__error" role="alert">{{ errorMessage }}</p>
  </form>
</template>

<style scoped>
.composer {
  padding: 0 32px 20px;
}

.composer__box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 960px;
  margin: 0 auto;
  padding: 8px 8px 8px 14px;
  border-radius: 6px;
  background: #fff;
  border-bottom: 2px solid transparent;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
}

.composer__box:focus-within {
  border-bottom-color: var(--teams-purple);
}

.composer__box--disabled {
  background: #f0f0f0;
}

.composer__input {
  flex: 1;
  min-height: 24px;
  max-height: 160px;
  padding: 4px 0;
  border: 0;
  outline: none;
  background: transparent;
  resize: none;
  line-height: 1.45;
  field-sizing: content;
}

.composer__input:disabled {
  cursor: not-allowed;
}

.composer__send {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: var(--teams-purple);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.composer__send:hover:not(:disabled) {
  background: var(--teams-purple-dark);
}

.composer__send:disabled {
  background: transparent;
  color: #bdbdbd;
  cursor: default;
}

.composer__error {
  max-width: 960px;
  margin: 6px auto 0;
  color: #c4314b;
  font-size: 12px;
}

/* Écran étroit : marges réduites, le champ peut rétrécir sous sa largeur intrinsèque */
@media (max-width: 767px) {
  .composer {
    padding: 0 12px 12px;
  }

  .composer__input {
    min-width: 0;
  }
}
</style>
