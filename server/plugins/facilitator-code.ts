// Résout le code animateur au démarrage : un code généré (production sans FACILITATOR_CODE) est
// journalisé une seule fois, ici, et non à la première requête admin.
export default defineNitroPlugin(() => {
  initFacilitatorCode(processEnv(), { dev: import.meta.dev })
})
