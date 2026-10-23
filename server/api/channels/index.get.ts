// Canaux d'équipe ; avec ?participant=<nom>, suivis des conversations directes de ce participant
// (comparé par slug). Pas d'auth réelle : « privé » signifie seulement « non listé pour les autres ».
export default defineEventHandler((event) => {
  const participant = getQuery(event).participant
  return listChannelSummaries(typeof participant === 'string' && participant.trim() !== '' ? participant : undefined)
})
