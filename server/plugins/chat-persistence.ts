// Branche la persistance du chat : réhydratation au démarrage, sauvegarde différée après chaque
// mutation, sauvegarde forcée à l'arrêt (hook close de Nitro, appelé sur SIGTERM / SIGINT).
export default defineNitroPlugin((nitroApp) => {
  const config = resolveStorageConfig(processEnv())
  const ready = (async () => {
    const storage = await createChatStorage(config)
    const persistence = createChatPersistence(storage)
    await persistence.hydrate()
    // Abonnement après la réhydratation : importSnapshot ne notifie pas, rien n'est réécrit au démarrage
    onChatChange(persistence.scheduleSave)
    return { storage, persistence }
  })().catch((error) => {
    console.warn('[chat-persistence] stockage indisponible, conversations en mémoire seulement', error)
    return null
  })
  setChatHydration(ready)

  nitroApp.hooks.hook('close', async () => {
    const started = await ready
    if (!started) return
    started.persistence.stop()
    // Sans lecture réussie, flush n'écrit rien : on n'écrase pas un instantané qu'on n'a pas pu lire
    await started.persistence.flush()
    // Ferme la connexion Redis (sans effet pour memory / fs) pour laisser le processus s'arrêter
    await started.storage.dispose().catch(() => {})
  })
})
