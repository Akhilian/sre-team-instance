<script setup lang="ts">
const { data: health, error } = await useFetch('/api/health')
</script>

<template>
  <main>
    <h1>SRE Team Instance</h1>
    <p v-if="health">API : {{ health.status }} ({{ health.timestamp }})</p>
    <p v-else-if="error">API indisponible : {{ error.message }}</p>
  </main>
</template>
