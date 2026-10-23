<script setup lang="ts">
import type { Message } from '~~/shared/types/chat'

const POLL_INTERVAL_MS = 3000

const route = useRoute()
const channelId = computed(() => String(route.params.id))

const { data: channels } = await useFetch('/api/channels')
const channel = computed(() => channels.value?.find(c => c.id === channelId.value))
if (!channel.value) {
  throw createError({ statusCode: 404, statusMessage: 'Canal introuvable', fatal: true })
}

const { data: messages, refresh } = await useFetch<Message[]>(
  () => `/api/channels/${channelId.value}/messages`,
  { default: () => [] },
)

useHead({ title: () => `${channel.value?.name ?? 'Canal'} | SRE Team Instance` })

const { displayName, loaded, setDisplayName } = useDisplayName()
const editingName = ref(false)
const showNameDialog = computed(() => loaded.value && (displayName.value === '' || editingName.value))

function saveName(name: string) {
  setDisplayName(name)
  editingName.value = false
}

async function send(text: string) {
  await $fetch(`/api/channels/${channelId.value}/messages`, {
    method: 'POST',
    body: { author: displayName.value, text },
  })
  await refresh()
}

// Polling court : les messages des autres navigateurs apparaissent en quelques secondes
let pollTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  pollTimer = setInterval(() => {
    // Pas de requête en double si la précédente n'est pas encore revenue
    refresh({ dedupe: 'defer' })
  }, POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  clearInterval(pollTimer)
})
</script>

<template>
  <div class="teams">
    <header class="top-bar">
      <div class="top-bar__brand">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="3" y="5" width="12" height="14" rx="2" fill="#fff" />
          <path d="M6.5 9h5M9 9v6.5" stroke="#5b5fc7" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="18.5" cy="8" r="2.3" fill="#c5c6f0" />
          <path d="M16 12h5v4a2.5 2.5 0 0 1-5 0v-4Z" fill="#c5c6f0" />
        </svg>
        <span>SRE Team Instance</span>
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
      <ChannelList :channels="channels ?? []" :current-id="channelId" />

      <main class="channel">
        <header class="channel__header">
          <span class="channel__logo" aria-hidden="true">SRE</span>
          <div>
            <h1 class="channel__name">{{ channel?.name }}</h1>
            <span class="channel__team">Équipe SRE</span>
          </div>
          <nav class="channel__tabs" aria-hidden="true">
            <span class="channel__tab channel__tab--active">Publications</span>
            <span class="channel__tab">Fichiers</span>
            <span class="channel__tab">Wiki</span>
          </nav>
        </header>

        <MessageList :messages="messages ?? []" :me="displayName" />
        <Composer :disabled="!displayName" :channel-name="channel?.name ?? ''" :send="send" />
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
  min-width: 900px;
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

.channel__name {
  margin: 0;
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
</style>
