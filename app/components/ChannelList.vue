<script setup lang="ts">
import type { Channel } from '~~/shared/types/chat'
import type { NpcSummary } from '~~/shared/types/npc'
import { CHANNEL_NAME_MAX_LENGTH } from '~~/shared/utils/limits'

const props = defineProps<{
  /** Canaux d'équipe, suivis des conversations directes du participant (champ direct) */
  channels: Channel[]
  currentId: string
  /** Nom d'affichage ; vide tant qu'il n'est pas choisi (conversations indisponibles) */
  participant?: string
  /** PNJ du scénario courant (/api/npcs) */
  npcs?: readonly NpcSummary[]
  npcsEnabled?: boolean
  /** Non-lus par id de canal ; vide au SSR et avant montage */
  unread?: Record<string, number>
  /** Tiroir ouvert (écran étroit uniquement ; sans effet en mode large) */
  open?: boolean
}>()

function unreadCount(channelId: string): number {
  if (channelId === props.currentId) return 0
  return props.unread?.[channelId] ?? 0
}

const teamChannels = computed(() => props.channels.filter(channel => !channel.direct))
const directChannels = computed(() => props.channels.filter(channel => channel.direct))

interface ConversationEntry {
  key: string
  name: string
  role: string
  npcId: string
  /** Conversation existante ; absente tant qu'elle n'a pas été ouverte */
  channel?: Channel
}

// PNJ actifs : un lien par PNJ (conversation existante ou à ouvrir). PNJ coupés : les conversations
// existantes seulement ; la section disparaît s'il n'y en a aucune.
const conversations = computed<ConversationEntry[]>(() => {
  const npcs = props.npcs ?? []
  if (props.npcsEnabled) {
    return npcs.map(npc => ({
      key: npc.id,
      name: npc.name,
      role: npc.role,
      npcId: npc.id,
      channel: directChannels.value.find(channel => channel.direct!.npcId === npc.id),
    }))
  }
  return directChannels.value.map((channel) => {
    const npc = npcs.find(candidate => candidate.id === channel.direct!.npcId)
    return {
      key: channel.id,
      name: npc?.name ?? channel.direct!.npcName,
      role: npc?.role ?? '',
      npcId: channel.direct!.npcId,
      channel,
    }
  })
})

const opening = ref('')
const directError = ref('')

/** Ouvre (ou retrouve) la conversation avec le PNJ, puis la page parente y navigue */
async function openConversation(npcId: string) {
  if (!props.participant || opening.value) return
  opening.value = npcId
  directError.value = ''
  try {
    const channel = await $fetch<Channel>('/api/direct', {
      method: 'POST',
      body: { participant: props.participant, npcId },
    })
    emit('close')
    emit('created', channel)
  }
  catch (err) {
    const data = (err as { data?: { message?: string } }).data
    directError.value = data?.message ?? 'Impossible d\'ouvrir la conversation'
  }
  finally {
    opening.value = ''
  }
}

const emit = defineEmits<{
  created: [channel: Channel]
  /** Demande de fermeture du tiroir (clic sur un canal) */
  close: []
}>()

const creating = ref(false)
const name = ref('')
const error = ref('')
const submitting = ref(false)
const input = ref<HTMLInputElement | null>(null)
const trimmed = computed(() => name.value.trim())

async function openForm() {
  creating.value = true
  error.value = ''
  await nextTick()
  input.value?.focus()
}

function closeForm() {
  creating.value = false
  name.value = ''
  error.value = ''
}

async function submit() {
  if (trimmed.value === '' || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const channel = await $fetch<Channel>('/api/channels', {
      method: 'POST',
      body: { name: trimmed.value },
    })
    closeForm()
    emit('created', channel)
  }
  catch (err) {
    // 400 / 409 : le message de l'API est affiché tel quel dans le formulaire
    const data = (err as { data?: { message?: string } }).data
    error.value = data?.message ?? 'Impossible de créer le canal'
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <aside class="channel-panel" :class="{ 'channel-panel--open': open }" aria-label="Canaux">
    <header class="channel-panel__header">
      <h2>Équipes</h2>
    </header>
    <div class="team">
      <div class="team__name">
        <span class="team__logo" aria-hidden="true">SRE</span>
        <span>Équipe SRE</span>
        <button
          type="button"
          class="team__add"
          data-testid="create-channel"
          title="Créer un canal"
          aria-label="Créer un canal"
          @click="creating ? closeForm() : openForm()"
        >
          +
        </button>
      </div>
      <form
        v-if="creating"
        class="channel-form"
        data-testid="create-channel-form"
        @submit.prevent="submit"
        @keydown.esc.stop="closeForm"
      >
        <label for="channel-name-input">Nom du canal</label>
        <input
          id="channel-name-input"
          ref="input"
          v-model="name"
          data-testid="create-channel-input"
          type="text"
          :maxlength="CHANNEL_NAME_MAX_LENGTH"
          placeholder="Ex. Incident base de données"
        >
        <p v-if="error" class="channel-form__error" role="alert" data-testid="create-channel-error">{{ error }}</p>
        <div class="channel-form__actions">
          <button type="button" class="channel-form__button" @click="closeForm">Annuler</button>
          <button
            type="submit"
            class="channel-form__button channel-form__button--primary"
            :disabled="trimmed === '' || submitting"
          >
            Créer
          </button>
        </div>
      </form>
      <ul class="channel-list" data-testid="channel-list">
        <li v-for="channel in teamChannels" :key="channel.id">
          <NuxtLink
            :to="`/channels/${channel.id}`"
            class="channel-list__link"
            :class="{
              'channel-list__link--active': channel.id === currentId,
              'channel-list__link--unread': unreadCount(channel.id) > 0,
            }"
            @click="emit('close')"
          >
            <span class="channel-list__name">{{ channel.name }}</span>
            <span
              v-if="unreadCount(channel.id) > 0"
              class="channel-list__badge"
              data-testid="unread-badge"
              :aria-label="`${unreadCount(channel.id)} message(s) non lu(s)`"
            >{{ unreadBadgeLabel(unreadCount(channel.id)) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>

    <section v-if="conversations.length > 0" class="conversations" data-testid="conversations" aria-labelledby="conversations-title">
      <h2 id="conversations-title" class="conversations__title">Conversations</h2>
      <ul class="conversation-list">
        <li v-for="entry in conversations" :key="entry.key">
          <NuxtLink
            v-if="entry.channel"
            :to="`/channels/${entry.channel.id}`"
            class="conversation"
            :class="{
              'conversation--active': entry.channel.id === currentId,
              'conversation--unread': unreadCount(entry.channel.id) > 0,
              'conversation--inactive': !npcsEnabled,
            }"
            data-testid="conversation-link"
            :title="npcsEnabled ? undefined : 'PNJ inactif'"
            @click="emit('close')"
          >
            <span class="avatar conversation__avatar" aria-hidden="true" :style="{ background: avatarColor(entry.name) }">{{ initials(entry.name) }}</span>
            <span class="conversation__text">
              <span class="conversation__name">{{ entry.name }}</span>
              <span v-if="entry.role" class="conversation__role">{{ entry.role }}</span>
            </span>
            <span
              v-if="unreadCount(entry.channel.id) > 0"
              class="channel-list__badge"
              data-testid="unread-badge"
              :aria-label="`${unreadCount(entry.channel.id)} message(s) non lu(s)`"
            >{{ unreadBadgeLabel(unreadCount(entry.channel.id)) }}</span>
          </NuxtLink>
          <button
            v-else
            type="button"
            class="conversation"
            data-testid="conversation-link"
            :disabled="!participant || opening !== ''"
            :title="participant ? `Écrire à ${entry.name}` : 'Choisissez un nom d\'affichage pour écrire'"
            @click="openConversation(entry.npcId)"
          >
            <span class="avatar conversation__avatar" aria-hidden="true" :style="{ background: avatarColor(entry.name) }">{{ initials(entry.name) }}</span>
            <span class="conversation__text">
              <span class="conversation__name">{{ entry.name }}</span>
              <span v-if="entry.role" class="conversation__role">{{ entry.role }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="directError" class="channel-form__error conversations__error" role="alert">{{ directError }}</p>
    </section>
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
  overflow-y: auto;
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

.team__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--teams-text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.team__add:hover {
  background: #fff;
  color: var(--teams-purple);
}

.channel-form {
  margin: 4px 4px 8px;
  padding: 12px;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.channel-form label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
}

.channel-form input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--teams-border);
  border-bottom: 2px solid var(--teams-purple);
  border-radius: 4px;
  outline: none;
}

.channel-form__error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #c4314b;
}

.channel-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.channel-form__button {
  padding: 4px 12px;
  border: 1px solid var(--teams-border);
  border-radius: 4px;
  background: #fff;
  font-weight: 600;
  cursor: pointer;
}

.channel-form__button--primary {
  border-color: var(--teams-purple);
  background: var(--teams-purple);
  color: #fff;
}

.channel-form__button:disabled {
  opacity: 0.5;
  cursor: default;
}

.channel-list {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.channel-list__link {
  display: flex;
  align-items: center;
  gap: 8px;
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

.channel-list__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-list__link--unread {
  font-weight: 700;
}

.channel-list__badge {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--teams-purple);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
}

/* Conversations directes avec les PNJ, comme la liste « Conversation » de Teams */
.conversations {
  padding: 8px 8px 16px;
}

.conversations__title {
  margin: 0;
  padding: 8px 12px 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--teams-text-muted);
}

.conversation-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.conversation {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--teams-text);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.conversation:hover:not(:disabled) {
  background: #f5f5f5;
}

.conversation:disabled {
  opacity: 0.6;
  cursor: default;
}

/* PNJ coupés : conversation existante toujours ouvrable, mais grisée */
.conversation--inactive {
  opacity: 0.6;
}

.conversation--active {
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.conversation--active .conversation__name {
  color: var(--teams-purple);
  font-weight: 600;
}

.conversation--unread .conversation__name {
  font-weight: 700;
}

.conversation__avatar {
  width: 28px;
  height: 28px;
  font-size: 11px;
}

.conversation__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.conversation__name,
.conversation__role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation__role {
  font-size: 12px;
  color: var(--teams-text-muted);
}

.conversations__error {
  padding: 0 12px;
}

/* Écran étroit : tiroir fixe à gauche, au-dessus du fil et du voile, fermé par défaut */
@media (max-width: 767px) {
  .channel-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 40;
    width: min(280px, 85vw);
    overflow-y: auto;
    box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25);
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.2s, visibility 0.2s;
  }

  .channel-panel--open {
    transform: none;
    visibility: visible;
  }
}
</style>
