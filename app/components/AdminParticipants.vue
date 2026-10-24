<script setup lang="ts">
// Section « Participants et rôles » de /admin : présents (tous canaux) avec leur rôle, réattribuable par
// l'animateur (POST /api/admin/roles). Chargée dès que le code est validé, puis toutes les 5 s.
import { ROLES, isRoleId, type RoleId } from '~~/shared/onboarding/roles'

const props = defineProps<{ code: string }>()

interface ParticipantRow { name: string, channelId: string, role: RoleId }
interface ParticipantsResponse { participants: ParticipantRow[], hasIncidentCommander: boolean }

const REFRESH_INTERVAL_MS = 5000

const state = ref<ParticipantsResponse | null>(null)
const channelNames = ref<Record<string, string>>({})
const error = ref('')
const loading = ref(false)
let requestId = 0
let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  if (props.code === '') {
    state.value = null
    error.value = 'Saisissez et validez le code animateur pour afficher les participants.'
    return
  }
  const current = ++requestId
  loading.value = true
  try {
    const result = await $fetch<ParticipantsResponse>('/api/admin/participants', { headers: { 'x-facilitator-code': props.code } })
    if (current !== requestId) return
    state.value = result
    error.value = ''
  }
  catch (caught) {
    if (current !== requestId) return
    const statusCode = (caught as { statusCode?: number }).statusCode
    error.value = statusCode === 401 ? 'Code animateur invalide.' : 'Impossible de charger les participants.'
  }
  finally {
    if (current === requestId) loading.value = false
  }
}

async function loadChannelNames() {
  try {
    const channels = await $fetch<{ id: string, name: string }[]>('/api/channels')
    channelNames.value = Object.fromEntries(channels.map(channel => [channel.id, channel.name]))
  }
  catch {
    // Les identifiants de canal s'afficheront tels quels
  }
}

async function changeRole(row: ParticipantRow, event: Event) {
  const role = (event.target as HTMLSelectElement).value
  if (!isRoleId(role)) return
  try {
    await $fetch('/api/admin/roles', { method: 'POST', headers: { 'x-facilitator-code': props.code }, body: { name: row.name, role } })
    error.value = ''
  }
  catch {
    error.value = `Impossible de changer le rôle de ${row.name}.`
  }
  await load()
}

watch(() => props.code, () => {
  requestId++
  state.value = null
  error.value = ''
  load()
}, { immediate: true })

onMounted(() => {
  loadChannelNames()
  timer = setInterval(() => {
    if (props.code !== '' && !document.hidden) load()
  }, REFRESH_INTERVAL_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <section class="card" data-testid="participants-panel">
    <h2>Participants et rôles</h2>
    <p>Les personnes présentes en ce moment, tous canaux confondus. Changer un rôle ici met à jour son badge côté participant en quelques secondes.</p>
    <p v-if="state && !state.hasIncidentCommander" class="participants__warning" role="alert" data-testid="no-commander">
      Aucun responsable d'incident désigné
    </p>
    <p v-if="error" class="participants__error" role="alert" data-testid="participants-error">{{ error }}</p>
    <p v-else-if="state && state.participants.length === 0" class="participants__empty">Aucun participant présent.</p>
    <ul v-if="state && state.participants.length > 0" class="participants" data-testid="participants-list">
      <li v-for="row in state.participants" :key="row.name" class="participants__row" data-testid="participant-row">
        <span class="participants__name">{{ row.name }}</span>
        <span class="participants__channel">{{ channelNames[row.channelId] ?? row.channelId }}</span>
        <select :aria-label="`Rôle de ${row.name}`" :value="row.role" data-testid="participant-role" @change="changeRole(row, $event)">
          <option v-for="role in ROLES" :key="role.id" :value="role.id">{{ role.label }}</option>
        </select>
      </li>
    </ul>
    <div class="card__actions">
      <button type="button" class="button" data-testid="participants-refresh" :disabled="loading || code === ''" @click="load">
        Actualiser
      </button>
    </div>
  </section>
</template>

<style scoped>
.participants { margin: 0 0 12px; padding: 0; list-style: none; }
.participants__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 6px 0; border-bottom: 1px solid var(--teams-border); }
.participants__name { flex: 1 1 140px; font-weight: 600; overflow-wrap: anywhere; }
.participants__channel { flex: 1 1 120px; color: var(--teams-text-muted); font-size: 13px; }
.participants__row select { width: auto; }
.participants__warning { padding: 8px 12px; border-left: 3px solid #b10e1c; background: #fdecee; color: #8a0b16; font-weight: 600; }
.participants__error { color: #b10e1c; font-size: 13px; }
.participants__empty { color: var(--teams-text-muted); font-size: 13px; }
</style>
