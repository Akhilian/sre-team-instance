// 038 CA1 : contenu d'onboarding sans fuite du scénario, et structure des étapes et des fiches de rôle
import { describe, expect, it } from 'vitest'
import { ONBOARDING_STEPS, type OnboardingStep } from '../shared/onboarding/steps'
import { DEFAULT_ROLE_ID, ROLES, type RoleSheet } from '../shared/onboarding/roles'
import { SCENARIOS } from '../server/scenarios'
import { DEFAULT_CHANNEL_IDS } from '../server/utils/chat-store'
import { loadPersonas } from './npc-helpers'

const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function onboardingText(steps: readonly OnboardingStep[], roles: readonly RoleSheet[]): string {
  const stepText = steps.flatMap(step => [step.title, ...step.paragraphs, ...step.lists.flatMap(list => [list.title ?? '', ...list.items])])
  const roleText = roles.flatMap(role => [role.label, role.badge, role.mission, ...role.reflexes, role.whoToTalkTo])
  return fold([...stepText, ...roleText].join('\n'))
}

const personaNames = ['panne-checkout', 'fuite-donnees'].flatMap(scenario => loadPersonas(scenario).map(persona => persona.name))
const KEYWORDS = ['checkout', 'paiement', 'v2.41', 'rollback', 'pool', 'Paiemio', 'Routilo', '#482', 'fuite', 'données personnelles']
// Canaux pré-créés autorisés dans le texte ; tout autre canal par défaut (ajouté un jour) serait une fuite
const ALLOWED_CHANNEL_IDS = ['general', 'incident-en-cours']

/** Termes interdits trouvés dans le texte (mots entiers pour les noms, sous-chaînes pour les mots-clés) */
export function leaks(text: string): string[] {
  const found: string[] = []
  const whole = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${fold(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)
  if (whole('PNJ')) found.push('PNJ')
  for (const name of personaNames) {
    for (const part of [name, ...name.split(' ')]) if (whole(part)) found.push(part)
  }
  for (const scenario of SCENARIOS) if (text.includes(fold(scenario.title))) found.push(scenario.title)
  for (const id of DEFAULT_CHANNEL_IDS) {
    if (!ALLOWED_CHANNEL_IDS.includes(id) && text.includes(fold(id.replace(/-/g, ' ')))) found.push(id)
  }
  for (const keyword of KEYWORDS) if (text.includes(fold(keyword))) found.push(keyword)
  for (const number of text.match(/\d{2,}/g) ?? []) found.push(number)
  return found
}

describe('contenu d\'onboarding', () => {
  it('ne dévoile rien du scénario', () => {
    expect(leaks(onboardingText(ONBOARDING_STEPS, ROLES))).toEqual([])
  })

  it('détecte une fuite (Paiemio ajouté à une étape)', () => {
    const leaky = ONBOARDING_STEPS.map((step, index) => index === 0 ? { ...step, paragraphs: [...step.paragraphs, 'Paiemio est en panne.'] } : step)
    expect(leaks(onboardingText(leaky, ROLES))).toContain('Paiemio')
  })

  it('a 5 étapes dans l\'ordre prévu', () => {
    expect(ONBOARDING_STEPS.map(step => step.id)).toEqual(['contexte', 'outil', 'limites', 'deroule', 'role'])
    for (const step of ONBOARDING_STEPS) {
      expect(step.title).not.toBe('')
      expect(step.paragraphs.length + step.lists.length).toBeGreaterThan(0)
    }
  })

  it('a 5 rôles complets, equipier par défaut', () => {
    expect(ROLES.map(role => role.id)).toEqual(['incident-commander', 'investigation', 'communication', 'scribe', 'equipier'])
    for (const role of ROLES) {
      expect(role.label).not.toBe('')
      expect(role.badge).not.toBe('')
      expect(role.mission.trim()).not.toBe('')
      expect(role.reflexes.length).toBeGreaterThanOrEqual(3)
      expect(role.reflexes.length).toBeLessThanOrEqual(4)
      expect(role.whoToTalkTo.trim()).not.toBe('')
    }
    expect(DEFAULT_ROLE_ID).toBe('equipier')
  })
})
