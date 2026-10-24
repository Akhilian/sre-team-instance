<script setup lang="ts">
// Outils d'animateur (page non liée dans la navigation) : annonce et carte d'alerte dans un canal,
// scénario d'incident pré-écrit, PNJ, chronologie pour le post-mortem, réinitialisation des conversations. Le code animateur est gardé dans le sessionStorage, envoyé en x-facilitator-code.
import type { Message } from '~~/shared/types/chat'
import type {
  NpcAdminState,
  NpcPersonaEditError,
  NpcPersonaEditErrorResponse,
  NpcPersonaFileSummary,
  NpcPersonaReloadReport,
  NpcPersonasAdminState,
} from '~~/shared/types/npc'
import type { ScenarioRun, ScenarioSummary, ScenariosResponse } from '~~/shared/types/scenario'
import type { AlertSeverity } from '~~/shared/utils/alerts'
import {
  SCENARIO_RUN_STATUS_LABELS,
  SCENARIO_STEP_KIND_LABELS,
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
// Fiches des PNJ (texte source, lecture seule) et dernier rapport de rechargement
const personasState = ref<NpcPersonasAdminState | null>(null)
const reloadReport = ref<NpcPersonaReloadReport | null>(null)
const PERSONA_SOURCE_LABELS = {
  dir: 'dossier NPC_PERSONAS_DIR',
  embedded: 'fiches embarquées au build',
} as const
// Édition en ligne d'une fiche (une à la fois) : chemin, saisie en cours et erreurs de la dernière validation
const editingPath = ref<string | null>(null)
const personaDraft = ref('')
const personaErrors = ref<NpcPersonaEditError[]>([])

// Chronologie : '' = tous les canaux
const timelineChannelId = ref('')
const timelinePreview = ref<string | null>(null)

// Canaux créés depuis un autre onglet : liste rechargée au retour sur la page. Les sélections
// (refs indépendantes de la liste) ne sont pas touchées.
// L'état des PNJ (dernier appel au modèle) est relu de même.
function onWindowFocus() {
  void refreshChannels()
  void refreshNpcState()
}
function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return
  void refreshChannels()
  void refreshNpcState()
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
    personasState.value = null
    return
  }
  try {
    const headers = { 'x-facilitator-code': requestCode }
    const [state, personas] = await Promise.all([
      $fetch<NpcAdminState>('/api/admin/npcs', { headers }),
      $fetch<NpcPersonasAdminState>('/api/admin/npc-personas', { headers }),
    ])
    if (requestCode === code.value && !unmounted) {
      npcState.value = state
      personasState.value = personas
    }
  }
  catch {
    if (requestCode === code.value && !unmounted) {
      npcState.value = null
      personasState.value = null
    }
  }
}

/** Relit l'état des PNJ seul (sans les fiches, qui peuvent être en cours d'édition) ; ignoré sans état affiché */
async function refreshNpcState() {
  const requestCode = code.value
  if (requestCode === '' || !npcState.value) return
  try {
    const state = await $fetch<NpcAdminState>('/api/admin/npcs', { headers: { 'x-facilitator-code': requestCode } })
    if (requestCode === code.value && !unmounted) npcState.value = state
  }
  catch {
    // état précédent gardé : la prochaine validation du code fera foi
  }
}

/** HH:MM locale d'un horodatage ISO */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** « dernier appel au modèle : réussi à HH:MM » ou « échec (raison) à HH:MM, repli mots-clés » */
const lastModelCallText = computed(() => {
  const call = npcState.value?.lastModelCall
  if (!call) return null
  return call.ok
    ? `dernier appel au modèle : réussi à ${clockTime(call.at)}`
    : `dernier appel au modèle : échec (${call.reason ?? 'raison inconnue'}) à ${clockTime(call.at)}, repli mots-clés`
})

/** « Recharger les fiches » : relit la source en service ; 422 = aucune fiche valide, rien n'est remplacé */
function reloadPersonas() {
  if (busy.value || code.value === '') return
  return run(async () => {
    reloadReport.value = null
    let report: NpcPersonaReloadReport
    let replaced = true
    try {
      report = await $fetch<NpcPersonaReloadReport>('/api/admin/npc-personas/reload', {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
      })
    }
    catch (error) {
      const { statusCode, data } = error as { statusCode?: number, data?: NpcPersonaReloadReport }
      if (statusCode !== 422 || !data) throw error
      report = data
      replaced = false
    }
    reloadReport.value = report
    await loadNpcs()
    if (!replaced) return 'Aucune fiche valide : les fiches en cours sont conservées.'
    return `${report.loaded.length} fiche(s) rechargée(s), ${report.errors.length} en erreur.`
  })
}

/** « Modifier » : ouvre l'éditeur pré-rempli avec le Markdown en service (ferme l'éditeur précédent) */
function startPersonaEdit(persona: NpcPersonaFileSummary) {
  editingPath.value = persona.path
  personaDraft.value = persona.markdown
  personaErrors.value = []
}

function cancelPersonaEdit() {
  editingPath.value = null
  personaDraft.value = ''
  personaErrors.value = []
}

/** « Valider et appliquer » : 422 = fiche refusée, erreurs affichées une par ligne, rien n'a changé */
function savePersonaEdit(persona: NpcPersonaFileSummary) {
  if (busy.value || code.value === '' || editingPath.value !== persona.path) return
  return run(async () => {
    personaErrors.value = []
    try {
      await $fetch<NpcPersonaFileSummary>('/api/admin/npc-personas/edit', {
        method: 'PUT',
        headers: { 'x-facilitator-code': code.value },
        body: { path: persona.path, markdown: personaDraft.value },
      })
    }
    catch (error) {
      const { statusCode, data } = error as { statusCode?: number, data?: NpcPersonaEditErrorResponse }
      if (statusCode !== 422 || !data?.errors) throw error
      personaErrors.value = data.errors
      throw Object.assign(new Error('Fiche refusée'), { data: { message: `Fiche ${persona.path} refusée : rien n'a changé.` } })
    }
    cancelPersonaEdit()
    await loadNpcs()
    return `Fiche ${persona.path} modifiée et appliquée (en mémoire).`
  })
}

/** « Revenir à l'original » : supprime la version modifiée, la fiche de la source reprend sa place */
function revertPersona(persona: NpcPersonaFileSummary) {
  if (busy.value || code.value === '') return
  return run(async () => {
    await $fetch<NpcPersonaFileSummary>('/api/admin/npc-personas/revert', {
      method: 'POST',
      headers: { 'x-facilitator-code': code.value },
      body: { path: persona.path },
    })
    if (editingPath.value === persona.path) cancelPersonaEdit()
    await loadNpcs()
    return `Fiche ${persona.path} revenue à l'original.`
  })
}

/** « Télécharger .md » : la saisie en cours, via un Blob (aucun script inline, compatible CSP) */
function downloadPersonaDraft(persona: NpcPersonaFileSummary) {
  const url = URL.createObjectURL(new Blob([personaDraft.value], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${persona.id}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
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

/** Interrupteur « Interventions spontanées » : l'état affiché est celui renvoyé par le serveur */
function setSpontaneous(event: Event) {
  const input = event.target as HTMLInputElement
  const spontaneous = input.checked
  return run(async () => {
    try {
      npcState.value = await $fetch<NpcAdminState>('/api/admin/npcs', {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
        body: { spontaneous },
      })
    }
    catch (error) {
      await loadNpcs()
      input.checked = npcState.value?.spontaneous ?? !spontaneous
      throw error
    }
    return spontaneous ? 'Interventions spontanées activées.' : 'Interventions spontanées coupées.'
  })
}

/** Lancement refusé (409 messages-exist) en attente de la décision de l'animateur */
const pendingStart = ref<{ scenario: ScenarioSummary, messageCount: number } | null>(null)
/** Case « Couper aussi les PNJ » du bouton « Arrêter » */
const stopDisablesNpcs = ref(true)

/** messageCount d'un 409 messages-exist renvoyé par le lancement, sinon undefined */
function existingMessageCount(error: unknown): number | undefined {
  const { statusCode, data } = error as { statusCode?: number, data?: { data?: { reason?: unknown, messageCount?: unknown } } }
  const detail = data?.data
  if (statusCode !== 409 || detail?.reason !== 'messages-exist' || typeof detail.messageCount !== 'number') return undefined
  return detail.messageCount
}

/**
 * Lance scenario ; sans existingMessages, un store non vide donne 409 messages-exist et une confirmation
 * (« Effacer et lancer », « Lancer sans effacer », « Annuler »)
 */
function startScenario(scenario: ScenarioSummary, existingMessages?: 'clear' | 'keep') {
  if (!canStartScenario.value) return
  pendingStart.value = null
  return run(async () => {
    let state: ScenarioRun
    try {
      state = await $fetch<ScenarioRun>(`/api/admin/scenarios/${encodeURIComponent(scenario.id)}/start`, {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
        body: existingMessages ? { existingMessages } : {},
      })
    }
    catch (error) {
      const messageCount = existingMessageCount(error)
      if (messageCount === undefined) throw error
      pendingStart.value = { scenario, messageCount }
      return `${messageCount} messages existent : choisissez avant de lancer « ${scenario.title} ».`
    }
    setScenarioRun(state)
    // Le lancement sélectionne les PNJ du scénario (activés, sauf pour la démo)
    await loadNpcs()
    return `Scénario « ${scenario.title} » lancé.`
  })
}

function cancelPendingStart() {
  pendingStart.value = null
  status.value = null
}

function stopScenario() {
  if (busy.value || !scenarioRunning.value) return
  return run(async () => {
    try {
      const state = await $fetch<ScenarioRun>('/api/admin/scenarios/stop', {
        method: 'POST',
        headers: { 'x-facilitator-code': code.value },
        body: { disableNpcs: stopDisablesNpcs.value },
      })
      setScenarioRun(state)
      await loadNpcs()
      return stopDisablesNpcs.value
        ? `Scénario « ${state.title} » arrêté, PNJ coupés.`
        : `Scénario « ${state.title} » arrêté.`
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

        <div v-if="pendingStart" class="scenario-confirm" data-testid="scenario-confirm" role="alertdialog" aria-labelledby="scenario-confirm-text">
          <p id="scenario-confirm-text">
            <strong data-testid="scenario-confirm-count">{{ pendingStart.messageCount }} messages existent.</strong>
            Avant de lancer « {{ pendingStart.scenario.title }} » :
          </p>
          <div class="card__actions">
            <button type="button" class="button button--danger" data-testid="scenario-confirm-clear" :disabled="!canStartScenario" @click="startScenario(pendingStart.scenario, 'clear')">
              Effacer et lancer
            </button>
            <button type="button" class="button button--primary" data-testid="scenario-confirm-keep" :disabled="!canStartScenario" @click="startScenario(pendingStart.scenario, 'keep')">
              Lancer sans effacer
            </button>
            <button type="button" class="button" data-testid="scenario-confirm-cancel" :disabled="busy" @click="cancelPendingStart">
              Annuler
            </button>
          </div>
        </div>

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
                <small>{{ SCENARIO_STEP_KIND_LABELS[step.kind] }} · {{ channelName(step.channelId) }}</small>
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
            <label class="scenario-stop__npcs">
              <input v-model="stopDisablesNpcs" type="checkbox" data-testid="scenario-stop-npcs">
              Couper aussi les PNJ
            </label>
          </div>
        </div>
      </section>

      <section class="card" data-testid="npc-panel">
        <h2>Personnages (PNJ)</h2>
        <p v-if="!npcState">Saisissez et validez le code animateur pour afficher les PNJ.</p>
        <template v-else>
          <p>Mentionnés par <strong>@Nom</strong>, ils répondent dans le fil après quelques secondes (moteur {{ npcState.engine }}). Lancer un scénario les active (sauf la démo), « Arrêter » (case cochée) et « Tout réinitialiser » les coupent.</p>
          <p v-if="lastModelCallText" data-testid="npc-last-model-call" :class="`model-call model-call--${npcState.lastModelCall?.ok ? 'ok' : 'failed'}`">{{ lastModelCallText }}</p>
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
          <label class="switch">
            <input
              type="checkbox"
              data-testid="npc-spontaneous-toggle"
              :checked="npcState.spontaneous"
              :disabled="busy || code === ''"
              @change="setSpontaneous"
            >
            Interventions spontanées
          </label>
          <ul class="npcs" data-testid="npc-list">
            <li v-for="npc in npcState.npcs" :key="npc.id"><strong>{{ npc.name }}</strong> · {{ npc.role }}</li>
          </ul>
          <template v-if="personasState">
            <h3 class="personas__title">Fiches</h3>
            <p data-testid="npc-personas-source">Source : {{ PERSONA_SOURCE_LABELS[personasState.source] }} ({{ personasState.personas.length }} fiche(s)).</p>
            <p class="personas__note" data-testid="npc-personas-memory">Modifications en mémoire : perdues au redémarrage du serveur, téléchargez le .md pour les garder.</p>
            <!-- Texte source affiché tel quel par interpolation ou v-model (HTML échappé, jamais interprété) -->
            <details v-for="persona in personasState.personas" :key="persona.path" class="persona" data-testid="npc-persona" :open="editingPath === persona.path || undefined">
              <summary>
                <strong>{{ persona.name }}</strong> · {{ persona.role }} <code>{{ persona.path }}</code>
                <span v-if="persona.modified" class="persona__badge" data-testid="npc-persona-modified">Modifiée</span>
              </summary>
              <template v-if="editingPath === persona.path">
                <label class="persona__label" :for="`persona-editor-${persona.id}`">Markdown de la fiche</label>
                <textarea
                  :id="`persona-editor-${persona.id}`"
                  v-model="personaDraft"
                  class="persona__editor"
                  data-testid="npc-persona-editor"
                  rows="20"
                  spellcheck="false"
                />
                <ul v-if="personaErrors.length > 0" class="reload-report__errors" data-testid="npc-persona-errors">
                  <li v-for="(error, index) in personaErrors" :key="index" data-testid="npc-persona-error">{{ error.message }}</li>
                </ul>
                <div class="card__actions">
                  <button type="button" class="button button--primary" data-testid="npc-persona-save" :disabled="busy || code === ''" @click="savePersonaEdit(persona)">
                    Valider et appliquer
                  </button>
                  <button type="button" class="button" data-testid="npc-persona-download" @click="downloadPersonaDraft(persona)">
                    Télécharger .md
                  </button>
                  <button type="button" class="button" data-testid="npc-persona-cancel" :disabled="busy" @click="cancelPersonaEdit">
                    Annuler
                  </button>
                </div>
              </template>
              <template v-else>
                <pre class="persona__markdown" data-testid="npc-persona-markdown">{{ persona.markdown }}</pre>
                <div class="card__actions">
                  <button type="button" class="button" data-testid="npc-persona-edit" :disabled="busy || code === ''" @click="startPersonaEdit(persona)">
                    Modifier
                  </button>
                  <button v-if="persona.modified" type="button" class="button" data-testid="npc-persona-revert" :disabled="busy || code === ''" @click="revertPersona(persona)">
                    Revenir à l'original
                  </button>
                </div>
              </template>
            </details>
          </template>
          <div class="card__actions">
            <button type="button" class="button" data-testid="npc-personas-reload" :disabled="busy || code === ''" @click="reloadPersonas">
              Recharger les fiches
            </button>
          </div>
          <div v-if="reloadReport" class="reload-report" data-testid="npc-reload-report">
            <p>
              Rechargées : {{ reloadReport.loaded.length }}
              <template v-if="reloadReport.kept.length > 0"> · version précédente conservée : {{ reloadReport.kept.join(', ') }}</template>
            </p>
            <ul v-if="reloadReport.errors.length > 0" class="reload-report__errors">
              <li v-for="error in reloadReport.errors" :key="error.path + error.message" data-testid="npc-reload-error">
                <code>{{ error.path }}</code> : {{ error.message }}
              </li>
            </ul>
          </div>
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

.personas__title {
  margin: 8px 0 0;
  font-size: 14px;
}

.persona {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 6px 10px;
}

.persona summary {
  cursor: pointer;
}

.persona code,
.reload-report code {
  font-size: 12px;
  color: var(--teams-text-muted);
}

.persona__markdown {
  padding: 10px 12px;
  background: #fafafa;
  max-height: 360px;
  margin: 8px 0 0;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.personas__note {
  color: var(--teams-text-muted);
  font-size: 13px;
}

.persona__badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #fff4ce;
  color: #8a5300;
  font-size: 12px;
}

.persona__label {
  display: block;
  margin-top: 8px;
}

.persona__editor {
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre;
}

.model-call {
  font-size: 13px;
}

.model-call--ok {
  color: #237b4b;
}

.model-call--failed {
  color: #c4314b;
}

.reload-report__errors {
  margin: 4px 0 0;
  padding-left: 18px;
  color: #c4314b;
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

/* Confirmation avant un lancement sur des messages existants (409 messages-exist) */
.scenario-confirm {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #f2c94c;
  border-radius: 4px;
  background: #fff8e1;
}

.scenario-confirm p {
  margin: 0;
}

/* Case « Couper aussi les PNJ » à côté du bouton « Arrêter » */
.card .scenario-stop__npcs {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.card .scenario-stop__npcs input {
  width: auto;
  padding: 0;
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
