// Métriques HTTP (041) : durée et statut de chaque requête, étiquetés par le motif de route apparié par
// Nitro (event.context.matchedRoute.path, ex. /api/channels/:id/messages), jamais par l'URL brute.
// /metrics et /api/health n'y figurent pas. Les compteurs vivent dans server/utils/paging-metrics.ts.
/** Motif du routeur h3 : `path` (h3 1.x, Nitro 2) ; `route` par tolérance pour une version ultérieure */
function routePatternOf(matched: unknown): string | undefined {
  const { path, route } = (matched ?? {}) as { path?: unknown, route?: unknown }
  const pattern = typeof path === 'string' ? path : route
  return typeof pattern === 'string' ? pattern : undefined
}

export default defineNitroPlugin((nitroApp) => {
  // « finish » de la réponse Node plutôt que le hook afterResponse de Nitro, qui n'est pas appelé quand
  // la route lève une erreur (404, 400, 429…) : ces réponses doivent compter aussi.
  nitroApp.hooks.hook('request', (event) => {
    const startedAt = performance.now()
    event.node.res.once('finish', () => {
      if (!isHttpTracked(event.path)) return
      recordHttp({
        method: event.method,
        routePattern: routePatternOf(event.context.matchedRoute),
        status: event.node.res.statusCode,
        seconds: (performance.now() - startedAt) / 1000,
      })
    })
  })
})
