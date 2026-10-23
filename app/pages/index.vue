<script setup lang="ts">
// Accueil : redirige vers le canal d'incident (premier canal dont l'id commence par « incident- »)
const { data: channels } = await useFetch('/api/channels')
const target = channels.value?.find(channel => channel.id.startsWith('incident-')) ?? channels.value?.[0]

if (!target) {
  throw createError({ statusCode: 503, statusMessage: 'Aucun canal disponible', fatal: true })
}
await navigateTo(`/channels/${target.id}`, { redirectCode: 302, replace: true })
</script>

<template>
  <div />
</template>
