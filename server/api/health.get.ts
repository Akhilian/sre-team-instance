// Utilisé par le health check Render (healthCheckPath dans render.yaml).
// storage : driver de persistance configuré, pas l'état de la connexion (répond même si Redis est injoignable)
// facilitatorCode : provenance du code animateur (env, generated, default), jamais le code lui-même
export default defineEventHandler(() => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  storage: configuredStorageDriver(),
  facilitatorCode: facilitatorCodeSource(),
}))
