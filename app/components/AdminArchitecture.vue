<script setup lang="ts">
// Panneau « Architecture » de /admin : schéma HTML/CSS de l'instance (hébergement, application, stockage,
// moteur des PNJ, fiches). Données chargées à l'ouverture (GET /api/admin/architecture), sans rafraîchissement
// automatique ; un bloc actif est mis en évidence, un bloc inactif grisé et marqué « inactif ».
import type { ArchitectureComponent, ArchitectureModel } from '~~/shared/types/architecture'

const props = defineProps<{ code: string }>()

const model = ref<ArchitectureModel | null>(null)
const loading = ref(false)
const error = ref('')
const opened = ref(false)
let requestId = 0

async function load() {
  if (props.code === '') {
    model.value = null
    error.value = 'Saisissez et validez le code animateur pour afficher l\'architecture.'
    return
  }
  const current = ++requestId
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<ArchitectureModel>('/api/admin/architecture', { headers: { 'x-facilitator-code': props.code } })
    if (current === requestId) model.value = result
  } catch (caught) {
    if (current !== requestId) return
    const statusCode = (caught as { statusCode?: number }).statusCode
    error.value = statusCode === 401 ? 'Code animateur invalide.' : 'Impossible de charger l\'architecture.'
  } finally {
    if (current === requestId) loading.value = false
  }
}

function onToggle(event: Event) {
  opened.value = (event.target as HTMLDetailsElement).open
  if (opened.value && !model.value) load()
}

// Un code différent invalide les données affichées ; rechargées à la prochaine ouverture ou au clic sur « Actualiser »
watch(() => props.code, () => {
  requestId++
  model.value = null
  loading.value = false
  error.value = ''
  if (opened.value) load()
})

function find(id: string): ArchitectureComponent {
  return model.value?.components.find(component => component.id === id)
    ?? { id, label: id, legend: '', active: false }
}

const LAYER_BROWSERS = ['participants', 'facilitator']
const LAYER_APP = ['nuxt-pages', 'api', 'scenario-runner', 'npc-dispatcher', 'spontaneous', 'persistence']
const HOSTINGS = ['hosting-render', 'hosting-kubernetes', 'hosting-local']
const COLUMNS = [
  { id: 'storage', title: 'Stockage', blocks: ['storage-memory', 'storage-fs', 'storage-redis'] },
  { id: 'engine', title: 'Moteur des PNJ', blocks: ['engine-keywords', 'engine-openai', 'engine-anthropic'] },
  { id: 'personas', title: 'Fiches des PNJ', blocks: ['personas-embedded', 'personas-directory'] },
]

function labelsFrom(froms: string[], tos?: string[]): string {
  const labels = (model.value?.links ?? [])
    .filter(link => froms.includes(link.from) && (!tos || tos.includes(link.to)))
    .map(link => link.label)
  return [...new Set(labels)].join(' · ')
}

const browsersToApp = computed(() => labelsFrom(LAYER_BROWSERS))
const appToBackends = computed(() => labelsFrom(['persistence', 'npc-dispatcher'], COLUMNS.flatMap(column => column.blocks)))

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString('fr-FR')
}

/** Ligne d'état d'un bloc (modèle, hôte, étape, nombre de fiches…) ; vide si rien à dire */
function details(id: string): string[] {
  const current = model.value
  if (!current) return []
  const lines: string[] = []
  switch (id) {
    case 'storage-redis':
      if (current.storage.host) lines.push(`Hôte : ${current.storage.host}`)
      break
    case 'engine-openai':
    case 'engine-anthropic':
      if (find(id).active) {
        if (current.npcEngine.model) lines.push(`Modèle : ${current.npcEngine.model}`)
        if (current.npcEngine.host) lines.push(`Hôte : ${current.npcEngine.host}`)
        const call = current.npcEngine.lastModelCall
        lines.push(call
          ? `Dernier appel : ${call.ok ? 'réussi' : `échec${call.reason ? ` (${call.reason})` : ''}`} à ${formatTime(call.at)}`
          : 'Dernier appel : aucun')
      }
      break
    case 'personas-embedded':
    case 'personas-directory':
      if (find(id).active) lines.push(`${current.personas.count} fiche${current.personas.count > 1 ? 's' : ''}`)
      break
    case 'scenario-runner':
      lines.push(current.scenario
        ? `${current.scenario.title} : étape ${current.scenario.step}/${current.scenario.totalSteps} (${statusLabel(current.scenario.status)})`
        : 'Aucun scénario lancé')
      break
    case 'npc-dispatcher':
      lines.push(current.npcs.enabled
        ? `Actifs : ${current.npcs.active.join(', ') || 'aucun'}`
        : 'PNJ coupés')
      lines.push(`Scénario des fiches : ${current.npcs.scenarioId}`)
      break
    case 'spontaneous':
      lines.push(current.npcs.spontaneous ? 'Interrupteur allumé' : 'Interrupteur éteint')
      break
  }
  return lines
}

function statusLabel(status: string): string {
  return ({ running: 'en cours', finished: 'terminé', stopped: 'arrêté' } as Record<string, string>)[status] ?? status
}
</script>

<template>
  <details class="card arch" data-testid="architecture-panel" @toggle="onToggle">
    <summary class="arch__summary">
      <h2>Architecture</h2>
    </summary>

    <div class="arch__body">
      <div class="arch__toolbar">
        <p class="arch__help">Ce qui tourne réellement : les blocs en couleur sont actifs, les blocs grisés ne sont pas utilisés.</p>
        <button
          type="button"
          class="button"
          data-testid="architecture-refresh"
          :disabled="loading || code === ''"
          @click="load"
        >
          {{ loading ? 'Chargement…' : 'Actualiser' }}
        </button>
      </div>

      <p v-if="error" class="arch__error" role="alert" data-testid="architecture-error">{{ error }}</p>

      <div v-if="model" class="arch__schema" data-testid="architecture-schema">
        <section class="arch__hosting" :aria-label="`Hébergement : ${find('hosting-' + model.hosting).label}`">
          <div class="arch__hosting-head">
            <span class="arch__layer-title">Hébergement</span>
            <div class="arch__chips">
              <div
                v-for="id in HOSTINGS"
                :key="id"
                class="block block--chip"
                :class="find(id).active ? 'block--active' : 'block--inactive'"
                :data-component="id"
                :data-active="find(id).active ? 'true' : 'false'"
                :title="find(id).legend"
              >
                <span class="block__name">{{ find(id).label }}</span>
                <span class="block__badge">{{ find(id).active ? 'actif' : 'inactif' }}</span>
              </div>
            </div>
          </div>

          <div class="arch__layer">
            <span class="arch__layer-title">Navigateurs</span>
            <div class="arch__grid arch__grid--2">
              <div
                v-for="id in LAYER_BROWSERS"
                :key="id"
                class="block"
                :class="find(id).active ? 'block--active' : 'block--inactive'"
                :data-component="id"
                :data-active="find(id).active ? 'true' : 'false'"
              >
                <span class="block__head">
                  <span class="block__name">{{ find(id).label }}</span>
                  <span class="block__badge">{{ find(id).active ? 'actif' : 'inactif' }}</span>
                </span>
                <span class="block__legend">{{ find(id).legend }}</span>
              </div>
            </div>
          </div>

          <div class="arch__flow" aria-hidden="true"><span class="arch__arrow">▼</span>{{ browsersToApp }}</div>

          <div class="arch__layer arch__layer--app">
            <span class="arch__layer-title">Application Nuxt</span>
            <div class="arch__grid arch__grid--3">
              <div
                v-for="id in LAYER_APP"
                :key="id"
                class="block"
                :class="find(id).active ? 'block--active' : 'block--inactive'"
                :data-component="id"
                :data-active="find(id).active ? 'true' : 'false'"
              >
                <span class="block__head">
                  <span class="block__name">{{ find(id).label }}</span>
                  <span class="block__badge">{{ find(id).active ? 'actif' : 'inactif' }}</span>
                </span>
                <span class="block__legend">{{ find(id).legend }}</span>
                <span v-for="line in details(id)" :key="line" class="block__detail">{{ line }}</span>
              </div>
            </div>
          </div>

          <div class="arch__flow" aria-hidden="true"><span class="arch__arrow">▼</span>{{ appToBackends }}</div>

          <div class="arch__grid arch__grid--3 arch__columns">
            <div v-for="column in COLUMNS" :key="column.id" class="arch__layer arch__layer--column">
              <span class="arch__layer-title">{{ column.title }}</span>
              <div
                v-for="id in column.blocks"
                :key="id"
                class="block"
                :class="find(id).active ? 'block--active' : 'block--inactive'"
                :data-component="id"
                :data-active="find(id).active ? 'true' : 'false'"
              >
                <span class="block__head">
                  <span class="block__name">{{ find(id).label }}</span>
                  <span class="block__badge">{{ find(id).active ? 'actif' : 'inactif' }}</span>
                </span>
                <span class="block__legend">{{ find(id).legend }}</span>
                <span v-for="line in details(id)" :key="line" class="block__detail">{{ line }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
      <p v-else-if="loading" class="arch__help">Chargement…</p>
    </div>
  </details>
</template>

<style scoped>
.arch__summary {
  cursor: pointer;
}

.arch__summary h2 {
  display: inline;
  margin: 0;
  font-size: 16px;
}

.arch__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.arch__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.arch__help {
  margin: 0;
  color: var(--teams-text-muted);
  font-size: 13px;
}

.button {
  flex: none;
  padding: 6px 18px;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  background: #fff;
  color: inherit;
  font-weight: 600;
  cursor: pointer;
}

.button:disabled {
  opacity: 0.5;
  cursor: default;
}

.arch__error {
  margin: 0;
  color: #b10e1c;
  font-size: 13px;
}

.arch__schema {
  min-width: 0;
}

.arch__hosting {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 2px solid var(--teams-purple-dark);
  border-radius: 8px;
  background: var(--teams-bg);
}

.arch__hosting-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.arch__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.arch__layer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.arch__layer--app {
  padding: 10px;
  border: 1px solid var(--teams-border);
  border-radius: 6px;
  background: #fff;
}

.arch__layer--column {
  gap: 6px;
}

.arch__layer-title {
  color: var(--teams-purple-dark);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.arch__grid {
  display: grid;
  gap: 8px;
}

.arch__grid--2 {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.arch__grid--3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.arch__columns {
  align-items: start;
}

.arch__flow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--teams-text-muted);
  font-size: 12px;
  text-align: center;
}

.arch__arrow {
  color: var(--teams-purple);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--teams-border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.block--chip {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
}

.block__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}

.block__name {
  font-size: 13px;
  font-weight: 600;
}

.block__badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.block__legend {
  color: var(--teams-text-muted);
}

.block__detail {
  color: var(--teams-purple-dark);
  font-weight: 600;
}

.block--active {
  border-color: var(--teams-purple);
  background: var(--teams-purple-tint);
  box-shadow: 0 0 0 1px var(--teams-purple);
}

.block--active .block__badge {
  background: var(--teams-purple);
  color: #fff;
}

.block--inactive {
  border-style: dashed;
  background: var(--teams-panel);
  opacity: 0.6;
}

.block--inactive .block__badge {
  border: 1px solid var(--teams-text-muted);
  color: var(--teams-text-muted);
}

@media (max-width: 600px) {
  .arch__grid--2,
  .arch__grid--3 {
    grid-template-columns: minmax(0, 1fr);
  }

  .arch__toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
