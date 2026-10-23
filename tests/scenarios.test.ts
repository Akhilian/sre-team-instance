import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../server/scenarios'
import { listChannels, resetChatStore } from '../server/utils/chat-store'
import { NPC_REPLY_MAX_LENGTH, TEXT_MAX_LENGTH } from '../shared/utils/limits'
import { ALERT_SERVICE_MAX_LENGTH, ALERT_TITLE_MAX_LENGTH, isAlertSeverity } from '../shared/utils/alerts'
import type { ScenarioStep } from '../shared/types/scenario'
import { loadPersonas } from './npc-helpers'

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

  it('021 CA1 : demo-express publie à 0, 3 et 6 s, en commençant par Sarah (support-n1)', () => {
    const steps = SCENARIOS.find(scenario => scenario.id === 'demo-express')!.steps
    expect(steps.map(step => step.at)).toEqual([0, 3, 6])
    expect(steps[0]).toMatchObject({ at: 0, kind: 'npc-message', npcId: 'support-n1', channelId: 'incident-en-cours' })
    expect(steps.slice(1).every(step => step.kind === 'alert')).toBe(true)
  })

  it('021 CA1 : panne-checkout s\'ouvre sur Sarah (support-n1), puis une SEV2 de latence et une SEV1', () => {
    const steps = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps
    expect(steps.length).toBeGreaterThanOrEqual(4)
    expect(steps[0]).toMatchObject({ at: 0, kind: 'npc-message', npcId: 'support-n1', channelId: 'incident-en-cours' })
    const firstAlert = steps.find(step => step.kind === 'alert')!
    expect(firstAlert).toMatchObject({ severity: 'SEV2', service: 'checkout-api' })
    expect(firstAlert.at).toBeGreaterThanOrEqual(20)
    expect(steps.some(step => step.kind === 'alert' && step.severity === 'SEV1')).toBe(true)
  })

  it('021 CA1 : CEO, CFO et Communication parlent en PNJ ; plus d\'annonce Support, Direction, Community ni Finance', () => {
    const steps = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps
    const npcIds = steps.flatMap(step => step.kind === 'npc-message' ? [step.npcId] : [])
    expect(npcIds).toEqual(expect.arrayContaining(['support-n1', 'ceo', 'cfo', 'communication']))
    for (const step of steps) {
      if (step.kind !== 'announcement') continue
      expect(step.text).not.toMatch(/^\[(Support|Direction|Community|Finance)/)
    }
    // Les autres annonces restent des annonces
    const announcements = steps.flatMap(step => step.kind === 'announcement' ? [step.text] : [])
    for (const prefix of ['[CTO]', '[Service client grands comptes]', '[Animateur]']) {
      expect(announcements.some(text => text.startsWith(prefix))).toBe(true)
    }
  })

  it('021 CA1 : aucune étape ne livre la version, le changelog, les paramètres ni le rollback', () => {
    const forbidden = ['v2.41.0', 'v2.40.3', '10 connexions', 'rollback']
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        const content = JSON.stringify(step).toLowerCase()
        for (const word of forbidden) expect(content, `${scenario.id} à ${step.at} s`).not.toContain(word)
      }
    }
    // L'indice de t=620 reste neutre : il renvoie vers l'équipe Release
    const hint = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps.find(step => step.at === 620)!
    expect(hint.kind).toBe('alert')
    expect(hint.text).toMatch(/déploiement de checkout-api/)
    expect(hint.text).toMatch(/équipe Release/)
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

    it('021 CA1 : chaque npcId correspond à une fiche existante, texte publiable sans troncature', () => {
      const ids = loadPersonas().map(persona => persona.id)
      const npcSteps = scenario.steps.filter((step): step is Extract<ScenarioStep, { kind: 'npc-message' }> => step.kind === 'npc-message')
      expect(npcSteps.length).toBeGreaterThan(0)
      for (const step of npcSteps) {
        expect(ids).toContain(step.npcId)
        expect(step.text.trim().length).toBeLessThanOrEqual(NPC_REPLY_MAX_LENGTH)
      }
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
