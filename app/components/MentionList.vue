<script setup lang="ts">
import type { MentionCandidate } from '~~/shared/utils/mentions'
import { avatarColor, initials } from '~/utils/initials'
// Liste des suggestions de mention, posée au-dessus du champ ; le champ porte le rôle combobox.
defineProps<{
  listId: string
  optionId: (index: number) => string
  suggestions: readonly MentionCandidate[]
  active: number
  select: (index: number) => void
}>()
</script>

<template>
  <ul :id="listId" class="mention-list" role="listbox" aria-label="Suggestions de mention" data-testid="mention-list">
    <li
      v-for="(candidate, index) in suggestions"
      :id="optionId(index)"
      :key="candidate.name"
      role="option"
      class="mention-list__option"
      :class="{ 'mention-list__option--active': index === active }"
      :aria-selected="index === active ? 'true' : 'false'"
      data-testid="mention-option"
      @mousedown.prevent="select(index)"
    >
      <span class="avatar mention-list__avatar" aria-hidden="true" :style="{ background: avatarColor(candidate.name) }">{{ initials(candidate.name) }}</span>
      <span class="mention-list__name">{{ candidate.name }}</span>
      <span v-if="candidate.role" class="mention-list__role">{{ candidate.role }}</span>
    </li>
  </ul>
</template>

<style scoped>
.mention-list {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  min-width: 240px;
  max-width: 100%;
  margin: 0;
  padding: 4px;
  list-style: none;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.mention-list__option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.mention-list__option--active,
.mention-list__option:hover {
  background: var(--teams-purple-tint);
}

.mention-list__avatar {
  width: 24px;
  height: 24px;
  font-size: 10px;
}

.mention-list__name {
  font-weight: 600;
}

.mention-list__role {
  overflow: hidden;
  color: var(--teams-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
