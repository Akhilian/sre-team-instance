<script setup lang="ts">
import type { Channel } from '~~/shared/types/chat'

defineProps<{
  channels: Channel[]
  currentId: string
}>()
</script>

<template>
  <aside class="channel-panel">
    <header class="channel-panel__header">
      <h2>Équipes</h2>
    </header>
    <div class="team">
      <div class="team__name">
        <span class="team__logo" aria-hidden="true">SRE</span>
        <span>Équipe SRE</span>
      </div>
      <ul class="channel-list" data-testid="channel-list">
        <li v-for="channel in channels" :key="channel.id">
          <NuxtLink
            :to="`/channels/${channel.id}`"
            class="channel-list__link"
            :class="{ 'channel-list__link--active': channel.id === currentId }"
          >
            {{ channel.name }}
          </NuxtLink>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.channel-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  flex: none;
  background: var(--teams-panel);
  border-right: 1px solid var(--teams-border);
}

.channel-panel__header {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 20px;
}

.channel-panel__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.team {
  padding: 4px 8px;
}

.team__name {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  font-weight: 600;
}

.team__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--teams-purple-light);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}

.channel-list {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.channel-list__link {
  display: block;
  padding: 7px 12px 7px 54px;
  border-radius: 4px;
  color: var(--teams-text);
  text-decoration: none;
}

.channel-list__link:hover {
  background: #f5f5f5;
}

.channel-list__link--active {
  background: #fff;
  font-weight: 600;
  color: var(--teams-purple);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
</style>
