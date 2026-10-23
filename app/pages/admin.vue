<script setup lang="ts">
// Outils d'animateur (page non liée dans la navigation) : annonce et carte d'alerte dans un canal,
// scénario d'incident pré-écrit, PNJ, chronologie pour le post-mortem, réinitialisation des conversations. Le code animateur est gardé dans le sessionStorage, envoyé en x-facilitator-code.
import type { Message } from '~~/shared/types/chat'
import type { NpcAdminState } from '~~/shared/types/npc'
import type { ScenarioRun, ScenarioSummary, ScenariosResponse } from '~~/shared/types/scenario'
import type { AlertSeverity } from '~~/shared/utils/alerts'
import {
  SCENARIO_RUN_STATUS_LABELS,
  SCENARIO_STEP_STATUS_LABELS,
  formatScenarioOffset,
} from '~~/shared/utils/scenarios'
import {
  ALERT_SERVICE_MAX_LENGTH,
  ALERT_SEVERITIES,
  ALERT_SEVERITY_LABELS,
  ALERT_TITLE_MAX_LENGTH,
} from '~~/shared/utils/alerts'
import { TEXT_MAX_LENGTH } from '~~/shared/utils/limits'

const FACILITATOR_CODE_STORAGE_KEY = 'sre-team-instance:facilitator-code'
const SCENARIO_POLL_INTERVAL_MS = 2000

useHead({ title: 'Animateur | SRE Team Instance' })

const { data: channels, refresh: refreshChannels } = await useFetch('/api/channels', { default: () => [] })

const code = ref('')
const channelId = ref(channels.value.find(channel => channel.id.startsWith('incident-'))?.id ?? channels.value[0]?.id ?? '')
const text = ref('')
const alertChannelId = ref(channelId.value)
const alertSeverity = ref<AlertSeverity>('SEV1')
const alertTitle = ref('')
const alertService = ref('')
const alertText = ref('')
const busy = ref(false)
const status = ref<{ kind: 'success' | 'error', text: string } | null>(null)

// Scénarios : chargés côté client seulement, car la liste exige le code animateur
const scenarios = ref<ScenarioSummary[] | null>(null)
const scenarioRun = ref<ScenarioRun | null>(null)
let scenarioPollTimer: ReturnType<typeof setTimeout> | undefined
let unmounted = false

// PNJ : état chargé avec le code animateur, comme les scénarios
const npcState = ref<NpcAdminState | null>(null)

// Chronologie : '' = tous les canaux
const timelineChannelId = ref('')
const timelinePreview = ref<string | null>(null)

// Canaux créés depuis un autre onglet : liste rechargée au retour sur la page. Les sélections
// (refs indépendantes de la liste) ne sont pas touchées.
function onWindowFocus() {
  void refreshChannels()
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') void refreshChannels()
}

onMounted(() => {
  code.value = sessionStorage.getItem(FACILITATOR_CODE_STORAGE_KEY) ?? ''
  // Scénarios chargés seulement si un code était mémorisé, pas à chaque frappe
  if (code.value !== '') validateCode()
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(scenarioPollTimer)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

watch(code, (value) => {
  sessionStorage.setItem(FACILITATOR_CODE_STORAGE_KEY, value)
})

/** Bouton « Valider le code » ou Entrée dans le champ : (re)charge les scénarios et les PNJ avec le code saisi. */
function validateCode() {
  return Promise.all([loadScenarios(), loadNpcs()])
}

const canPublish = computed(() => !busy.value && code.value !== '' && channelId.value !== '' && text.value.trim() !== '')
const canPublishAlert = computed(() => !busy.value && code.value !== '' && alertChannelId.value !== ''
  && alertTitle.value.trim() !== '' && alertService.value.trim() !== '' && alertText.value.trim() !== '')
const canReset = computed(() => !busy.value && code.value !== '')
const scenarioRunning = computed(() => scenarioRun.value?.status === 'running')
const canStartScenario = computed(() => !busy.value && code.value !== '' && !scenarioRunning.value)
const canExportTimeline = computed(() => !busy.value && code.value !== '')

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

function publishAlert() {
  if (!canPublishAlert.value) return
  return run(async () => {
    await $fetch<Message>('/api/admin/alerts', {
      method: 'POST',
      headers: { 'x-facilitator-code': code.value },
      body: {
        channelId: alertChannelId.value,
        severity: alertSeverity.value,
        title: alertTitle.value.trim(),
        service: alertService.value.trim(),
        text: alertText.value.trim(),
      },
    })
    const name = channels.value.find(channel => channel.id === alertChannelId.value)?.name ?? alertChannelId.value
    alertTitle.value = ''
    alertText.value = ''
    return `Alerte ${alertSeverity.value} publiée dans « ${name} ».`
  })
}

/** Relance le polling tant que le run est en cours ; l'arrête sinon. */
function setScenarioRun(run: ScenarioRun | null) {
  scenarioRun.value = run
  clearTimeout(scenarioPollTimer)
  scenarioPollTimer = undefined
  if (run?.status === 'running' && !unmounted) {
    scenarioPollTimer = setTimeout(loadScenarios, SCENARIO_POLL_INTERVAL_MS)
  }
}

async function loadScenarios() {
  const requestCode = code.value
  if (requestCode === '') {
    scenarios.value = null
    setScenarioRun(null)
    return
  }
  try {
    const response = await $fetch<ScenariosResponse>('/api/admin/scenarios', {
      headers: { 'x-facilitator-code': requestCode },
    })
    // Code modifié pendant la requête : la réponse de la requête suivante fera foi
    if (requestCode !== code.value || unmounted) return
    scenarios.value = response.scenarios
    setScenarioRun(response.run)
  }
  catch {
    if (requestCode !== code.value || unmounted) return
    scenarios.value = null
    setScenarioRun(null)
  }
}

async function loadNpcs() {
  const requestCode = code.value
  if (requestCode === '') {
    npcState.value = null
    return
  }
  try {
    const state = await $fetch<NpcAdminState>('/api/admin/npcs', { headers: { 'x-facilitator-code': requestCode } })
    if (requestCode === code.value && !unmounted) npcState.value = state
  }
  catch {
    if (requestCode === code.value && !unmounted) npcState.value = null
  }
}

/** Interrupteur « PNJ actifs » : l'état affiché est celui renvoyé par le serveur */
function setNpcsEnabled(event: Event) {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  return run(async () => {
    try {
      npcState.value = await $fetch<NpcAdminState>('/api/admin/npcs', {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
        body: { enabled },
      })
    }
    catch (error) {
      // Case remise dans l'état réel du serveur (Vue ne repatche pas checked si l'état n'a pas changé)
      await loadNpcs()
      input.checked = npcState.value?.enabled ?? !enabled
      throw error
    }
    return enabled ? 'PNJ activés : ils répondent quand on les mentionne.' : 'PNJ coupés : ils ne répondent plus.'
  })
}

function startScenario(scenario: ScenarioSummary) {
  if (!canStartScenario.value) return
  return run(async () => {
    const state = await $fetch<ScenarioRun>(`/api/admin/scenarios/${encodeURIComponent(scenario.id)}/start`, {
      method: 'POST',
      headers: { 'x-facilitator-code': code.value },
    })
    setScenarioRun(state)
    // Le lancement active les PNJ du scénario
    await loadNpcs()
    return `Scénario « ${scenario.title} » lancé.`
  })
}

function stopScenario() {
  if (busy.value || !scenarioRunning.value) return
  return run(async () => {
    try {
      const state = await $fetch<ScenarioRun>('/api/admin/scenarios/stop', {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
      })
      setScenarioRun(state)
      return `Scénario « ${state.title} » arrêté.`
    }
    catch (error) {
      // 409 : le scénario s'est terminé entre-temps, l'état affiché est rafraîchi
      await loadScenarios()
      throw error
    }
  })
}

function channelName(id: string): string {
  return channels.value.find(channel => channel.id === id)?.name ?? id
}

function timelineFileName(): string {
  return `chronologie-${timelineChannelId.value || 'tous'}.md`
}

function fetchTimelineMarkdown(): Promise<string> {
  const query: Record<string, string> = { format: 'md' }
  if (timelineChannelId.value !== '') query.channelId = timelineChannelId.value
  return $fetch<string>('/api/admin/timeline', {
    headers: { 'x-facilitator-code': code.value },
    query,
    responseType: 'text',
  })
}

function showTimeline() {
  if (!canExportTimeline.value) return
  return run(async () => {
    timelinePreview.value = await fetchTimelineMarkdown()
    return 'Chronologie affichée.'
  })
}

function downloadTimeline() {
  if (!canExportTimeline.value) return
  return run(async () => {
    // Un simple lien ne transmettrait pas le header du code animateur : passage par un Blob
    const markdown = await fetchTimelineMarkdown()
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = timelineFileName()
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return `Chronologie téléchargée (${timelineFileName()}).`
  })
}

type ResetScope = 'messages' | 'all'

const RESET_CONFIRMATIONS: Record<ResetScope, string> = {
  messages: 'Effacer les messages de tous les canaux ? Les canaux sont conservés.',
  all: 'Tout réinitialiser ? Les canaux créés par les participants, tous les messages et la présence seront supprimés, et le scénario en cours sera arrêté.',
}

const RESET_RESULTS: Record<ResetScope, string> = {
  messages: 'Conversations réinitialisées.',
  all: 'Instance entièrement réinitialisée.',
}

function reset(scope: ResetScope) {
  if (!canReset.value) return
  if (!confirm(RESET_CONFIRMATIONS[scope])) return
  return run(async () => {
    await $fetch('/api/admin/reset', { method: 'POST', headers: { 'x-facilitator-code': code.value }, body: { scope } })
    // La réinitialisation arrête aussi le scénario en cours (et coupe les PNJ si scope all)
    await Promise.all([loadScenarios(), loadNpcs()])
    if (scope === 'all') {
      // Canaux des participants supprimés : les sélections qui les visaient reviennent au canal d'incident
      await refreshChannels()
      const ids = new Set(channels.value.map(channel => channel.id))
      if (!ids.has(channelId.value)) channelId.value = 'incident-en-cours'
      if (!ids.has(alertChannelId.value)) alertChannelId.value = 'incident-en-cours'
      if (timelineChannelId.value !== '' && !ids.has(timelineChannelId.value)) timelineChannelId.value = ''
    }
    return RESET_RESULTS[scope]
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

      <form class="card" @submit.prevent="validateCode">
        <label for="facilitator-code">Code animateur</label>
        <input
          id="facilitator-code"
          v-model="code"
          data-testid="facilitator-code"
          type="password"
          autocomplete="off"
          placeholder="Code communiqué à l'animateur"
        >
        <div class="card__actions">
          <button type="submit" class="button button--primary" data-testid="facilitator-code-submit" :disabled="code === ''">
            Valider le code
          </button>
        </div>
      </form>

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

      <form class="card" data-testid="alert-form" @submit.prevent="publishAlert">
        <h2>Publier une alerte</h2>
        <label for="alert-channel">Canal</label>
        <select id="alert-channel" v-model="alertChannelId" data-testid="alert-channel">
          <option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
        </select>
        <label for="alert-severity">Sévérité</label>
        <select id="alert-severity" v-model="alertSeverity" data-testid="alert-severity">
          <option v-for="severity in ALERT_SEVERITIES" :key="severity" :value="severity">{{ ALERT_SEVERITY_LABELS[severity] }}</option>
        </select>
        <label for="alert-title">Titre</label>
        <input
          id="alert-title"
          v-model="alertTitle"
          data-testid="alert-title"
          type="text"
          :maxlength="ALERT_TITLE_MAX_LENGTH"
          placeholder="Ex. Taux d'erreur 5xx > 20 %"
        >
        <label for="alert-service">Service</label>
        <input
          id="alert-service"
          v-model="alertService"
          data-testid="alert-service"
          type="text"
          :maxlength="ALERT_SERVICE_MAX_LENGTH"
          placeholder="Ex. checkout-api"
        >
        <label for="alert-text">Description</label>
        <textarea
          id="alert-text"
          v-model="alertText"
          data-testid="alert-text"
          rows="2"
          :maxlength="TEXT_MAX_LENGTH"
          placeholder="Ex. Erreurs 5xx en hausse depuis 10 min"
        />
        <div class="card__actions">
          <button type="submit" class="button button--primary" data-testid="alert-submit" :disabled="!canPublishAlert">
            Publier l'alerte
          </button>
        </div>
      </form>

      <section class="card" data-testid="scenario-panel">
        <h2>Scénario d'incident</h2>
        <p v-if="!scenarios">Saisissez et validez le code animateur pour afficher les scénarios.</p>
        <ul v-else class="scenarios">
          <li v-for="scenario in scenarios" :key="scenario.id" class="scenario" :data-testid="`scenario-${scenario.id}`">
            <div class="scenario__info">
              <strong>{{ scenario.title }}</strong>
              <p>{{ scenario.description }}</p>
              <p class="scenario__meta">
                {{ scenario.stepCount }} étapes · durée {{ formatScenarioOffset(scenario.durationSeconds).slice(1) }}
              </p>
            </div>
            <button
              type="button"
              class="button button--primary"
              :data-testid="`scenario-start-${scenario.id}`"
              :disabled="!canStartScenario"
              @click="startScenario(scenario)"
            >
              Lancer
            </button>
          </li>
        </ul>

        <div v-if="scenarioRun" class="scenario-run" data-testid="scenario-run">
          <div class="scenario-run__header">
            <strong>{{ scenarioRun.title }}</strong>
            <span
              class="scenario-run__status"
              :class="`scenario-run__status--${scenarioRun.status}`"
              data-testid="scenario-run-status"
            >{{ SCENARIO_RUN_STATUS_LABELS[scenarioRun.status] }}</span>
          </div>
          <ol class="scenario-steps">
            <li
              v-for="step in scenarioRun.steps"
              :key="step.index"
              class="scenario-step"
              :data-testid="`scenario-step-${step.index}`"
            >
              <span class="scenario-step__at">{{ formatScenarioOffset(step.at) }}</span>
              <span class="scenario-step__label">
                {{ step.label }}
                <small>{{ step.kind === 'alert' ? 'Alerte' : 'Annonce' }} · {{ channelName(step.channelId) }}</small>
              </span>
              <span
                class="scenario-step__status"
                :class="`scenario-step__status--${step.status}`"
                data-testid="scenario-step-status"
              >{{ SCENARIO_STEP_STATUS_LABELS[step.status] }}</span>
            </li>
          </ol>
          <div v-if="scenarioRunning" class="card__actions">
            <button type="button" class="button button--danger" data-testid="scenario-stop" :disabled="busy" @click="stopScenario">
              Arrêter
            </button>
          </div>
        </div>
      </section>

      <section class="card" data-testid="npc-panel">
        <h2>Personnages (PNJ)</h2>
        <p v-if="!npcState">Saisissez et validez le code animateur pour afficher les PNJ.</p>
        <template v-else>
          <p>Mentionnés par <strong>@Nom</strong>, ils répondent dans le fil après quelques secondes (moteur {{ npcState.engine }}). Lancer le scénario les active, « Tout réinitialiser » les coupe.</p>
          <label class="switch">
            <input
              type="checkbox"
              data-testid="npc-toggle"
              :checked="npcState.enabled"
              :disabled="busy || code === '' || npcState.npcs.length === 0"
              @change="setNpcsEnabled"
            >
            PNJ actifs
          </label>
          <ul class="npcs" data-testid="npc-list">
            <li v-for="npc in npcState.npcs" :key="npc.id"><strong>{{ npc.name }}</strong> · {{ npc.role }}</li>
          </ul>
        </template>
      </section>

      <section class="card" data-testid="timeline-panel">
        <h2>Chronologie (post-mortem)</h2>
        <p>Messages, annonces et alertes horodatés, pour préparer le post-mortem.</p>
        <label for="timeline-channel">Canal</label>
        <select id="timeline-channel" v-model="timelineChannelId" data-testid="timeline-channel">
          <option value="">Tous les canaux</option>
          <option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
        </select>
        <div class="card__actions">
          <button type="button" class="button" data-testid="timeline-show" :disabled="!canExportTimeline" @click="showTimeline">
            Afficher
          </button>
          <button type="button" class="button button--primary" data-testid="timeline-download" :disabled="!canExportTimeline" @click="downloadTimeline">
            Télécharger .md
          </button>
        </div>
        <pre v-if="timelinePreview !== null" class="timeline-preview" data-testid="timeline-preview">{{ timelinePreview }}</pre>
      </section>

      <section class="card">
        <h2>Entre deux groupes</h2>
        <p>« Effacer les messages » vide tous les canaux ; les canaux, y compris ceux créés par les participants, sont conservés.</p>
        <p>« Tout réinitialiser » supprime aussi les canaux créés par les participants et la présence ; seuls les canaux par défaut restent. Le scénario en cours est arrêté dans les deux cas.</p>
        <div class="card__actions">
          <button type="button" class="button button--danger" data-testid="reset" :disabled="!canReset" @click="reset('messages')">
            Effacer les messages
          </button>
          <button type="button" class="button button--danger" data-testid="reset-all" :disabled="!canReset" @click="reset('all')">
            Tout réinitialiser
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
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.button {
  padding: 6px 18px;
  border: 1px solid #d1d1d1;
  background: #fff;
  color: inherit;
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

.card .switch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  cursor: pointer;
}

.card .switch input {
  width: auto;
  accent-color: var(--teams-purple);
}

.npcs {
  margin: 4px 0 0;
  padding-left: 18px;
  color: var(--teams-text-muted);
}

.scenarios,
.scenario-steps {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.scenario {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
}

.scenario__info {
  flex: 1;
  min-width: 0;
}

.card .scenario__meta {
  margin-top: 2px;
  font-size: 12px;
}

.scenario-run {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e0e0e0;
}

.scenario-run__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.scenario-run__status,
.scenario-step__status {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f0f0f0;
  color: var(--teams-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.scenario-run__status--running {
  background: var(--teams-purple-tint);
  color: var(--teams-purple);
}

.scenario-step {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.scenario-step__at {
  flex-shrink: 0;
  color: var(--teams-text-muted);
  font-variant-numeric: tabular-nums;
}

.scenario-step__label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.scenario-step__label small {
  display: block;
  color: var(--teams-text-muted);
}

.scenario-step__status--published {
  background: #e7f2da;
  color: #237b4b;
}

.scenario-step__status--failed {
  background: #fdf3f4;
  color: #c4314b;
}

.scenario-step__status--cancelled {
  text-decoration: line-through;
}

.timeline-preview {
  max-width: 100%;
  max-height: 360px;
  margin: 8px 0 0;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #fafafa;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
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
