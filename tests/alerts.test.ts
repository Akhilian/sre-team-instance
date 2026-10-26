import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ALERT_AUTHOR,
  ChannelNotFoundError,
  MessageNotFoundError,
  MessageValidationError,
  addAlert,
  addMessage,
  clearMessages,
  listMessages,
  resetChatStore,
  toggleReaction,
} from '../server/utils/chat-store'
import {
  ALERT_SEVERITIES,
  ALERT_SEVERITY_COLORS,
  ALERT_SEVERITY_LABELS,
  isAlertSeverity,
} from '../shared/utils/alerts'

const CHANNEL = 'incident-en-cours'
const VALID = { severity: 'SEV1', title: ' Taux d\'erreur 5xx > 20 % ', service: ' checkout-api ', text: ' Erreurs en hausse ' }

describe('shared/utils/alerts', () => {
  it('définit libellés et couleurs pour chaque sévérité', () => {
    expect(ALERT_SEVERITIES).toEqual(['SEV1', 'SEV2', 'SEV3'])
    for (const severity of ALERT_SEVERITIES) {
      expect(ALERT_SEVERITY_LABELS[severity]).toContain(severity)
      expect(ALERT_SEVERITY_COLORS[severity]).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('reconnaît les sévérités valides seulement', () => {
    expect(isAlertSeverity('SEV2')).toBe(true)
    expect(isAlertSeverity('SEV9')).toBe(false)
    expect(isAlertSeverity(1)).toBe(false)
  })
})

describe('addAlert', () => {
  beforeEach(() => resetChatStore())

  it('crée une alerte racine informative signée Alerting', () => {
    const alert = addAlert(CHANNEL, VALID)
    expect(ALERT_AUTHOR).toBe('Alerting')
    expect(alert).toMatchObject({
      channelId: CHANNEL,
      author: 'Alerting',
      text: 'Erreurs en hausse',
      kind: 'alert',
      alert: { severity: 'SEV1', title: 'Taux d\'erreur 5xx > 20 %', service: 'checkout-api' },
    })
    expect(alert).not.toHaveProperty('parentId')
    expect(alert.alert).not.toHaveProperty('status')
    expect(listMessages(CHANNEL)).toEqual([alert])
  })

  it.each([
    [{ ...VALID, severity: 'SEV9' }],
    [{ ...VALID, severity: undefined }],
    [{ ...VALID, title: '' }],
    [{ ...VALID, title: '   ' }],
    [{ ...VALID, title: 'x'.repeat(121) }],
    [{ ...VALID, service: '' }],
    [{ ...VALID, service: 'x'.repeat(61) }],
    [{ ...VALID, text: '' }],
    [{ ...VALID, text: 'x'.repeat(2001) }],
    [{}],
  ])('refuse une entrée invalide sans rien ajouter (%j)', (input) => {
    expect(() => addAlert(CHANNEL, input)).toThrow(MessageValidationError)
    expect(listMessages(CHANNEL)).toEqual([])
  })

  it('accepte les longueurs maximales', () => {
    const alert = addAlert(CHANNEL, { ...VALID, title: 'x'.repeat(120), service: 'y'.repeat(60), text: 'z'.repeat(2000) })
    expect(alert.alert?.title).toHaveLength(120)
  })

  it('lève ChannelNotFoundError sur un canal inconnu', () => {
    expect(() => addAlert('nope', VALID)).toThrow(ChannelNotFoundError)
  })

  it('renvoie une copie : modifier l\'alerte renvoyée ne touche pas le store', () => {
    const alert = addAlert(CHANNEL, VALID)
    alert.alert!.title = 'modifié'
    expect(listMessages(CHANNEL)[0]!.alert!.title).toBe('Taux d\'erreur 5xx > 20 %')
  })

  it('accepte réponses et réactions, et disparaît avec clearMessages', () => {
    const alert = addAlert(CHANNEL, VALID)
    const reply = addMessage(CHANNEL, { author: 'Bob', text: 'Je regarde', parentId: alert.id })
    expect(reply.parentId).toBe(alert.id)
    const reacted = toggleReaction(CHANNEL, alert.id, { emoji: '👍', author: 'Alice' })
    expect(reacted.reactions).toEqual([{ emoji: '👍', authors: ['Alice'] }])
    expect(reacted.alert).toEqual({ severity: 'SEV1', title: 'Taux d\'erreur 5xx > 20 %', service: 'checkout-api' })
    clearMessages()
    expect(listMessages(CHANNEL)).toEqual([])
  })
})

describe('AlertCard (informative)', () => {
  const source = readFileSync(fileURLToPath(new URL('../app/components/AlertCard.vue', import.meta.url)), 'utf8')
  const template = source.slice(source.indexOf('<template>'), source.indexOf('</template>\n\n<style'))

  it('n\'a ni bouton ni badge de statut, et montre sévérité, titre, service et texte', () => {
    expect(template).not.toMatch(/<button|alert-status|alert-ack|alert-resolve|Acquitt|Résol|status/i)
    for (const part of ['ALERT_SEVERITY_LABELS[alert.severity]', 'alert.title', 'alert.service', '{{ text }}']) {
      expect(template).toContain(part)
    }
  })
})
