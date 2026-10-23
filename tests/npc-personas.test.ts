// 019 CA1, 021 CA3 : fiches de panne-checkout, parseur et répartition de l'information
import { describe, expect, it } from 'vitest'
import { PersonaParseError, parsePersona } from '../server/npc/persona-parser'
import { loadPersonas, personaFiles, readPersonaSource } from './npc-helpers'

const VALID = `---
id: test
name: Test Persona
role: Testeur
scenario: demo
tone: Bonjour :
personality: Calme et méthodique.
deflection: Je ne sais pas.
---
## Sait
- Une information
  qui continue sur deux lignes.
## Ignore
- Le reste.
## Sur question précise
- [mots: rollback, retour arrière] Le détail.
`

describe('fiches de panne-checkout', () => {
  it('les 6 fiches se chargent et sont complètes', () => {
    const personas = loadPersonas()
    expect(personas.map(persona => persona.id)).toEqual(['ceo', 'cfo', 'communication', 'psp', 'release-manager', 'support-n1'])
    for (const persona of personas) {
      expect(persona.scenarioId).toBe('panne-checkout')
      expect(persona.name).not.toBe('')
      expect(persona.role).not.toBe('')
      expect(persona.tone).not.toBe('')
      expect(persona.personality.length).toBeGreaterThan(40)
      expect(persona.personality).not.toBe(persona.tone)
      expect(persona.deflection).not.toBe('')
      expect(persona.knows.length).toBeGreaterThan(0)
      expect(persona.ignores.length).toBeGreaterThan(0)
      expect(persona.onPreciseQuestion.length).toBeGreaterThan(0)
      for (const entry of persona.onPreciseQuestion) {
        expect(entry.triggers.length >= 2 || entry.triggers.some(trigger => trigger.specific)).toBe(true)
        expect(entry.triggers.every(trigger => trigger.text !== '' && !trigger.text.startsWith('!'))).toBe(true)
        expect(entry.text).not.toBe('')
      }
    }
    // Noms distincts, sans casse
    expect(new Set(personas.map(persona => persona.name.toLowerCase())).size).toBe(6)
  })

  it('chaque fiche porte l\'id de son fichier', () => {
    for (const file of personaFiles()) {
      expect(`${parsePersona(readPersonaSource(file), file).id}.md`).toBe(file)
    }
  })

  it('021 CA3 : v2.41.0 et v2.40.3 seulement dans la fiche Release', () => {
    for (const version of ['v2.41.0', 'v2.40.3']) {
      expect(personaFiles().filter(file => readPersonaSource(file).includes(version))).toEqual(['release-manager.md'])
    }
  })

  it('021 CA3 : « 10 connexions » seulement chez Release et le PSP, et chez Release seulement sur question précise', () => {
    expect(personaFiles().filter(file => readPersonaSource(file).includes('10 connexions'))).toEqual(['psp.md', 'release-manager.md'])
    const release = parsePersona(readPersonaSource('release-manager.md'))
    const outsidePrecise = [release.tone, release.personality, release.deflection, ...release.knows, ...release.ignores]
    expect(outsidePrecise.some(text => /10 connexions|pool|retries|timeout/i.test(text))).toBe(false)
    expect(release.onPreciseQuestion.some(entry => entry.text.includes('10 connexions'))).toBe(true)
    // Le corps hors puces (titre, présentation) ne le contient pas non plus
    const source = readPersonaSource('release-manager.md')
    const preciseSection = source.slice(source.indexOf('## Sur question précise'))
    expect(source.slice(0, source.indexOf('## Sur question précise'))).not.toContain('10 connexions')
    expect(preciseSection).toContain('10 connexions')
  })
})

describe('parsePersona', () => {
  it('lit le front-matter, les sections et les déclencheurs', () => {
    expect(parsePersona(VALID)).toEqual({
      id: 'test',
      name: 'Test Persona',
      role: 'Testeur',
      scenarioId: 'demo',
      tone: 'Bonjour :',
      personality: 'Calme et méthodique.',
      deflection: 'Je ne sais pas.',
      knows: ['Une information qui continue sur deux lignes.'],
      ignores: ['Le reste.'],
      onPreciseQuestion: [{ triggers: [{ text: 'rollback', specific: false }, { text: 'retour arrière', specific: false }], text: 'Le détail.' }],
    })
  })

  it('accepte les fins de ligne Windows', () => {
    expect(parsePersona(VALID.replace(/\n/g, '\r\n')).name).toBe('Test Persona')
  })

  it('rejette une fiche sans name avec une erreur explicite', () => {
    const source = VALID.replace('name: Test Persona\n', '')
    expect(() => parsePersona(source, 'sans-nom.md')).toThrow(PersonaParseError)
    expect(() => parsePersona(source, 'sans-nom.md')).toThrow('Fiche PNJ sans-nom.md : champ « name » manquant')
  })

  it('020 : rejette une fiche sans personality (champ obligatoire, pas de repli)', () => {
    const missing = VALID.replace('personality: Calme et méthodique.\n', '')
    expect(() => parsePersona(missing, 'sans-perso.md')).toThrow('Fiche PNJ sans-perso.md : champ « personality » manquant')
    expect(() => parsePersona(VALID.replace('personality: Calme et méthodique.', 'personality:'), 'vide.md')).toThrow(/« personality » manquant/)
  })

  it('rejette un front-matter absent ou non fermé', () => {
    expect(() => parsePersona('## Sait\n- x')).toThrow(/front-matter absent/)
    expect(() => parsePersona('---\nid: x\n')).toThrow(/non fermé/)
  })

  it('rejette une section obligatoire vide', () => {
    expect(() => parsePersona(VALID.replace('- Le reste.\n', ''))).toThrow(/« ## Ignore » absente ou vide/)
    expect(() => parsePersona(VALID.replace('## Sait\n', '## Autre\n'))).toThrow(/« ## Sait » absente ou vide/)
  })

  it('021 CA3 : une puce précise exige un déclencheur spécifique (!) ou au moins 2 déclencheurs', () => {
    const withTriggers = (triggers: string) => VALID.replace('[mots: rollback, retour arrière]', `[mots: ${triggers}]`)
    expect(() => parsePersona(withTriggers('carte'), 'carte.md')).toThrow(/un seul déclencheur, non spécifique/)
    expect(parsePersona(withTriggers('!carte')).onPreciseQuestion[0]!.triggers).toEqual([{ text: 'carte', specific: true }])
    expect(parsePersona(withTriggers('carte, paypal')).onPreciseQuestion[0]!.triggers).toEqual([
      { text: 'carte', specific: false },
      { text: 'paypal', specific: false },
    ])
    expect(parsePersona(withTriggers('déploiement, version, !changelog, !v2.40.3')).onPreciseQuestion[0]!.triggers.filter(t => t.specific).map(t => t.text))
      .toEqual(['changelog', 'v2.40.3'])
  })

  it('rejette une puce précise sans [mots: …]', () => {
    expect(() => parsePersona(VALID.replace('[mots: rollback, retour arrière] ', ''))).toThrow(/sans \[mots: …\]/)
    expect(() => parsePersona(VALID.replace('[mots: rollback, retour arrière]', '[mots: ]'))).toThrow(/sans mot déclencheur/)
  })
})
