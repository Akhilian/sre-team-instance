<script setup lang="ts">
// Outils d'animateur (page non liée dans la navigation) : annonce dans un canal, réinitialisation
// des conversations. Le code animateur est gardé dans le sessionStorage, envoyé en x-facilitator-code.
import type { Message } from '~~/shared/types/chat'

const FACILITATOR_CODE_STORAGE_KEY = 'sre-team-instance:facilitator-code'
const TEXT_MAX_LENGTH = 2000

useHead({ title: 'Animateur | SRE Team Instance' })

const { data: channels } = await useFetch('/api/channels', { default: () => [] })

const code = ref('')
const channelId = ref(channels.value.find(channel => channel.id.startsWith('incident-'))?.id ?? channels.value[0]?.id ?? '')
const text = ref('')
const busy = ref(false)
const status = ref<{ kind: 'success' | 'error', text: string } | null>(null)

onMounted(() => {
  code.value = sessionStorage.getItem(FACILITATOR_CODE_STORAGE_KEY) ?? ''
})

watch(code, value => sessionStorage.setItem(FACILITATOR_CODE_STORAGE_KEY, value))

const canPublish = computed(() => !busy.value && code.value !== '' && channelId.value !== '' && text.value.trim() !== '')
const canReset = computed(() => !busy.value && code.value !== '')

function errorText(error: unknown): string {
  const { statusCode, data } = error as { statusCode?: number, data?: { message?: string } }
  if (statusCode === 401) return 'Code animateur invalide'
  return data?.message ?? 'Échec de la requête, réessayez.'
}

async function run(action: () => Promise<string>) {
  busy.value = true
  status.value = null
  try {
    status.value = { kind: 'success', text: await action() }
  }
  catch (error) {
    status.value = { kind: 'error', text: errorText(error) }
  }
  finally {
    busy.value = false
  }
}

function publish() {
  if (!canPublish.value) return
  return run(async () => {
    await $fetch<Message>('/api/admin/announcements', {
      method: 'POST',
      headers: { 'x-facilitator-code': code.value },
      body: { channelId: channelId.value, text: text.value.trim() },
    })
    const name = channels.value.find(channel => channel.id === channelId.value)?.name ?? channelId.value
    text.value = ''
    return `Annonce publiée dans « ${name} ».`
  })
}

function reset() {
  if (!canReset.value) return
  if (!confirm('Effacer les messages de tous les canaux ? Les canaux sont conservés.')) return
  return run(async () => {
    await $fetch('/api/admin/reset', { method: 'POST', headers: { 'x-facilitator-code': code.value } })
    return 'Conversations réinitialisées.'
  })
}
</script>

<template>
  <div class="admin">
    <header class="admin__bar">
      <span class="admin__brand">SRE Team Instance</span>
      <span class="admin__role">Animateur</span>
    </header>

    <main class="admin__content">
      <h1>Outils d'animateur</h1>

      <section class="card">
        <label for="facilitator-code">Code animateur</label>
        <input
          id="facilitator-code"
          v-model="code"
          data-testid="facilitator-code"
          type="password"
          autocomplete="off"
          placeholder="Code communiqué à l'animateur"
        >
      </section>

      <form class="card" @submit.prevent="publish">
        <h2>Publier une annonce</h2>
        <label for="announcement-channel">Canal</label>
        <select id="announcement-channel" v-model="channelId" data-testid="announcement-channel">
          <option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
        </select>
        <label for="announcement-text">Texte</label>
        <textarea
          id="announcement-text"
          v-model="text"
          data-testid="announcement-text"
          rows="3"
          :maxlength="TEXT_MAX_LENGTH"
          placeholder="Ex. 14h02 : le taux d'erreur du checkout passe à 30 %"
        />
        <div class="card__actions">
          <button type="submit" class="button button--primary" data-testid="announcement-submit" :disabled="!canPublish">
            Publier l'annonce
          </button>
        </div>
      </form>

      <section class="card">
        <h2>Entre deux groupes</h2>
        <p>Efface les messages de tous les canaux. Les canaux, y compris ceux créés par les participants, sont conservés.</p>
        <div class="card__actions">
          <button type="button" class="button button--danger" data-testid="reset" :disabled="!canReset" @click="reset">
            Réinitialiser les conversations
          </button>
        </div>
      </section>

      <p
        v-if="status"
        class="admin__status"
        :class="`admin__status--${status.kind}`"
        :role="status.kind === 'error' ? 'alert' : 'status'"
        data-testid="admin-status"
      >
        {{ status.text }}
      </p>
    </main>
  </div>
</template>

<style scoped>
.admin {
  min-height: 100%;
  background: var(--teams-bg);
}

.admin__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 22px;
  background: var(--teams-purple-dark);
  color: #fff;
  font-weight: 600;
}

.admin__role {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 12px;
}

.admin__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

.admin__content h1 {
  margin: 0;
  font-size: 20px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.card h2 {
  margin: 0 0 4px;
  font-size: 16px;
}

.card p {
  margin: 0;
  color: var(--teams-text-muted);
}

.card label {
  margin-top: 4px;
  font-weight: 600;
}

.card input,
.card select,
.card textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #d1d1d1;
  border-bottom: 2px solid #d1d1d1;
  border-radius: 4px;
  outline: none;
  background: #fff;
  font: inherit;
}

.card textarea {
  resize: vertical;
}

.card input:focus,
.card select:focus,
.card textarea:focus {
  border-bottom-color: var(--teams-purple);
}

.card__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
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

.button--danger {
  border: 1px solid #c4314b;
  background: #fff;
  color: #c4314b;
}

.button--danger:hover:not(:disabled) {
  background: #fdf3f4;
}

.button:disabled {
  border-color: #e0e0e0;
  background: #f0f0f0;
  color: #bdbdbd;
  cursor: default;
}

.admin__status {
  margin: 0;
  padding: 10px 14px;
  border-radius: 4px;
  font-weight: 600;
}

.admin__status--success {
  background: #e7f2da;
  color: #237b4b;
}

.admin__status--error {
  background: #fdf3f4;
  color: #c4314b;
}
</style>
