<script setup lang="ts">
// Modale de choix du nom d'affichage (1 à 50 caractères), fermable seulement si un nom existe déjà.
const props = defineProps<{
  initialName: string
  cancellable: boolean
}>()

const emit = defineEmits<{
  save: [name: string]
  cancel: []
}>()

const MAX_LENGTH = DISPLAY_NAME_MAX_LENGTH

const name = ref(props.initialName)
const input = ref<HTMLInputElement | null>(null)
const trimmed = computed(() => name.value.trim())
const valid = computed(() => trimmed.value.length >= 1 && trimmed.value.length <= MAX_LENGTH)

onMounted(() => input.value?.focus())

function submit() {
  if (valid.value) emit('save', trimmed.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.cancellable) emit('cancel')
}
</script>

<template>
  <div class="dialog-backdrop" @keydown="onKeydown">
    <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="display-name-title" @submit.prevent="submit">
      <h2 id="display-name-title">{{ cancellable ? 'Modifier votre nom' : 'Bienvenue dans l\'équipe SRE' }}</h2>
      <p>Choisissez le nom affiché à côté de vos messages.</p>
      <label for="display-name-input">Nom d'affichage</label>
      <input
        id="display-name-input"
        ref="input"
        v-model="name"
        data-testid="display-name-input"
        type="text"
        :maxlength="MAX_LENGTH"
        autocomplete="name"
        placeholder="Ex. Alice Martin"
      >
      <div class="dialog__hint">{{ trimmed.length }}/{{ MAX_LENGTH }}</div>
      <div class="dialog__actions">
        <button v-if="cancellable" type="button" class="button button--secondary" @click="emit('cancel')">Annuler</button>
        <button type="submit" class="button button--primary" :disabled="!valid">Valider</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(36, 36, 36, 0.45);
}

.dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 24px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}

.dialog h2 {
  margin: 0 0 8px;
  font-size: 20px;
}

.dialog p {
  margin: 0 0 18px;
  color: var(--teams-text-muted);
}

.dialog label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
}

.dialog input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #d1d1d1;
  border-bottom: 2px solid #d1d1d1;
  border-radius: 4px;
  outline: none;
  background: #fff;
}

.dialog input:focus {
  border-bottom-color: var(--teams-purple);
}

.dialog__hint {
  margin-top: 4px;
  text-align: right;
  font-size: 12px;
  color: var(--teams-text-muted);
}

.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.button {
  padding: 6px 18px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}

.button--primary {
  border: 1px solid var(--teams-purple);
  background: var(--teams-purple);
  color: #fff;
}

.button--primary:hover:not(:disabled) {
  background: var(--teams-purple-dark);
}

.button--primary:disabled {
  border-color: #e0e0e0;
  background: #f0f0f0;
  color: #bdbdbd;
  cursor: default;
}

.button--secondary {
  border: 1px solid #d1d1d1;
  background: #fff;
}

.button--secondary:hover {
  background: #f5f5f5;
}
</style>
