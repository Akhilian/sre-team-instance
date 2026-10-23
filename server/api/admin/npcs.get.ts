// État des PNJ pour /admin : activés ou non, moteur, scénario et liste
export default defineEventHandler((event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  return npcAdminState()
})
