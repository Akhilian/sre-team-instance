// Sans since : tableau complet (rendu initial). Avec ?since=<rev> : MessagesDelta (polling incrémental).
export default defineEventHandler((event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  const rawSince = getQuery(event).since
  let since: number | undefined
  if (rawSince !== undefined) {
    if (typeof rawSince !== 'string' || !/^\d+$/.test(rawSince) || !Number.isSafeInteger(Number(rawSince))) {
      throw createError({ statusCode: 400, message: 'since doit être un entier positif ou nul' })
    }
    since = Number(rawSince)
  }
  if (!hasChannel(channelId)) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }
  return since === undefined ? listMessages(channelId) : listMessagesSince(channelId, since)
})
