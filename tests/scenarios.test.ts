import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../server/scenarios'
import { listChannels, resetChatStore } from '../server/utils/chat-store'
import { TEXT_MAX_LENGTH } from '../shared/utils/limits'
import { ALERT_SERVICE_MAX_LENGTH, ALERT_TITLE_MAX_LENGTH, isAlertSeverity } from '../shared/utils/alerts'

resetChatStore()
const PRESET_CHANNEL_IDS = listChannels().map(channel => channel.id)

function validText(value: string, maxLength: number): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength
}

describe('scénarios fournis', () => {
  it('contient panne-checkout et demo-express, avec des id uniques', () => {
    const ids = SCENARIOS.map(scenario => scenario.id)
    expect(ids).toEqual(expect.arrayContaining(['panne-checkout', 'demo-express']))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('demo-express publie à 0, 3 et 6 s', () => {
    expect(SCENARIOS.find(scenario => scenario.id === 'demo-express')!.steps.map(step => step.at)).toEqual([0, 3, 6])
  })

  it('panne-checkout commence par une SEV2 de latence sur checkout-api puis passe en SEV1', () => {
    const steps = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps
    expect(steps.length).toBeGreaterThanOrEqual(4)
    expect(steps[0]).toMatchObject({ at: 0, kind: 'alert', severity: 'SEV2', service: 'checkout-api' })
    expect(steps.some(step => step.kind === 'alert' && step.severity === 'SEV1')).toBe(true)
    expect(steps.some(step => step.kind === 'announcement' && /support/i.test(step.text))).toBe(true)
  })

  describe.each(SCENARIOS.map(scenario => [scenario.id, scenario] as const))('%s', (_id, scenario) => {
    it('a un titre, une description et des étapes triées par at croissant', () => {
      expect(scenario.title.trim()).not.toBe('')
      expect(scenario.description.trim()).not.toBe('')
      expect(scenario.steps.length).toBeGreaterThan(0)
      const ats = scenario.steps.map(step => step.at)
      expect(ats.every(at => Number.isFinite(at) && at >= 0)).toBe(true)
      expect(ats).toEqual([...ats].sort((a, b) => a - b))
    })

    it('ne cible que des canaux pré-créés, avec des champs valides', () => {
      for (const step of scenario.steps) {
        expect(PRESET_CHANNEL_IDS).toContain(step.channelId)
        expect(validText(step.text, TEXT_MAX_LENGTH)).toBe(true)
        if (step.kind === 'alert') {
          expect(isAlertSeverity(step.severity)).toBe(true)
          expect(validText(step.title, ALERT_TITLE_MAX_LENGTH)).toBe(true)
          expect(validText(step.service, ALERT_SERVICE_MAX_LENGTH)).toBe(true)
        }
      }
    })
  })
})
