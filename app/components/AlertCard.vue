<script setup lang="ts">
// Carte d'alerte informative façon connecteur Teams « Alerting » : bande gauche colorée par sévérité
// (portée par la bulle), titre, service et description. Aucune action ni suivi de statut.
import type { Alert } from '~~/shared/types/chat'
import { ALERT_SEVERITY_COLORS, ALERT_SEVERITY_LABELS } from '~~/shared/utils/alerts'

const props = defineProps<{
  alert: Alert
  /** Description courte (text du message) */
  text: string
}>()

const color = computed(() => ALERT_SEVERITY_COLORS[props.alert.severity])
</script>

<template>
  <div class="alert-card" data-testid="alert-card" :data-severity="alert.severity" :style="{ '--alert-color': color }">
    <div class="alert-card__head">
      <span class="alert-card__severity">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.5v.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ ALERT_SEVERITY_LABELS[alert.severity] }}
      </span>
    </div>
    <p class="alert-card__title">{{ alert.title }}</p>
    <p class="alert-card__service">
      <span class="alert-card__label">Service</span>
      <code>{{ alert.service }}</code>
    </p>
    <p class="alert-card__text">{{ text }}</p>
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
</style>
