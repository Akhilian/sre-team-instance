// Fiches des PNJ chargées (tous scénarios), avec leur texte source, et leur source (dossier ou embarquées)
export default defineEventHandler((event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  return npcPersonaFiles()
})
