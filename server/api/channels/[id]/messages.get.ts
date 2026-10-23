export default defineEventHandler((event) => {
  const channelId = getRouterParam(event, 'id') ?? ''
  if (!hasChannel(channelId)) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }
  return listMessages(channelId)
})
