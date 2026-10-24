<script setup lang="ts">
import type { Message } from '~~/shared/types/chat'
import type { AlertStatus } from '~~/shared/utils/alerts'
import { ALERT_SEVERITY_COLORS } from '~~/shared/utils/alerts'
import type { MentionCandidate } from '~~/shared/utils/mentions'
import { mentionsName } from '~~/shared/utils/mentions'
import { roleBadge } from '~~/shared/onboarding/roles'
import { groupThreads } from '~/utils/threads'

const props = defineProps<{
  messages: Message[]
  /** Nom du participant courant : ses mentions sont mises en évidence */
  me: string
  /** Noms des PNJ du scénario, reconnus comme mentions même avant leur première réponse */
  npcNames?: readonly string[]
  /** Personnes proposées par l'autocomplétion des mentions dans les fils */
  mentionCandidates?: readonly MentionCandidate[]
  /** Rôles connus des participants présents, par nom */
  roles?: Readonly<Record<string, string>>
  /** Poste une réponse dans le fil de la racine parentId */
  reply: (parentId: string, text: string) => Promise<void>
  /** Bascule la réaction emoji du participant courant sur un message */
  react: (messageId: string, emoji: string) => Promise<void>
  /** Acquitte ou résout une carte d'alerte au nom du participant courant */
  setAlertStatus: (messageId: string, status: Exclude<AlertStatus, 'triggered'>) => Promise<void>
}>()

const emit = defineEmits<{
  /** Frappe dans un champ de réponse, remontée à la page */
  typing: []
}>()

const threads = computed(() => groupThreads(props.messages))

// Noms reconnus comme mentions : auteurs du canal affiché, PNJ du scénario, plus le participant courant
const knownNames = computed(() => [...new Set([
  ...props.messages.map(message => message.author),
  ...(props.npcNames ?? []),
  props.me,
])])

// Calculé une fois par liste (et non à chaque appel du template) : id → mentionne le participant courant
const mentionsMeById = computed(() => new Map(
  props.messages.map(message => [message.id, mentionsName(message.text, knownNames.value, props.me)]),
))

function mentionsMe(message: Message): boolean {
  return mentionsMeById.value.get(message.id) ?? false
}

/** Badge de rôle d'un message de participant : jamais pour Alerting, l'Animateur ni les collègues joués par l'outil */
function authorRoleBadge(message: Message): string {
  if (message.kind === 'alert' || message.kind === 'announcement' || message.npc) return ''
  return roleBadge(props.roles?.[message.author])
}

function isAnnouncement(message: Message): boolean {
  return message.kind === 'announcement'
}

/** Bande gauche de la bulle d'une alerte, colorée selon sa sévérité */
function alertBandStyle(message: Message): Record<string, string> | undefined {
  return message.alert ? { borderLeftColor: ALERT_SEVERITY_COLORS[message.alert.severity] } : undefined
}

// Un seul champ de réponse ouvert à la fois
const replyingTo = ref<string | null>(null)

function isMine(message: Message): boolean {
  return props.me !== '' && message.author === props.me
}

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

// Fil ancré en bas façon Teams : seule l'arrivée d'une nouvelle racine (polling ou envoi) fait suivre
// le bas, sauf si l'utilisateur a remonté le fil ; une réponse dans un fil ancien ne déplace pas la vue.
// La proximité est mesurée avant la mise à jour du DOM (watch en flush 'pre'), le défilement après
// (nextTick). Sa propre racine ramène toujours en bas.
watch(
  () => threads.value.at(-1)?.id,
  (lastId, previousLastId) => {
    const el = scroller.value
    if (!el || lastId === previousLastId) return
    const last = threads.value.at(-1)
    const sentByMe = last !== undefined && isMine(last)
    if (sentByMe || isNearBottom(el)) nextTick(scrollToBottom)
  },
)
</script>

<template>
  <div ref="scroller" class="message-scroller">
    <ol class="message-list" data-testid="message-list">
      <li v-if="threads.length === 0" class="message-list__empty">
        Aucun message pour l'instant. Lancez la conversation !
      </li>
      <li v-for="thread in threads" :key="thread.id" class="thread" data-testid="thread">
        <div
          class="message"
          :class="{ 'message--mentions-me': mentionsMe(thread), 'message--announcement': isAnnouncement(thread), 'message--alert': thread.kind === 'alert' }"
          :data-testid="isAnnouncement(thread) ? 'announcement' : undefined"
        >
          <span class="avatar" :style="{ background: avatarColor(thread.author) }" :title="thread.author">{{ initials(thread.author) }}</span>
          <div class="message__body">
            <div class="message__bubble" :data-testid="mentionsMe(thread) ? 'mentions-me' : undefined" :style="alertBandStyle(thread)">
              <div v-if="isAnnouncement(thread)" class="message__banner">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M4 10v4h3l6 4V6L7 10H4Zm12-1.5a4 4 0 0 1 0 7M18.5 6a7.5 7.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                Annonce
              </div>
              <div class="message__meta">
                <span class="message__author">{{ thread.author }}</span>
                <span v-if="authorRoleBadge(thread)" class="role-badge" data-testid="author-role">{{ authorRoleBadge(thread) }}</span>
                <time class="message__time" :datetime="thread.createdAt">{{ formatTime(thread.createdAt) }}</time>
              </div>
              <AlertCard
                v-if="thread.kind === 'alert' && thread.alert"
                :alert="thread.alert"
                :text="thread.text"
                :me="me"
                :set-status="status => setAlertStatus(thread.id, status)"
              />
              <MessageText v-else :text="thread.text" :known-names="knownNames" :me="me" />
            </div>
            <MessageReactions :reactions="thread.reactions" :me="me" :react="emoji => react(thread.id, emoji)" />
          </div>
        </div>

        <div class="thread__footer">
          <ol v-if="thread.replies.length > 0" class="thread__replies">
            <li
              v-for="message in thread.replies"
              :key="message.id"
              class="message message--reply"
              :class="{ 'message--mentions-me': mentionsMe(message) }"
              data-testid="reply"
            >
              <span class="avatar" :style="{ background: avatarColor(message.author) }" :title="message.author">{{ initials(message.author) }}</span>
              <div class="message__body">
                <div class="message__bubble" :data-testid="mentionsMe(message) ? 'mentions-me' : undefined">
                  <div class="message__meta">
                    <span class="message__author">{{ message.author }}</span>
                    <span v-if="authorRoleBadge(message)" class="role-badge" data-testid="author-role">{{ authorRoleBadge(message) }}</span>
                    <time class="message__time" :datetime="message.createdAt">{{ formatTime(message.createdAt) }}</time>
                  </div>
                  <MessageText :text="message.text" :known-names="knownNames" :me="me" />
                </div>
                <MessageReactions :reactions="message.reactions" :me="me" :react="emoji => react(message.id, emoji)" />
              </div>
            </li>
          </ol>

          <ReplyComposer
            v-if="replyingTo === thread.id"
            :send="text => reply(thread.id, text)"
            :mention-candidates="mentionCandidates"
            :me="me"
            @close="replyingTo = null"
            @typing="emit('typing')"
          />
          <button
            v-else
            type="button"
            class="thread__reply-button"
            data-testid="reply-button"
            :disabled="me === ''"
            @click="replyingTo = thread.id"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Répondre
          </button>
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
/* Bouton d'ajout de réaction (MessageReactions) révélé au survol du message */
.message:hover :deep(.reactions__add) {
  opacity: 1;
}

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

.thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Réponses et lien « Répondre » : indentés sous la racine (largeur de l'avatar + écart) */
.thread__footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-left: 42px;
}

.thread__replies {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 0 0 10px;
  border-left: 2px solid var(--teams-border);
  list-style: none;
}

.thread__reply-button {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--teams-purple);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.thread__reply-button:hover:not(:disabled) {
  background: var(--teams-purple-tint);
}

.thread__reply-button:disabled {
  color: #bdbdbd;
  cursor: default;
}

.message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.message__body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 70%;
  min-width: 0;
}

.message__bubble {
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
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

/* Réponses : plus compactes que la racine */
.message--reply {
  gap: 8px;
}

.message--reply .avatar {
  width: 24px;
  height: 24px;
  font-size: 10px;
}

.message--reply .message__bubble {
  padding: 5px 10px 6px;
  box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
}

.message--reply .message__author {
  font-size: 12px;
}

.message--reply .message__time {
  font-size: 11px;
}

.message--reply .message__text {
  font-size: 13px;
  line-height: 1.4;
}

/* Annonce de l'animateur, façon Teams : bandeau coloré en tête de bulle et bordure violette */
.message--announcement .message__bubble {
  overflow: hidden;
  padding-top: 0;
  border: 2px solid var(--teams-purple);
}

.message__banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 -14px 8px;
  padding: 8px 14px;
  background: linear-gradient(90deg, var(--teams-purple-dark), var(--teams-purple));
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

/* Message qui mentionne le participant courant : bordure gauche colorée, façon Teams */
.message--mentions-me .message__bubble {
  border-left: 3px solid #c4314b;
}

/* Carte d'alerte façon connecteur Teams : bulle élargie, bande de sévérité à gauche (couleur en style) */
.message--alert .message__body {
  width: 100%;
  max-width: 520px;
}

.message--alert .message__bubble {
  width: 100%;
  box-sizing: border-box;
  border-left: 5px solid;
}

/* Écran étroit : marges réduites, bulles sur toute la largeur disponible */
@media (max-width: 767px) {
  .message-scroller {
    padding: 16px 12px;
  }

  .message__body {
    max-width: 100%;
  }
}
</style>
