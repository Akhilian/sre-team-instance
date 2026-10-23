import { beforeEach, describe, expect, it } from 'vitest'
import {
  ALERT_AUTHOR,
  AlertTransitionError,
  ChannelNotFoundError,
  MessageNotFoundError,
  MessageValidationError,
  addAlert,
  addMessage,
  clearMessages,
  listMessages,
  resetChatStore,
  setAlertStatus,
  toggleReaction,
} from '../server/utils/chat-store'
import {
  ALERT_SEVERITIES,
  ALERT_SEVERITY_COLORS,
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS_LABELS,
  canTransition,
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
    expect(ALERT_STATUS_LABELS).toEqual({ triggered: 'Déclenchée', acknowledged: 'Acquittée', resolved: 'Résolue' })
  })

  it('reconnaît les sévérités valides seulement', () => {
    expect(isAlertSeverity('SEV2')).toBe(true)
    expect(isAlertSeverity('SEV9')).toBe(false)
    expect(isAlertSeverity(1)).toBe(false)
  })

  it('autorise ack depuis triggered et resolve depuis triggered ou acknowledged', () => {
    expect(canTransition('triggered', 'acknowledged')).toBe(true)
    expect(canTransition('triggered', 'resolved')).toBe(true)
    expect(canTransition('acknowledged', 'resolved')).toBe(true)
    expect(canTransition('acknowledged', 'acknowledged')).toBe(false)
    expect(canTransition('resolved', 'acknowledged')).toBe(false)
    expect(canTransition('resolved', 'resolved')).toBe(false)
    expect(canTransition('acknowledged', 'triggered')).toBe(false)
  })
})

describe('addAlert', () => {
  beforeEach(() => resetChatStore())

  it('crée une alerte racine déclenchée signée Alerting', () => {
    const alert = addAlert(CHANNEL, VALID)
    expect(ALERT_AUTHOR).toBe('Alerting')
    expect(alert).toMatchObject({
      channelId: CHANNEL,
      author: 'Alerting',
      text: 'Erreurs en hausse',
      kind: 'alert',
      alert: { severity: 'SEV1', title: 'Taux d\'erreur 5xx > 20 %', service: 'checkout-api', status: 'triggered' },
    })
    expect(alert).not.toHaveProperty('parentId')
    expect(alert.alert).not.toHaveProperty('acknowledgedBy')
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
    alert.alert!.status = 'resolved'
    expect(listMessages(CHANNEL)[0]!.alert!.status).toBe('triggered')
  })

  it('accepte réponses et réactions, et disparaît avec clearMessages', () => {
    const alert = addAlert(CHANNEL, VALID)
    const reply = addMessage(CHANNEL, { author: 'Bob', text: 'Je regarde', parentId: alert.id })
    expect(reply.parentId).toBe(alert.id)
    const reacted = toggleReaction(CHANNEL, alert.id, { emoji: '👍', author: 'Alice' })
    expect(reacted.reactions).toEqual([{ emoji: '👍', authors: ['Alice'] }])
    expect(reacted.alert?.status).toBe('triggered')
    clearMessages()
    expect(listMessages(CHANNEL)).toEqual([])
  })
})

describe('setAlertStatus', () => {
  beforeEach(() => resetChatStore())

  it('acquitte puis résout, en renseignant …By et …At', () => {
    const { id } = addAlert(CHANNEL, VALID)
    const acked = setAlertStatus(CHANNEL, id, { status: 'acknowledged', name: ' Bob ' })
    expect(acked.alert).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'Bob' })
    expect(new Date(acked.alert!.acknowledgedAt!).toISOString()).toBe(acked.alert!.acknowledgedAt)
    expect(acked.alert).not.toHaveProperty('resolvedBy')

    const resolved = setAlertStatus(CHANNEL, id, { status: 'resolved', name: 'Alice' })
    expect(resolved.alert).toMatchObject({ status: 'resolved', acknowledgedBy: 'Bob', resolvedBy: 'Alice' })
    expect(new Date(resolved.alert!.resolvedAt!).toISOString()).toBe(resolved.alert!.resolvedAt)
    expect(listMessages(CHANNEL)).toEqual([resolved])
  })

  it('résout directement une alerte déclenchée', () => {
    const { id } = addAlert(CHANNEL, VALID)
    const resolved = setAlertStatus(CHANNEL, id, { status: 'resolved', name: 'Alice' })
    expect(resolved.alert).toMatchObject({ status: 'resolved', resolvedBy: 'Alice' })
    expect(resolved.alert).not.toHaveProperty('acknowledgedBy')
    expect(resolved.alert!.resolvedAt).toBeTruthy()
  })

  it('refuse d\'acquitter une alerte déjà acquittée', () => {
    const { id } = addAlert(CHANNEL, VALID)
    setAlertStatus(CHANNEL, id, { status: 'acknowledged', name: 'Bob' })
    expect(() => setAlertStatus(CHANNEL, id, { status: 'acknowledged', name: 'Carol' })).toThrow(AlertTransitionError)
    expect(listMessages(CHANNEL)[0]!.alert!.acknowledgedBy).toBe('Bob')
  })

  it('refuse d\'acquitter ou de résoudre une alerte résolue', () => {
    const { id } = addAlert(CHANNEL, VALID)
    setAlertStatus(CHANNEL, id, { status: 'resolved', name: 'Alice' })
    expect(() => setAlertStatus(CHANNEL, id, { status: 'acknowledged', name: 'Bob' })).toThrow(AlertTransitionError)
    expect(() => setAlertStatus(CHANNEL, id, { status: 'resolved', name: 'Bob' })).toThrow(AlertTransitionError)
    expect(listMessages(CHANNEL)[0]!.alert!.resolvedBy).toBe('Alice')
  })

  it('refuse un changement de statut sur un message ordinaire, par une erreur distincte', () => {
    const { id } = addMessage(CHANNEL, { author: 'Alice', text: 'Bonjour' })
    let caught: unknown
    try {
      setAlertStatus(CHANNEL, id, { status: 'acknowledged', name: 'Bob' })
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MessageValidationError)
    expect(caught).not.toBeInstanceOf(AlertTransitionError)
    expect(listMessages(CHANNEL)[0]).not.toHaveProperty('alert')
  })

  it.each([
    [{ status: 'triggered', name: 'Bob' }],
    [{ status: 'closed', name: 'Bob' }],
    [{ name: 'Bob' }],
    [{ status: 'acknowledged', name: '' }],
    [{ status: 'acknowledged', name: '   ' }],
    [{ status: 'acknowledged' }],
    [{ status: 'acknowledged', name: 'x'.repeat(51) }],
  ])('refuse un statut ou un nom invalide (%j)', (input) => {
    const { id } = addAlert(CHANNEL, VALID)
    expect(() => setAlertStatus(CHANNEL, id, input)).toThrow(MessageValidationError)
    expect(listMessages(CHANNEL)[0]!.alert!.status).toBe('triggered')
  })

  it('lève ChannelNotFoundError et MessageNotFoundError', () => {
    const { id } = addAlert(CHANNEL, VALID)
    expect(() => setAlertStatus('nope', id, { status: 'resolved', name: 'A' })).toThrow(ChannelNotFoundError)
    expect(() => setAlertStatus(CHANNEL, 'inconnu', { status: 'resolved', name: 'A' })).toThrow(MessageNotFoundError)
  })
})
