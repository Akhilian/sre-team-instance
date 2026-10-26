// Chronologie de l'incident pour le post-mortem : fusion des messages des canaux en événements datés,
// puis export en tableau Markdown. Module pur (sans import serveur), testable directement avec Vitest.
import type { Channel, Message } from '../types/chat'
import type { TimelineEvent, TimelineEventType } from '../types/timeline'

export const TIMELINE_TYPE_LABELS: Record<TimelineEventType, string> = {
  'message': 'Message',
  'reply': 'Réponse',
  'announcement': 'Annonce',
  'alert': 'Alerte',
}

/** Auteur des événements de création d'alerte, comme le connecteur des cartes */
const ALERT_EVENT_AUTHOR = 'Alerting'

function messageEvents(channel: Channel, message: Message): TimelineEvent[] {
  const base = { channelId: channel.id, channelName: channel.name }
  if (message.kind === 'alert' && message.alert) {
    const { alert } = message
    const label = `[${alert.severity}] ${alert.title}`
    return [{
      ...base,
      at: message.createdAt,
      author: ALERT_EVENT_AUTHOR,
      type: 'alert',
      text: `${label} — ${alert.service} : ${message.text}`,
    }]
  }
  if (message.kind === 'announcement') {
    return [{ ...base, at: message.createdAt, author: message.author, type: 'announcement', text: message.text }]
  }
  if (message.parentId !== undefined) {
    return [{ ...base, at: message.createdAt, author: message.author, type: 'reply', text: message.text, parentId: message.parentId }]
  }
  return [{ ...base, at: message.createdAt, author: message.author, type: 'message', text: message.text }]
}

/**
 * Événements de tous les canaux donnés, triés par date croissante ; à égalité, ordre d'origine
 * (canaux dans l'ordre donné, messages dans l'ordre du canal, création de l'alerte).
 * Un canal absent de messagesByChannel est traité comme vide.
 */
export function buildTimeline(
  channels: readonly Channel[],
  messagesByChannel: Readonly<Record<string, readonly Message[]>>,
): TimelineEvent[] {
  const events = channels.flatMap(channel =>
    (messagesByChannel[channel.id] ?? []).flatMap(message => messageEvents(channel, message)))
  // Array.prototype.sort est stable : l'ordre d'origine est conservé à date égale
  return events
    .map((event, index) => ({ event, time: Date.parse(event.at), index }))
    .sort((a, b) => (a.time - b.time) || (a.index - b.index))
    .map(({ event }) => event)
}

export interface TimelineMarkdownOptions {
  title: string
  /** Fuseau IANA des heures affichées ; Europe/Paris par défaut */
  timeZone?: string
  generatedAt: Date | string
}

/** Échappe une cellule : `|` → `\|`, retours à la ligne → espace, pour ne pas casser le tableau. */
export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ')
}

export function timelineToMarkdown(events: readonly TimelineEvent[], options: TimelineMarkdownOptions): string {
  const timeZone = options.timeZone ?? 'Europe/Paris'
  // hourCycle h23 plutôt que hour12: false, qui peut afficher « 24 » à minuit selon les moteurs
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const dateTime = new Intl.DateTimeFormat('fr-FR', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const lines = [
    `# ${options.title}`,
    '',
    `Générée le ${dateTime.format(new Date(options.generatedAt))} (${timeZone})`,
    '',
  ]
  if (events.length === 0) {
    lines.push('_Aucun événement._')
  }
  else {
    lines.push('| Heure | Canal | Auteur | Type | Texte |', '| --- | --- | --- | --- | --- |')
    for (const event of events) {
      const cells = [
        time.format(new Date(event.at)),
        event.channelName,
        event.author,
        TIMELINE_TYPE_LABELS[event.type],
        event.text,
      ].map(escapeMarkdownCell)
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  return `${lines.join('\n')}\n`
}
