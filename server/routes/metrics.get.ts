// Métriques Prometheus (format texte 0.0.4). METRICS_ENABLED=false → 404. Aucune authentification : la
// sortie ne contient ni secret, ni identifiant de participant, de message ou de canal (labels bornés).
export default defineEventHandler((event) => {
  if (!metricsEnabled()) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  setResponseHeader(event, 'Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return registry.render()
})
