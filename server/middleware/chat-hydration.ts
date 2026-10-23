// Les routes /api/ attendent la réhydratation du store : jamais de réponse servie avec un store
// vide pendant le chargement. /api/health n'attend pas (le health check Render ne doit pas boucler).
export default defineEventHandler(async (event) => {
  const path = event.path
  if (!path.startsWith('/api/') || path === '/api/health' || path.startsWith('/api/health?')) return
  await whenChatHydrated()
})
