<script setup lang="ts">
import { TEXT_MAX_LENGTH } from '~~/shared/utils/limits'
// Champ de réponse inline sous un fil : Entrée envoie, Maj+Entrée passe à la ligne, Échap ferme.
const props = defineProps<{
  send: (text: string) => Promise<void>
}>()

const emit = defineEmits<{
  close: []
  /** Frappe dans le champ (le throttle est géré par la page) */
  typing: []
}>()

const text = ref('')
const sending = ref(false)
const errorMessage = ref('')
const input = ref<HTMLTextAreaElement | null>(null)

const canSend = computed(() => !sending.value && text.value.trim().length > 0)

onMounted(() => input.value?.focus())

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
    // Le champ reste ouvert pour enchaîner une autre réponse
    nextTick(() => input.value?.focus())
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="reply-composer" @submit.prevent="submit">
    <div class="reply-composer__box">
      <textarea
        ref="input"
        v-model="text"
        data-testid="reply-composer"
        class="reply-composer__input"
        rows="1"
        :maxlength="TEXT_MAX_LENGTH"
        :readonly="sending"
        placeholder="Répondre"
        aria-label="Réponse"
        @keydown="onKeydown"
        @input="emit('typing')"
      />
      <button type="submit" class="reply-composer__send" :disabled="!canSend" title="Envoyer la réponse">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M3 20.5 21 12 3 3.5 5.5 12 3 20.5Zm2.5-8.5H13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      </button>
    </div>
    <p v-if="errorMessage" class="reply-composer__error" role="alert">{{ errorMessage }}</p>
  </form>
</template>

<style scoped>
.reply-composer__box {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 4px 4px 4px 10px;
  border-radius: 4px;
  background: #fff;
  border: 1px solid var(--teams-border);
  border-bottom: 2px solid var(--teams-purple);
}

.reply-composer__input {
  flex: 1;
  min-height: 22px;
  max-height: 120px;
  padding: 3px 0;
  border: 0;
  outline: none;
  background: transparent;
  resize: none;
  line-height: 1.4;
  field-sizing: content;
}

.reply-composer__send {
  display: inline-flex;
  align-items: center;
  padding: 4px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--teams-purple);
  cursor: pointer;
}

.reply-composer__send:hover:not(:disabled) {
  background: var(--teams-purple-tint);
}

.reply-composer__send:disabled {
  color: #bdbdbd;
  cursor: default;
}

.reply-composer__error {
  margin: 4px 0 0;
  color: #c4314b;
  font-size: 12px;
}
</style>
