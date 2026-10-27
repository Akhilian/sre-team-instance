<script setup lang="ts">
// Carte sobre d'une action d'équipe (compte « Ops ») : libellé, participant à l'origine, heure et message.
import type { Message } from '~~/shared/types/chat'

defineProps<{ message: Message }>()

const PHASE_LABELS = { start: 'Démarrée', progress: 'En cours', done: 'Terminée', error: 'Échec' } as const
</script>

<template>
  <div v-if="message.ops" class="ops-card" data-testid="ops-card" :data-phase="message.ops.phase">
    <p class="ops-card__head">
      <span class="ops-card__action">{{ message.ops.action }}</span>
      <span class="ops-card__phase">{{ PHASE_LABELS[message.ops.phase] }}</span>
    </p>
    <p class="ops-card__text">{{ message.text }}</p>
    <p class="ops-card__meta">
      Lancée par {{ message.ops.by }} · <time :datetime="message.createdAt">{{ formatTime(message.createdAt) }}</time>
    </p>
  </div>
  <p v-else class="ops-card__text">{{ message.text }}</p>
</template>

<style scoped>
.ops-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ops-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.ops-card__action {
  font-weight: 700;
}

.ops-card__phase {
  padding: 0 6px;
  border-radius: 3px;
  background: var(--teams-bg);
  color: var(--teams-text-muted);
  font-size: 12px;
}

.ops-card[data-phase='error'] .ops-card__phase {
  color: #b42318;
}

.ops-card__text {
  margin: 0;
  white-space: pre-wrap;
}

.ops-card__meta {
  margin: 0;
  color: var(--teams-text-muted);
  font-size: 12px;
}
</style>
