<script setup lang="ts">
import type { Channel, ChannelSummary, Message, MessagesDelta } from '~~/shared/types/chat'
import type { NpcsResponse } from '~~/shared/types/npc'
import { CHANNEL_MESSAGES_MAX } from '~~/shared/utils/limits'
import { mergeMessages } from '~/utils/messages'

const POLL_INTERVAL_MS = 3000
/** Plafond de l'intervalle après des échecs successifs (doublé à chaque échec) */
const POLL_MAX_INTERVAL_MS = 30_000
/** Canal de repli quand le canal courant a été supprimé (reset complet) */
const FALLBACK_CHANNEL_ID = 'incident-en-cours'
/** `typing: true` envoyé au plus une fois par intervalle pendant la frappe */
const TYPING_THROTTLE_MS = 2000
/** Avatars de présence affichés avant la pastille « +N » */
const PRESENCE_MAX_AVATARS = 4

const route = useRoute()
const channelId = computed(() => String(route.params.id))

const { data: channels, refresh: refreshChannels } = await useFetch('/api/channels')
const channel = computed(() => channels.value?.find(c => c.id === channelId.value))
if (!channel.value) {
  throw createError({ statusCode: 404, statusMessage: 'Canal introuvable', fatal: true })
}

const { data: messages } = await useFetch<Message[]>(
  () => `/api/channels/${channelId.value}/messages`,
  { default: () => [] },
)

// PNJ du scénario : leurs noms sont surlignés comme mentions avant même leur première réponse
const { data: npcState } = await useFetch<NpcsResponse>('/api/npcs')
const npcNames = computed(() => npcState.value?.npcs.map(npc => npc.name) ?? [])

// Non-lus : calculés côté client seulement (localStorage), vides au SSR et avant montage
const unread = ref<Record<string, number>>({})
const mounted = ref(false)

function updateUnread() {
  if (!mounted.value || !channels.value) return
  const seen = parseSeen(localStorage.getItem(LAST_SEEN_STORAGE_KEY))
  const { counts, nextSeen } = computeUnread(channels.value, seen, channelId.value)
  localStorage.setItem(LAST_SEEN_STORAGE_KEY, JSON.stringify(nextSeen))
  unread.value = counts
}

// À chaque poll (nouvelle liste de canaux) et à chaque navigation entre canaux
watch([channels, channelId], updateUnread)

const unreadTotal = computed(() => totalUnread(unread.value, channelId.value))

useHead({
  title: () => {
    const prefix = unreadTotal.value > 0 ? `(${unreadTotal.value}) ` : ''
    return `${prefix}${channel.value?.name ?? 'Canal'} | SRE Team Instance`
  },
})

const { displayName, loaded, setDisplayName } = useDisplayName()
const editingName = ref(false)
const showNameDialog = computed(() => loaded.value && (displayName.value === '' || editingName.value))

function saveName(name: string) {
  setDisplayName(name)
  editingName.value = false
}

// Présence et frappe : client uniquement, vides au SSR et avant montage (pas d'écart d'hydratation)
interface ChannelPresence { present: string[], typing: string[] }
const presence = ref<ChannelPresence>({ present: [], typing: [] })
let lastTypingSentAt = 0

async function heartbeat(typing?: boolean) {
  if (!mounted.value || !displayName.value) return
  const targetChannel = channelId.value
  try {
    const result = await $fetch<ChannelPresence>('/api/presence', {
      method: 'POST',
      body: { name: displayName.value, channelId: targetChannel, typing },
    })
    // Réponse d'un canal quitté entre-temps : ignorée
    if (targetChannel === channelId.value) presence.value = result
  }
  catch {
    // Battement perdu : le suivant (≤ 3 s) rattrape, rien à signaler
  }
}

function onTyping() {
  const now = Date.now()
  if (now - lastTypingSentAt < TYPING_THROTTLE_MS) return
  lastTypingSentAt = now
  heartbeat(true)
}

function stopTyping() {
  lastTypingSentAt = 0
  heartbeat(false)
}

watch(channelId, () => {
  presence.value = { present: [], typing: [] }
  lastTypingSentAt = 0
  heartbeat()
})
// Nom choisi ou modifié après le montage
watch(displayName, () => heartbeat())

const presenceAvatars = computed(() => presence.value.present.slice(0, PRESENCE_MAX_AVATARS))
const presenceOverflow = computed(() => Math.max(0, presence.value.present.length - PRESENCE_MAX_AVATARS))
const typingText = computed(() => typingLabel(presence.value.typing, displayName.value))

// Mutations locales : le message renvoyé est fusionné aussitôt, sans rechargement. Le curseur n'avance
// pas : le poll suivant le renverra (remplacement à l'identique) avec les changements des autres.
function applyLocal(targetChannel: string, message: Message) {
  if (targetChannel === channelId.value) messages.value = mergeMessages(messages.value ?? [], [message], CHANNEL_MESSAGES_MAX)
}

async function send(text: string) {
  const targetChannel = channelId.value
  const created = await $fetch<Message>(`/api/channels/${targetChannel}/messages`, {
    method: 'POST',
    body: { author: displayName.value, text },
  })
  stopTyping()
  applyLocal(targetChannel, created)
}

async function reply(parentId: string, text: string) {
  const targetChannel = channelId.value
  const created = await $fetch<Message>(`/api/channels/${targetChannel}/messages`, {
    method: 'POST',
    body: { author: displayName.value, text, parentId },
  })
  stopTyping()
  applyLocal(targetChannel, created)
}

// Bascule une réaction ; le message renvoyé remplace aussitôt l'ancien, sans attendre le polling
async function react(messageId: string, emoji: string) {
  const targetChannel = channelId.value
  const updated = await $fetch<Message>(`/api/channels/${targetChannel}/messages/${messageId}/reactions`, {
    method: 'POST',
    body: { emoji, author: displayName.value },
  })
  applyLocal(targetChannel, updated)
}

// Acquitte ou résout une alerte ; le message renvoyé remplace l'ancien sans attendre le polling.
// En cas de refus (déjà acquittée ailleurs…), un poll immédiat affiche l'état réel, puis on remonte l'erreur.
async function setAlertStatus(messageId: string, status: 'acknowledged' | 'resolved') {
  const targetChannel = channelId.value
  try {
    const updated = await $fetch<Message>(`/api/channels/${targetChannel}/messages/${messageId}/alert-status`, {
      method: 'POST',
      body: { status, name: displayName.value },
    })
    applyLocal(targetChannel, updated)
  }
  catch (error) {
    await pollOnce()
    throw error
  }
}

// Panneau des canaux en tiroir sur écran étroit : fermé au SSR, refermé à chaque navigation
const channelPanelOpen = ref(false)
watch(channelId, () => {
  channelPanelOpen.value = false
})

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && channelPanelOpen.value) channelPanelOpen.value = false
}

async function onChannelCreated(created: Channel) {
  await refreshChannels()
  await navigateTo(`/channels/${created.id}`)
}

// Polling incrémental : messages modifiés depuis le curseur (?since=), liste des canaux (canaux créés
// ailleurs, non-lus) et présence. Un setTimeout réarmé à chaque tour (intervalle variable) ; suspendu
// quand l'onglet est caché, rattrapage immédiat au retour ; intervalle doublé après chaque échec
// (réseau ou 5xx) jusqu'à POLL_MAX_INTERVAL_MS, ramené à POLL_INTERVAL_MS au premier succès.
let cursor = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let inFlight: Promise<void> | null = null
let failures = 0
let unmounted = false

// Le curseur repart de zéro à chaque changement de canal
watch(channelId, () => {
  cursor = 0
})

function isServerOrNetworkError(error: unknown): boolean {
  const statusCode = (error as { statusCode?: number }).statusCode
  return statusCode === undefined || statusCode >= 500
}

async function pollRound(): Promise<void> {
  const targetChannel = channelId.value
  const since = cursor
  heartbeat()
  const [deltaResult, channelsResult] = await Promise.allSettled([
    $fetch<MessagesDelta>(`/api/channels/${targetChannel}/messages`, { query: { since } }),
    $fetch<ChannelSummary[]>('/api/channels'),
  ])
  if (unmounted) return

  let failed = false
  if (channelsResult.status === 'fulfilled') channels.value = channelsResult.value
  else failed ||= isServerOrNetworkError(channelsResult.reason)

  if (deltaResult.status === 'fulfilled') {
    // Réponse d'un canal quitté entre-temps : ignorée (le curseur a été remis à zéro)
    if (targetChannel === channelId.value) {
      const delta = deltaResult.value
      // since=0 renvoie tous les messages du canal : la liste est remplacée, jamais mêlée à celle du canal précédent
      if (delta.full) messages.value = delta.messages
      else messages.value = mergeMessages(since === 0 ? [] : messages.value ?? [], delta.messages, CHANNEL_MESSAGES_MAX)
      cursor = delta.rev
    }
  }
  else if ((deltaResult.reason as { statusCode?: number }).statusCode === 404) {
    // Canal supprimé (reset complet par l'animateur) : retour au canal d'incident
    if (targetChannel === channelId.value && targetChannel !== FALLBACK_CHANNEL_ID) {
      await navigateTo(`/channels/${FALLBACK_CHANNEL_ID}`)
    }
  }
  else {
    failed ||= isServerOrNetworkError(deltaResult.reason)
  }
  failures = failed ? failures + 1 : 0
}

/** Un seul poll à la fois : un appel pendant un poll en cours renvoie celui-ci. */
function pollOnce(): Promise<void> {
  if (!inFlight) {
    inFlight = pollRound().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

function schedulePoll() {
  clearTimeout(pollTimer)
  pollTimer = undefined
  if (unmounted || document.hidden) return
  const delay = Math.min(POLL_INTERVAL_MS * 2 ** failures, POLL_MAX_INTERVAL_MS)
  pollTimer = setTimeout(pollAndSchedule, delay)
}

async function pollAndSchedule() {
  await pollOnce()
  schedulePoll()
}

function onVisibilityChange() {
  if (document.hidden) {
    clearTimeout(pollTimer)
    pollTimer = undefined
  }
  else {
    pollAndSchedule()
  }
}

onMounted(() => {
  mounted.value = true
  document.addEventListener('keydown', onDocumentKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)
  updateUnread()
  heartbeat()
  schedulePoll()
})

onBeforeUnmount(() => {
  unmounted = true
  clearTimeout(pollTimer)
  document.removeEventListener('keydown', onDocumentKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="teams">
    <header class="top-bar">
      <button
        type="button"
        class="top-bar__menu"
        data-testid="channel-panel-toggle"
        aria-label="Canaux"
        aria-controls="channel-panel"
        :aria-expanded="channelPanelOpen ? 'true' : 'false'"
        @click="channelPanelOpen = !channelPanelOpen"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
      <div class="top-bar__brand">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="3" y="5" width="12" height="14" rx="2" fill="#fff" />
          <path d="M6.5 9h5M9 9v6.5" stroke="#5b5fc7" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="18.5" cy="8" r="2.3" fill="#c5c6f0" />
          <path d="M16 12h5v4a2.5 2.5 0 0 1-5 0v-4Z" fill="#c5c6f0" />
        </svg>
        <span class="top-bar__title">SRE Team Instance</span>
      </div>
      <div class="top-bar__search" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span>Rechercher</span>
      </div>
      <button
        type="button"
        class="top-bar__user"
        data-testid="display-name"
        :title="displayName ? 'Modifier votre nom d\'affichage' : 'Choisir un nom d\'affichage'"
        @click="editingName = true"
      >
        <span v-if="displayName" class="top-bar__name">{{ displayName }}</span>
        <span class="avatar" :style="{ background: displayName ? avatarColor(displayName) : '#8b8cc7' }">{{ displayName ? initials(displayName) : '?' }}</span>
      </button>
    </header>

    <div class="teams__body">
      <AppBar />
      <ChannelList
        id="channel-panel"
        :channels="channels ?? []"
        :current-id="channelId"
        :unread="unread"
        :open="channelPanelOpen"
        @created="onChannelCreated"
        @close="channelPanelOpen = false"
      />
      <div v-if="channelPanelOpen" class="channel-panel-veil" data-testid="channel-panel-veil" @click="channelPanelOpen = false" />

      <main class="channel">
        <header class="channel__header">
          <span class="channel__logo" aria-hidden="true">SRE</span>
          <div class="channel__title">
            <h1 class="channel__name">{{ channel?.name }}</h1>
            <span class="channel__team">Équipe SRE</span>
          </div>
          <nav class="channel__tabs" aria-hidden="true">
            <span class="channel__tab channel__tab--active">Publications</span>
            <span class="channel__tab">Fichiers</span>
            <span class="channel__tab">Wiki</span>
          </nav>
          <div v-if="presence.present.length > 0" class="presence" :aria-label="`${presence.present.length} personne(s) dans le canal`">
            <span
              v-for="name in presenceAvatars"
              :key="name"
              class="avatar presence__avatar"
              data-testid="presence-avatar"
              :title="name"
              :style="{ background: avatarColor(name) }"
            >{{ initials(name) }}</span>
            <span
              v-if="presenceOverflow > 0"
              class="avatar presence__avatar presence__more"
              :title="presence.present.slice(PRESENCE_MAX_AVATARS).join(', ')"
            >+{{ presenceOverflow }}</span>
          </div>
        </header>

        <MessageList :messages="messages ?? []" :me="displayName" :npc-names="npcNames" :reply="reply" :react="react" :set-alert-status="setAlertStatus" @typing="onTyping" />
        <p class="typing-indicator" data-testid="typing-indicator" aria-live="polite">{{ typingText }}</p>
        <Composer :disabled="!displayName" :channel-name="channel?.name ?? ''" :send="send" @typing="onTyping" />
      </main>
    </div>

    <DisplayNameDialog
      v-if="showNameDialog"
      :initial-name="displayName"
      :cancellable="displayName !== ''"
      @save="saveName"
      @cancel="editingName = false"
    />
  </div>
</template>

<style scoped>
.teams {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.top-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 48px;
  padding: 0 12px 0 22px;
  background: var(--teams-purple-dark);
  color: #fff;
  flex: none;
}

.top-bar__menu {
  display: none;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.top-bar__menu:hover {
  background: rgba(255, 255, 255, 0.12);
}

.top-bar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 316px;
  font-weight: 600;
}

.top-bar__search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 560px;
  height: 32px;
  margin: 0 auto;
  padding: 0 12px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.92);
  color: var(--teams-text-muted);
}

.top-bar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  padding: 4px 6px 4px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.top-bar__user:hover {
  background: rgba(255, 255, 255, 0.12);
}

.top-bar__name {
  font-weight: 600;
}

.teams__body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.channel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--teams-bg);
}

.channel__header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid var(--teams-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  flex: none;
  /* Le nom du canal se tronque plutôt que de faire déborder la page */
  overflow: hidden;
}

.channel__logo {
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

.channel__title {
  min-width: 0;
}

.channel__name {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.channel__team {
  font-size: 12px;
  color: var(--teams-text-muted);
}

.channel__tabs {
  display: flex;
  align-self: stretch;
  gap: 20px;
  margin-left: 24px;
}

.channel__tab {
  display: flex;
  align-items: center;
  border-bottom: 3px solid transparent;
  color: var(--teams-text-muted);
}

.channel__tab--active {
  border-bottom-color: var(--teams-purple);
  color: var(--teams-text);
  font-weight: 600;
}

/* Avatars empilés et chevauchés, comme la liste des participants de Teams */
.presence {
  display: flex;
  align-items: center;
  margin-left: auto;
  padding-left: 8px;
}

.presence__avatar {
  width: 28px;
  height: 28px;
  font-size: 11px;
  border: 2px solid #fff;
  box-sizing: content-box;
}

.presence__avatar + .presence__avatar {
  margin-left: -8px;
}

.presence__more {
  background: var(--teams-border);
  color: var(--teams-text);
}

/* Hauteur réservée : l'apparition du libellé ne décale ni le fil ni le champ de saisie */
.typing-indicator {
  flex: none;
  /* Aligné sur le texte du champ de saisie (marge 32 px + retrait interne 14 px) */
  width: 100%;
  max-width: calc(960px + 64px);
  height: 20px;
  margin: 0 auto;
  padding: 0 46px;
  box-sizing: border-box;
  color: var(--teams-text-muted);
  font-size: 12px;
  font-style: italic;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Voile du tiroir des canaux : écran étroit uniquement */
.channel-panel-veil {
  display: none;
}

/* Écran étroit (portable) : menu à la place du panneau des canaux, en-têtes allégés */
@media (max-width: 767px) {
  .top-bar {
    gap: 8px;
    padding: 0 8px;
  }

  .top-bar__menu {
    display: inline-flex;
  }

  .top-bar__brand {
    width: auto;
  }

  .top-bar__title,
  .top-bar__search,
  .top-bar__name {
    display: none;
  }

  .top-bar__user {
    padding: 4px;
  }

  .channel-panel-veil {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 30;
    background: rgba(0, 0, 0, 0.4);
  }

  .channel__header {
    gap: 10px;
    padding: 0 12px;
  }

  .channel__tabs {
    display: none;
  }

  .typing-indicator {
    padding: 0 26px;
  }
}
</style>
