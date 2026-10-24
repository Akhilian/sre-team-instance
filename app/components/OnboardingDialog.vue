<script setup lang="ts">
// Parcours d'accueil en cinq étapes (contenu dans shared/onboarding), dont le choix du rôle d'incident.
// Rendu côté client seulement (ouvert après le choix du nom ou par le bouton « Aide »).
import { DEFAULT_ROLE_ID, ROLES, roleSheet, type RoleId } from '~~/shared/onboarding/roles'
import { ONBOARDING_STEPS } from '~~/shared/onboarding/steps'

const props = defineProps<{
  /** Rôle déjà connu du participant (présélectionné) ; vide à la première connexion */
  currentRole: RoleId | ''
  /** Vrai si le parcours a déjà été suivi : Échap le ferme alors */
  closable: boolean
}>()

const emit = defineEmits<{
  /** Fin du parcours (Terminer ou Passer) avec le rôle retenu */
  done: [role: RoleId]
  /** Fermeture sans rien changer (Échap, parcours déjà suivi) */
  close: []
}>()

const stepCount = ONBOARDING_STEPS.length
const index = ref(0)
const selected = ref<RoleId>(props.currentRole || DEFAULT_ROLE_ID)
const step = computed(() => ONBOARDING_STEPS[index.value]!)
const isLast = computed(() => index.value === stepCount - 1)
const sheet = computed(() => roleSheet(selected.value))

const dialog = ref<HTMLElement | null>(null)
const title = ref<HTMLElement | null>(null)
const previouslyFocused = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null

// Le titre de l'étape reçoit le focus à l'ouverture et à chaque changement d'étape
async function focusTitle() {
  await nextTick()
  title.value?.focus()
}

onMounted(focusTitle)
onBeforeUnmount(() => previouslyFocused?.focus?.())
watch(index, focusTitle)

function next() {
  if (!isLast.value) index.value++
}

function previous() {
  if (index.value > 0) index.value--
}

function finish() {
  emit('done', selected.value)
}

function skip() {
  emit('done', props.currentRole || DEFAULT_ROLE_ID)
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"], [tabindex="-1"].dialog__title'

// Piège de focus simple : Tab et Maj+Tab bouclent dans le dialogue ; Échap ferme si le parcours a déjà été suivi
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.closable) {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const items = [...dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (event.shiftKey && (active === first || !dialog.value.contains(active))) {
    event.preventDefault()
    last.focus()
  }
  else if (!event.shiftKey && (active === last || !dialog.value.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <div class="dialog-backdrop" @keydown="onKeydown">
    <div
      ref="dialog"
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      data-testid="onboarding-dialog"
    >
      <p class="dialog__progress" data-testid="onboarding-progress">Étape {{ index + 1 }} sur {{ stepCount }}</p>
      <h2 id="onboarding-title" ref="title" class="dialog__title" tabindex="-1" data-testid="onboarding-title">{{ step.title }}</h2>

      <div class="dialog__content">
        <p v-for="paragraph in step.paragraphs" :key="paragraph">{{ paragraph }}</p>
        <template v-for="(list, listIndex) in step.lists" :key="listIndex">
          <h3 v-if="list.title">{{ list.title }}</h3>
          <ul>
            <li v-for="item in list.items" :key="item">{{ item }}</li>
          </ul>
        </template>

        <template v-if="step.id === 'role'">
          <fieldset class="roles" data-testid="onboarding-roles">
            <legend>Votre rôle dans l'exercice</legend>
            <label v-for="role in ROLES" :key="role.id" class="roles__option" :class="{ 'roles__option--selected': selected === role.id }">
              <input v-model="selected" type="radio" name="onboarding-role" :value="role.id" :data-testid="`role-${role.id}`">
              <span>{{ role.label }}</span>
            </label>
          </fieldset>

          <section class="sheet" data-testid="role-sheet" aria-live="polite">
            <h3>{{ sheet.label }}</h3>
            <p>{{ sheet.mission }}</p>
            <h4>Vos réflexes</h4>
            <ul>
              <li v-for="reflex in sheet.reflexes" :key="reflex">{{ reflex }}</li>
            </ul>
            <h4>À qui parler</h4>
            <p>{{ sheet.whoToTalkTo }}</p>
          </section>
        </template>
      </div>

      <div class="dialog__actions">
        <button v-if="!isLast" type="button" class="button button--link" data-testid="onboarding-skip" @click="skip">Passer</button>
        <span class="dialog__spacer" />
        <button type="button" class="button button--secondary" data-testid="onboarding-previous" :disabled="index === 0" @click="previous">Précédent</button>
        <button v-if="!isLast" type="button" class="button button--primary" data-testid="onboarding-next" @click="next">Suivant</button>
        <button v-else type="button" class="button button--primary" data-testid="onboarding-finish" @click="finish">Terminer</button>
      </div>
    </div>
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
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  padding: 24px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
}

.dialog__progress {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--teams-text-muted);
}

.dialog__title {
  margin: 0 0 12px;
  font-size: 20px;
  outline: none;
}

.dialog__title:focus-visible {
  outline: 2px solid var(--teams-purple);
  outline-offset: 2px;
}

.dialog__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.dialog__content p {
  margin: 0 0 12px;
}

.dialog__content h3 {
  margin: 14px 0 6px;
  font-size: 15px;
}

.dialog__content h4 {
  margin: 10px 0 4px;
  font-size: 13px;
  color: var(--teams-text-muted);
}

.dialog__content ul {
  margin: 0 0 12px;
  padding-left: 20px;
}

.dialog__content li {
  margin-bottom: 6px;
}

.roles {
  margin: 0 0 12px;
  padding: 8px 12px 10px;
  border: 1px solid var(--teams-border);
  border-radius: 6px;
}

.roles legend {
  padding: 0 6px;
  font-weight: 600;
}

.roles__option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.roles__option:hover {
  background: #f5f5f5;
}

.roles__option--selected {
  background: #ebebf7;
  font-weight: 600;
}

.sheet {
  padding: 10px 14px;
  border-left: 3px solid var(--teams-purple);
  background: #f7f7fc;
}

.sheet h3 {
  margin-top: 0;
}

.dialog__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.dialog__spacer {
  flex: 1;
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

.button--secondary {
  border: 1px solid #d1d1d1;
  background: #fff;
}

.button--secondary:hover:not(:disabled) {
  background: #f5f5f5;
}

.button--secondary:disabled {
  color: #bdbdbd;
  cursor: default;
}

.button--link {
  border: 0;
  background: transparent;
  color: var(--teams-purple);
}

.button--link:hover {
  text-decoration: underline;
}

/* Écran étroit : dialogue en plein écran */
@media (max-width: 599px) {
  .dialog {
    width: 100vw;
    height: 100vh;
    max-height: none;
    border-radius: 0;
    padding: 16px;
  }

  .dialog__actions {
    flex-wrap: wrap;
  }
}
</style>
