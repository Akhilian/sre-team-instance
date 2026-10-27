<script setup lang="ts">
// Panneau d'actions d'équipe (ChatOps) près de la saisie du canal d'incident : un bouton par action du
// scénario en cours, désactivé tant qu'elle tourne. Absent sans scénario déclarant des actions.
import type { TeamActionsResponse } from '~~/shared/types/scenario'

const props = defineProps<{
  channelId: string
  /** Nom d'affichage du participant (auteur déclaré) ; vide : boutons désactivés */
  author: string
}>()

const POLL_MS = 3000
const state = ref<TeamActionsResponse>({ actions: [] })
const error = ref('')
const pending = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | undefined

async function refresh() {
  try {
    state.value = await $fetch<TeamActionsResponse>('/api/actions')
  }
  catch {
    // Panneau conservé tel quel : le prochain tour réessaie
  }
}

const visible = computed(() => state.value.actions.length > 0 && state.value.channelId === props.channelId)

async function trigger(id: string) {
  if (!props.author || pending.value) return
  pending.value = id
  error.value = ''
  try {
    await $fetch(`/api/actions/${encodeURIComponent(id)}`, { method: 'POST', body: { author: props.author } })
  }
  catch (e) {
    // 409 : action déjà en cours, le message Ops l'explique ; autre échec : avis local
    const status = (e as { statusCode?: number, status?: number }).statusCode ?? (e as { status?: number }).status
    if (status !== 409) error.value = 'Action impossible pour le moment, réessayez.'
  }
  finally {
    pending.value = null
    await refresh()
  }
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section v-if="visible" class="action-panel" data-testid="action-panel" aria-label="Actions d'équipe">
    <button
      v-for="action in state.actions"
      :key="action.id"
      type="button"
      class="action-panel__button"
      data-testid="action-button"
      :disabled="action.running || !author || pending !== null"
      @click="trigger(action.id)"
    >
      {{ action.label }}{{ action.running ? ' (en cours)' : '' }}
    </button>
    <a
      v-if="state.healthUrl"
      class="action-panel__link"
      data-testid="health-link"
      :href="state.healthUrl"
      target="_blank"
      rel="noopener noreferrer"
    >Voir la santé du service</a>
    <span v-if="error" class="action-panel__error" role="alert">{{ error }}</span>
  </section>
</template>

<style scoped>
.action-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 0;
}

.action-panel__button {
  padding: 4px 10px;
  border: 1px solid var(--teams-border, #d1d1d1);
  border-radius: 4px;
  background: #fff;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.action-panel__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.action-panel__link {
  margin-left: auto;
  font-size: 13px;
}

.action-panel__error {
  color: #b42318;
  font-size: 13px;
}
</style>
