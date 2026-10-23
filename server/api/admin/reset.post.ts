// Corps optionnel { scope: "messages" | "all" } (défaut messages) : "all" ramène aussi les canaux à
// ceux par défaut, vide la présence, coupe les PNJ et les ramène au scénario du démarrage. Le scénario en cours est arrêté et les réponses de
// PNJ en attente sont annulées dans les deux cas.
const RESET_SCOPES = ['messages', 'all'] as const
type ResetScope = typeof RESET_SCOPES[number]

function isResetScope(value: unknown): value is ResetScope {
  return RESET_SCOPES.includes(value as ResetScope)
}

export default defineEventHandler(async (event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  // Corps vide toléré (readBody renvoie undefined)
  const body = await readBody<unknown>(event)
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    throw createError({ statusCode: 400, message: 'Le corps doit être un objet { scope }' })
  }
  const rawScope = (body as { scope?: unknown } | null | undefined)?.scope ?? 'messages'
  if (!isResetScope(rawScope)) {
    throw createError({ statusCode: 400, message: 'scope doit valoir messages ou all' })
  }

  // Arrête d'abord le scénario en cours (sans erreur si aucun) : rien n'est publié après l'effacement
  stopScenario()
  if (rawScope === 'all') {
    resetAll()
    resetPresenceStore()
    // PNJ coupés (réponses en attente annulées) et revenus à ceux de panne-checkout : l'animateur les
    // réactive en relançant un scénario
    await resetNpcs()
  }
  else {
    // Réponses en attente annulées d'abord : elles visaient des fils qui vont disparaître
    await cancelPendingNpcReplies()
    clearMessages()
  }
  return { cleared: true, scope: rawScope }
})
