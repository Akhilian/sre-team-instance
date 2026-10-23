<script setup lang="ts">
import { isMe, splitMentions } from '~/utils/mentions'

const props = defineProps<{
  text: string
  /** Noms reconnus comme mentions `@nom` */
  knownNames: readonly string[]
  /** Participant courant : ses mentions sont mises en évidence */
  me: string
}>()

const segments = computed(() => splitMentions(props.text, props.knownNames))
</script>

<template>
  <!-- Texte interpolé (échappé par Vue) : jamais de v-html sur le contenu d'un message -->
  <p class="message__text"><template v-for="(segment, index) in segments" :key="index"><span
    v-if="segment.type === 'mention' && isMe(segment.name, me)"
    class="mention mention--me"
    data-testid="mention"
  >@{{ segment.name }}</span><span
    v-else-if="segment.type === 'mention'"
    class="mention"
    data-testid="mention"
  >@{{ segment.name }}</span><template v-else>{{ segment.value }}</template></template></p>
</template>

<style scoped>
.message__text {
  margin: 0;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mention {
  color: var(--teams-purple);
  font-weight: 600;
}

/* Mention du participant courant : fond marqué, repérable d'un coup d'œil */
.mention--me {
  padding: 0 3px;
  border-radius: 3px;
  background: #f9d9a8;
  color: #6b3a00;
}
</style>
