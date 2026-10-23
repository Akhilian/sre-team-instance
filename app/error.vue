<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)

useHead({ title: () => `${props.error.statusCode} | SRE Team Instance` })
</script>

<template>
  <main class="error-page">
    <div class="error-page__card">
      <p class="error-page__code">{{ error.statusCode }}</p>
      <h1>{{ notFound ? 'Canal introuvable' : 'Une erreur est survenue' }}</h1>
      <p>{{ notFound ? 'Ce canal n\'existe pas ou a été supprimé.' : error.statusMessage }}</p>
      <button type="button" @click="clearError({ redirect: '/' })">Retour au canal d'incident</button>
    </div>
  </main>
</template>

<style scoped>
.error-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--teams-bg);
}

.error-page__card {
  padding: 32px 40px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  text-align: center;
}

.error-page__code {
  margin: 0;
  font-size: 48px;
  font-weight: 700;
  color: var(--teams-purple);
}

h1 {
  margin: 8px 0;
  font-size: 20px;
}

p {
  color: var(--teams-text-muted);
}

button {
  margin-top: 8px;
  padding: 6px 18px;
  border: 0;
  border-radius: 4px;
  background: var(--teams-purple);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

button:hover {
  background: var(--teams-purple-dark);
}
</style>
