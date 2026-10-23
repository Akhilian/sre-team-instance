import { describe, expect, it } from 'vitest'
import type { Channel, Message } from '../shared/types/chat'
import type { TimelineEvent } from '../shared/types/timeline'
import { buildTimeline, timelineToMarkdown } from '../shared/utils/timeline'

const INCIDENT: Channel = { id: 'incident-en-cours', name: 'Incident en cours' }
const GENERAL: Channel = { id: 'general', name: 'Général' }

function message(overrides: Partial<Message> & Pick<Message, 'id' | 'channelId' | 'createdAt'>): Message {
  return { author: 'Alice', text: 'texte', ...overrides }
}

function event(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    at: '2026-10-23T08:00:00.000Z',
    channelId: INCIDENT.id,
    channelName: INCIDENT.name,
    author: 'Alice',
    type: 'message',
    text: 'texte',
    ...overrides,
  }
}

describe('buildTimeline', () => {
  it('fusionne les messages de deux canaux, triés par date croissante', () => {
    const events = buildTimeline([INCIDENT, GENERAL], {
      [INCIDENT.id]: [
        message({ id: 'i1', channelId: INCIDENT.id, createdAt: '2026-10-23T08:00:00.000Z', text: 'un' }),
        message({ id: 'i2', channelId: INCIDENT.id, createdAt: '2026-10-23T08:02:00.000Z', text: 'trois' }),
      ],
      [GENERAL.id]: [
        message({ id: 'g1', channelId: GENERAL.id, createdAt: '2026-10-23T08:01:00.000Z', text: 'deux', author: 'Dan' }),
      ],
    })
    expect(events.map(e => e.text)).toEqual(['un', 'deux', 'trois'])
    expect(events[1]).toEqual({
      at: '2026-10-23T08:01:00.000Z',
      channelId: 'general',
      channelName: 'Général',
      author: 'Dan',
      type: 'message',
      text: 'deux',
    })
  })

  it('garde l\'ordre d\'origine à date égale', () => {
    const at = '2026-10-23T08:00:00.000Z'
    const events = buildTimeline([INCIDENT, GENERAL], {
      [INCIDENT.id]: [message({ id: 'a', channelId: INCIDENT.id, createdAt: at, text: 'a' })],
      [GENERAL.id]: [message({ id: 'b', channelId: GENERAL.id, createdAt: at, text: 'b' })],
    })
    expect(events.map(e => e.text)).toEqual(['a', 'b'])
  })

  it('type reply avec parentId pour une réponse, announcement pour une annonce', () => {
    const events = buildTimeline([INCIDENT], {
      [INCIDENT.id]: [
        message({ id: 'root', channelId: INCIDENT.id, createdAt: '2026-10-23T08:00:00.000Z' }),
        message({ id: 'rep', channelId: INCIDENT.id, createdAt: '2026-10-23T08:01:00.000Z', parentId: 'root', author: 'Bob' }),
        message({ id: 'ann', channelId: INCIDENT.id, createdAt: '2026-10-23T08:02:00.000Z', author: 'Animateur', kind: 'announcement', text: 'Point dans 10 min' }),
      ],
    })
    expect(events.map(e => e.type)).toEqual(['message', 'reply', 'announcement'])
    expect(events[0]).not.toHaveProperty('parentId')
    expect(events[1]).toMatchObject({ type: 'reply', parentId: 'root', author: 'Bob' })
    expect(events[2]).toMatchObject({ type: 'announcement', author: 'Animateur', text: 'Point dans 10 min' })
  })

  it('une alerte acquittée puis résolue par deux personnes produit 3 événements dans l\'ordre', () => {
    const events = buildTimeline([INCIDENT], {
      [INCIDENT.id]: [
        message({
          id: 'al',
          channelId: INCIDENT.id,
          createdAt: '2026-10-23T08:00:00.000Z',
          author: 'Alerting',
          kind: 'alert',
          text: 'Taux 5xx > 20 %',
          alert: {
            severity: 'SEV1',
            title: '5xx checkout',
            service: 'checkout-api',
            status: 'resolved',
            acknowledgedBy: 'Alice',
            acknowledgedAt: '2026-10-23T08:03:00.000Z',
            resolvedBy: 'Chloé',
            resolvedAt: '2026-10-23T08:10:00.000Z',
          },
        }),
        message({ id: 'm', channelId: INCIDENT.id, createdAt: '2026-10-23T08:05:00.000Z', text: 'rollback lancé' }),
      ],
    })
    expect(events.map(e => [e.type, e.author, e.at])).toEqual([
      ['alert', 'Alerting', '2026-10-23T08:00:00.000Z'],
      ['alert-acknowledged', 'Alice', '2026-10-23T08:03:00.000Z'],
      ['message', 'Alice', '2026-10-23T08:05:00.000Z'],
      ['alert-resolved', 'Chloé', '2026-10-23T08:10:00.000Z'],
    ])
    expect(events[0]!.text).toBe('[SEV1] 5xx checkout — checkout-api : Taux 5xx > 20 %')
    expect(events[1]!.text).toContain('5xx checkout')
    expect(events[3]!.text).toContain('5xx checkout')
  })

  it('une alerte seulement déclenchée ne produit qu\'un événement', () => {
    const events = buildTimeline([INCIDENT], {
      [INCIDENT.id]: [message({
        id: 'al',
        channelId: INCIDENT.id,
        createdAt: '2026-10-23T08:00:00.000Z',
        author: 'Alerting',
        kind: 'alert',
        text: 'Latence p99 > 2 s',
        alert: { severity: 'SEV2', title: 'Latence', service: 'orders-db', status: 'triggered' },
      })],
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'alert', author: 'Alerting', text: '[SEV2] Latence — orders-db : Latence p99 > 2 s' })
  })

  it('canal sans entrée dans messagesByChannel : aucun événement', () => {
    expect(buildTimeline([INCIDENT], {})).toEqual([])
  })
})

describe('timelineToMarkdown', () => {
  const generatedAt = '2026-10-23T09:00:00Z'

  it('titre, ligne « Générée le », en-tête du tableau et heure dans le fuseau demandé', () => {
    const md = timelineToMarkdown([event({ at: '2026-10-23T08:05:09Z' })], { title: 'Chronologie', generatedAt })
    const lines = md.split('\n')
    expect(lines[0]).toBe('# Chronologie')
    expect(md).toContain('Générée le 23/10/2026 11:00:00')
    expect(md).toContain('| Heure | Canal | Auteur | Type | Texte |')
    expect(md).toContain('| 10:05:09 | Incident en cours | Alice | Message | texte |')
  })

  it('respecte un autre fuseau', () => {
    const md = timelineToMarkdown([event({ at: '2026-10-23T08:05:09Z' })], { title: 'T', generatedAt, timeZone: 'UTC' })
    expect(md).toContain('| 08:05:09 |')
  })

  it('libellés de type en français', () => {
    const types = ['message', 'reply', 'announcement', 'alert', 'alert-acknowledged', 'alert-resolved'] as const
    const md = timelineToMarkdown(types.map(type => event({ type })), { title: 'T', generatedAt })
    for (const label of ['Message', 'Réponse', 'Annonce', 'Alerte', 'Acquittement', 'Résolution']) {
      expect(md).toContain(`| ${label} |`)
    }
  })

  it('échappe | et les retours à la ligne : une seule ligne de tableau', () => {
    const md = timelineToMarkdown([event({ text: 'Je regarde | les logs\npuis\r\nla base' })], { title: 'T', generatedAt })
    const rows = md.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Heure') && !line.startsWith('| ---'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('Je regarde \\| les logs puis la base')
  })

  it('chronologie vide : « _Aucun événement._ » à la place du tableau', () => {
    const md = timelineToMarkdown([], { title: 'T', generatedAt })
    expect(md).toContain('_Aucun événement._')
    expect(md).not.toContain('| Heure |')
  })
})
