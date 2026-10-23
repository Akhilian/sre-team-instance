// Utilisé par le health check Render (healthCheckPath dans render.yaml)
export default defineEventHandler(() => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}))
