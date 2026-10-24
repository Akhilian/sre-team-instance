<script setup lang="ts">
// Panneau « Guide animateur » de /admin : guide Markdown du scénario choisi (GET /api/admin/guides/:id),
// chargé à l'ouverture et à chaque changement de scénario, rendu en texte par MarkdownBlocks.
const props = defineProps<{ code: string }>()

const GUIDES = [
  { id: 'panne-checkout', label: 'Panne du checkout' },
  { id: 'fuite-donnees', label: 'Fuite de données clients' },
  { id: 'demo-express', label: 'Démo express' },
]

const scenarioId = ref(GUIDES[0]!.id)
const markdown = ref('')
const loading = ref(false)
const error = ref('')
const opened = ref(false)
let requestId = 0

async function load() {
  const current = ++requestId
  markdown.value = ''
  if (props.code === '') {
    error.value = 'Saisissez et validez le code animateur pour afficher le guide.'
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await $fetch<{ scenarioId: string, markdown: string }>(
      `/api/admin/guides/${encodeURIComponent(scenarioId.value)}`,
      { headers: { 'x-facilitator-code': props.code } },
    )
    if (current === requestId) markdown.value = result.markdown
  } catch (caught) {
    if (current !== requestId) return
    const statusCode = (caught as { statusCode?: number }).statusCode
    error.value = statusCode === 401 ? 'Code animateur invalide.' : 'Impossible de charger le guide.'
  } finally {
    if (current === requestId) loading.value = false
  }
}

function onToggle(event: Event) {
  opened.value = (event.target as HTMLDetailsElement).open
  if (opened.value) load()
}

watch(scenarioId, () => {
  if (opened.value) load()
})

// Un autre code invalide ce qui est affiché
watch(() => props.code, () => {
  if (opened.value) load()
  else {
    requestId++
    markdown.value = ''
    error.value = ''
  }
})
</script>

<template>
  <details class="card guide" data-testid="guide-panel" @toggle="onToggle">
    <summary class="guide__summary"><h2>Guide animateur</h2></summary>
    <div class="guide__body">
      <div class="guide__toolbar">
        <label for="guide-scenario">Scénario</label>
        <select id="guide-scenario" v-model="scenarioId" data-testid="guide-scenario">
          <option v-for="guide in GUIDES" :key="guide.id" :value="guide.id">{{ guide.label }}</option>
        </select>
      </div>
      <p v-if="error" class="guide__error" role="alert" data-testid="guide-error">{{ error }}</p>
      <p v-else-if="loading" class="guide__help">Chargement…</p>
      <MarkdownBlocks v-else-if="markdown" :markdown="markdown" data-testid="guide-content" />
    </div>
  </details>
</template>

<style scoped>
.guide__summary { cursor: pointer; }
.guide__summary h2 { display: inline; margin: 0; font-size: 16px; }
.guide__body { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.guide__toolbar { display: flex; align-items: center; gap: 12px; }
.guide__toolbar select { padding: 4px 8px; }
.guide__help { margin: 0; color: var(--teams-text-muted); font-size: 13px; }
.guide__error { margin: 0; color: #b10e1c; font-size: 13px; }
</style>
