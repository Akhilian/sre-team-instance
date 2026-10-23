<script setup lang="ts">
// Barre d'applications verticale façon Teams : icônes factices, seule « Équipes » est active.
const apps = [
  { id: 'activity', label: 'Activité', path: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2 15a2 2 0 0 0 4 0' },
  { id: 'chat', label: 'Conversation', path: 'M4 5h16v11H8l-4 4V5Z' },
  { id: 'teams', label: 'Équipes', path: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 19c0-3 2.7-5 6-5s6 2 6 5H3Zm13-5c2.8 0 5 1.6 5 4h-4.5' },
  { id: 'calendar', label: 'Calendrier', path: 'M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4' },
  { id: 'calls', label: 'Appels', path: 'M6 3h3l2 5-2 1.5a11 11 0 0 0 5.5 5.5L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z' },
  { id: 'files', label: 'Fichiers', path: 'M6 3h8l4 4v14H6V3Zm8 0v4h4' },
]
</script>

<template>
  <nav class="app-bar" data-testid="app-bar" aria-label="Applications">
    <button
      v-for="app in apps"
      :key="app.id"
      type="button"
      class="app-bar__item"
      :class="{ 'app-bar__item--active': app.id === 'teams' }"
      :aria-current="app.id === 'teams' ? 'page' : undefined"
      :title="app.label"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path :d="app.path" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
      <span class="app-bar__label">{{ app.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.app-bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 68px;
  padding-top: 4px;
  background: var(--teams-app-bar);
  flex: none;
}

.app-bar__item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 0 8px;
  border: 0;
  background: transparent;
  color: #c8c8d4;
  cursor: pointer;
}

.app-bar__item:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}

.app-bar__item--active {
  color: #fff;
}

.app-bar__item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: #a6a7dc;
}

.app-bar__item--active svg {
  color: #a6a7dc;
}

.app-bar__label {
  font-size: 10px;
  line-height: 1.2;
}

/* Écran étroit : barre réduite, icônes seules */
@media (max-width: 767px) {
  .app-bar {
    width: 48px;
  }

  .app-bar__label {
    display: none;
  }
}
</style>
