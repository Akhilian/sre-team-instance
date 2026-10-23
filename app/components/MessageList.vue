<script setup lang="ts">
import type { Message } from '~~/shared/types/chat'

const props = defineProps<{
  messages: Message[]
  /** Nom du participant courant : ses messages sont alignés à droite */
  me: string
}>()

const scroller = ref<HTMLElement | null>(null)

// Distance au bas (px) sous laquelle on considère que l'utilisateur suit le fil
const STICK_THRESHOLD_PX = 100

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX
}

function scrollToBottom() {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

onMounted(scrollToBottom)

// Fil ancré en bas façon Teams : à l'arrivée de messages (polling ou envoi), on suit le bas,
// sauf si l'utilisateur a remonté le fil. La proximité est mesurée avant la mise à jour du DOM
// (watch en flush 'pre'), le défilement après (nextTick). Son propre message ramène toujours en bas.
watch(
  () => [props.messages.length, props.messages.at(-1)?.id],
  (_, [, previousLastId]) => {
    const el = scroller.value
    if (!el) return
    const last = props.messages.at(-1)
    const sentByMe = props.me !== '' && last?.author === props.me && last.id !== previousLastId
    if (sentByMe || isNearBottom(el)) nextTick(scrollToBottom)
  },
)
</script>

<template>
  <div ref="scroller" class="message-scroller">
    <ol class="message-list" data-testid="message-list">
      <li v-if="messages.length === 0" class="message-list__empty">
        Aucun message pour l'instant. Lancez la conversation !
      </li>
      <li
        v-for="message in messages"
        :key="message.id"
        class="message"
        :class="{ 'message--mine': me !== '' && message.author === me }"
      >
        <span class="avatar" :style="{ background: avatarColor(message.author) }" :title="message.author">{{ initials(message.author) }}</span>
        <div class="message__bubble">
          <div class="message__meta">
            <span class="message__author">{{ message.author }}</span>
            <time class="message__time" :datetime="message.createdAt">{{ formatTime(message.createdAt) }}</time>
          </div>
          <p class="message__text">{{ message.text }}</p>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.message-scroller {
  flex: 1;
  overflow-y: auto;
  padding: 20px 32px;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 960px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.message-list__empty {
  margin-top: 40px;
  text-align: center;
  color: var(--teams-text-muted);
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.message__bubble {
  max-width: 70%;
  padding: 8px 14px 10px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.message__meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 2px;
}

.message__author {
  font-weight: 600;
  font-size: 13px;
}

.message__time {
  font-size: 12px;
  color: var(--teams-text-muted);
}

.message__text {
  margin: 0;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Ses propres messages : à droite, bulle violette claire, sans avatar ni nom */
.message--mine {
  flex-direction: row-reverse;
}

.message--mine .avatar,
.message--mine .message__author {
  display: none;
}

.message--mine .message__bubble {
  background: var(--teams-purple-tint);
}
</style>
