import { describe, expect, it } from 'vitest'
import { npcScenarioIdFor, npcScenarioIdOf, SCENARIOS } from '../server/scenarios'
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
  it('contient panne-checkout, fuite-donnees, demo-express et rollback-inutile, avec des id uniques', () => {
    const ids = SCENARIOS.map(scenario => scenario.id)
    expect(ids).toEqual(['panne-checkout', 'fuite-donnees', 'demo-express', 'rollback-inutile'])
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
  })

  it('023 CA3 : une seule annonce, celle de l\'animateur à t=840 ; CTO et grands comptes portés par des PNJ', () => {
    const steps = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps
    const announcements = steps.filter(step => step.kind === 'announcement')
    expect(announcements).toHaveLength(1)
    expect(announcements[0]!.at).toBe(840)
    expect(announcements[0]!.text.startsWith('[Animateur]')).toBe(true)

    const at = (time: number) => steps.find(step => step.at === time)!
    expect(at(550)).toMatchObject({ kind: 'npc-message', npcId: 'ceo' })
    expect(at(690)).toMatchObject({ kind: 'npc-message', npcId: 'support-n1' })
    for (const time of [550, 690]) {
      expect(at(time).text).not.toContain('[CTO]')
      expect(at(time).text).not.toContain('[Service client')
    }
    expect(at(690).text).toContain('Maison Verdier')
    expect(at(690).text).toContain('15h')
  })

  it('023 CA3 : la fiche support-n1 connaît l\'échéance de 15h, sans montant ni clause du contrat', () => {
    const sarah = loadPersonas().find(persona => persona.id === 'support-n1')!
    const content = JSON.stringify(sarah)
    expect(content).toContain('15h')
    expect(content).not.toContain('40 000')
    expect(content).not.toContain('99,9')
  })

  it('021 CA1 : aucune étape ne livre la version, le changelog, les paramètres ni le rollback', () => {
    const forbidden = ['v2.41.0', 'v2.40.3', '10 connexions', 'rollback']
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        const content = JSON.stringify(step).toLowerCase()
        // rollback-inutile parle de rollback dans ses messages conditionnels (spec 056) : sa cause n'est pas une version
        for (const word of forbidden.filter(word => word !== 'rollback' || scenario.id !== 'rollback-inutile')) expect(content, `${scenario.id} à ${step.at} s`).not.toContain(word)
      }
    }
    // L'indice de t=620 reste neutre : il renvoie vers l'équipe Release
    const hint = SCENARIOS.find(scenario => scenario.id === 'panne-checkout')!.steps.find(step => step.at === 620)!
    expect(hint.kind).toBe('alert')
    expect(hint.text).toMatch(/déploiement de checkout-api/)
    expect(hint.text).toMatch(/équipe Release/)
  })

  it('027 CA2 : fuite-donnees, 12 à 14 étapes, ouverte par le SOC, une seule annonce [Animateur] à t=840', () => {
    const scenario = SCENARIOS.find(candidate => candidate.id === 'fuite-donnees')!
    expect(scenario.title).toBe('Fuite de données clients')
    const steps = scenario.steps
    expect(steps.length).toBeGreaterThanOrEqual(12)
    expect(steps.length).toBeLessThanOrEqual(14)
    expect(steps[0]).toMatchObject({ at: 0, kind: 'npc-message', npcId: 'soc', channelId: 'incident-en-cours' })
    expect(steps.at(-1)!.at).toBe(840)
    const announcements = steps.filter(step => step.kind === 'announcement')
    expect(announcements).toHaveLength(1)
    expect(announcements[0]!.at).toBe(840)
    expect(announcements[0]!.text.startsWith('[Animateur]')).toBe(true)
    expect(new Set(steps.map(step => step.channelId))).toEqual(new Set(['incident-en-cours', 'general']))
  })

  it('027 CA2 : aucune étape de fuite-donnees ne livre un fait-clé', () => {
    const forbidden = ['18h05', '#482', '48 210', 'Routilo', '23h14', '9h31']
    for (const step of SCENARIOS.find(scenario => scenario.id === 'fuite-donnees')!.steps) {
      const content = JSON.stringify(step)
      for (const word of forbidden) expect(content, `fuite-donnees à ${step.at} s`).not.toContain(word)
    }
  })

  it('027 : scénario de PNJ de chaque scénario ; demo-express emprunte ceux de panne-checkout', () => {
    expect(SCENARIOS.map(scenario => [scenario.id, npcScenarioIdOf(scenario)])).toEqual([
      ['panne-checkout', 'panne-checkout'],
      ['fuite-donnees', 'fuite-donnees'],
      ['demo-express', 'panne-checkout'],
      ['rollback-inutile', 'rollback-inutile'],
    ])
    expect(npcScenarioIdFor('demo-express')).toBe('panne-checkout')
    expect(npcScenarioIdFor('inconnu')).toBe('inconnu')
  })

  it('027 : tout npcId d\'une étape npc-message appartient au scénario de PNJ du scénario', () => {
    const all = [...loadPersonas('panne-checkout'), ...loadPersonas('fuite-donnees'), ...loadPersonas('rollback-inutile')]
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        if (step.kind !== 'npc-message') continue
        const persona = all.find(candidate => candidate.id === step.npcId)
        expect(persona?.scenarioId, `${scenario.id} à ${step.at} s : ${step.npcId}`).toBe(npcScenarioIdOf(scenario))
      }
    }
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

    it('021 CA1, 027 CA2 : chaque npcId correspond à une fiche de son scénario, texte publiable sans troncature', () => {
      const ids = loadPersonas(npcScenarioIdOf(scenario)).map(persona => persona.id)
      const npcSteps = scenario.steps.filter((step): step is Extract<ScenarioStep, { kind: 'npc-message' }> => step.kind === 'npc-message')
      expect(npcSteps.length).toBeGreaterThan(0)
      for (const step of npcSteps) {
        expect(ids).toContain(step.npcId)
        expect(step.text.trim().length).toBeLessThanOrEqual(NPC_REPLY_MAX_LENGTH)
      }
    })

    it('ne cible que des canaux pré-créés, avec des champs valides', () => {
      for (const step of scenario.steps) {
        if (step.kind === 'fault') continue
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
