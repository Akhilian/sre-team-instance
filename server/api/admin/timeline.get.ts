import type { Message } from '~~/shared/types/chat'
import type { TimelineResponse } from '~~/shared/types/timeline'
import { buildTimeline, timelineToMarkdown } from '~~/shared/utils/timeline'

export default defineEventHandler((event): TimelineResponse | string => {
  // Code vérifié avant toute lecture de la requête
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }

  const query = getQuery(event)
  // format absent = json ; toute autre valeur (y compris répétée) : 400
  const format = query.format === undefined ? 'json' : query.format
  if (format !== 'json' && format !== 'md') {
    throw createError({ statusCode: 400, message: 'format doit valoir json ou md' })
  }

  // channelId absent ou vide = tous les canaux
  const rawChannelId = query.channelId
  if (rawChannelId !== undefined && typeof rawChannelId !== 'string') {
    throw createError({ statusCode: 400, message: 'channelId doit être une chaîne' })
  }
  const channelId = rawChannelId || undefined
  const allChannels = listChannels()
  const channels = channelId === undefined ? allChannels : allChannels.filter(channel => channel.id === channelId)
  if (channels.length === 0 && channelId !== undefined) {
    throw createError({ statusCode: 404, message: 'Canal inconnu' })
  }

  const messagesByChannel: Record<string, Message[]> = {}
  for (const channel of channels) messagesByChannel[channel.id] = listMessages(channel.id)
  const events = buildTimeline(channels, messagesByChannel)

  if (format === 'json') return { events }

  const title = channelId === undefined
    ? 'Chronologie — tous les canaux'
    : `Chronologie — ${channels[0]!.name}`
  setHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setHeader(event, 'content-disposition', `attachment; filename="chronologie-${channelId ?? 'tous'}.md"`)
  return timelineToMarkdown(events, { title, generatedAt: new Date() })
})
