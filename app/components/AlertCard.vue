<script setup lang="ts">
// Carte d'alerte façon connecteur Teams « Alerting » : bande gauche colorée par sévérité, titre,
// service, description, badge de statut, puis boutons Acquitter / Résoudre pour tout participant nommé.
import type { Alert } from '~~/shared/types/chat'
import type { AlertStatus } from '~~/shared/utils/alerts'
import { ALERT_SEVERITY_COLORS, ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS } from '~~/shared/utils/alerts'

const props = defineProps<{
  alert: Alert
  /** Description courte (text du message) */
  text: string
  /** Nom du participant courant ; vide = boutons désactivés */
  me: string
  /** Acquitte ou résout l'alerte au nom du participant courant */
  setStatus: (status: Exclude<AlertStatus, 'triggered'>) => Promise<void>
}>()

const busy = ref(false)
const error = ref('')

const color = computed(() => ALERT_SEVERITY_COLORS[props.alert.severity])
const canAck = computed(() => props.alert.status === 'triggered')
const canResolve = computed(() => props.alert.status !== 'resolved')

async function change(status: Exclude<AlertStatus, 'triggered'>) {
  if (busy.value || props.me === '') return
  busy.value = true
  error.value = ''
  try {
    await props.setStatus(status)
  }
  catch (caught) {
    const { data } = caught as { data?: { message?: string } }
    error.value = data?.message ?? 'Échec de la mise à jour, réessayez.'
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="alert-card" data-testid="alert-card" :data-status="alert.status" :data-severity="alert.severity" :style="{ '--alert-color': color }">
    <div class="alert-card__head">
      <span class="alert-card__severity">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.5v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ ALERT_SEVERITY_LABELS[alert.severity] }}
      </span>
      <span class="alert-card__status" :class="`alert-card__status--${alert.status}`" data-testid="alert-status">
        {{ ALERT_STATUS_LABELS[alert.status] }}
      </span>
    </div>
    <p class="alert-card__title">{{ alert.title }}</p>
    <p class="alert-card__service">
      <span class="alert-card__label">Service</span>
      <code>{{ alert.service }}</code>
    </p>
    <p class="alert-card__text">{{ text }}</p>

    <p v-if="alert.acknowledgedBy && alert.acknowledgedAt" class="alert-card__trail" data-testid="alert-acknowledged">
      Acquittée par {{ alert.acknowledgedBy }} à {{ formatTime(alert.acknowledgedAt) }}
    </p>
    <p v-if="alert.resolvedBy && alert.resolvedAt" class="alert-card__trail" data-testid="alert-resolved">
      Résolue par {{ alert.resolvedBy }} à {{ formatTime(alert.resolvedAt) }}
    </p>

    <div v-if="canAck || canResolve" class="alert-card__actions">
      <button
        v-if="canAck"
        type="button"
        class="alert-card__button alert-card__button--primary"
        data-testid="alert-ack"
        :disabled="me === '' || busy"
        @click="change('acknowledged')"
      >
        Acquitter
      </button>
      <button
        v-if="canResolve"
        type="button"
        class="alert-card__button"
        data-testid="alert-resolve"
        :disabled="me === '' || busy"
        @click="change('resolved')"
      >
        Résoudre
      </button>
    </div>
    <p v-if="error" class="alert-card__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
/* Carte adaptative : la bande de sévérité est portée par la bulle (bordure gauche, voir MessageList) */
.alert-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.alert-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.alert-card__severity {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--alert-color);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.alert-card__status {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.alert-card__status--triggered {
  background: #fdf3f4;
  color: #c4314b;
}

.alert-card__status--acknowledged {
  background: #fff4ce;
  color: #835b00;
}

.alert-card__status--resolved {
  background: #e7f2da;
  color: #237b4b;
}

.alert-card__title {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 700;
}

.alert-card__service {
  margin: 0;
  font-size: 13px;
}

.alert-card__label {
  margin-right: 6px;
  color: var(--teams-text-muted);
}

.alert-card__service code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--teams-bg);
  font-size: 12px;
}

.alert-card__text {
  margin: 0;
  white-space: pre-wrap;
}

.alert-card__trail {
  margin: 0;
  color: var(--teams-text-muted);
  font-size: 12px;
}

.alert-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--teams-border);
}

.alert-card__button {
  padding: 4px 14px;
  border: 1px solid #d1d1d1;
  border-radius: 4px;
  background: #fff;
  color: var(--teams-text);
  font-weight: 600;
  cursor: pointer;
}

.alert-card__button:hover:not(:disabled) {
  background: var(--teams-bg);
}

.alert-card__button--primary {
  border-color: var(--teams-purple);
  background: var(--teams-purple);
  color: #fff;
}

.alert-card__button--primary:hover:not(:disabled) {
  background: var(--teams-purple-dark);
}

.alert-card__button:disabled {
  border-color: #e0e0e0;
  background: #f0f0f0;
  color: #bdbdbd;
  cursor: default;
}

.alert-card__error {
  margin: 4px 0 0;
  color: #c4314b;
  font-size: 12px;
}
</style>
