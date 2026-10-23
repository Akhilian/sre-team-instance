// 019 CA1 : fiches de panne-checkout et parseur
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
  it('les 4 fiches se chargent et sont complètes', () => {
    const personas = loadPersonas()
    expect(personas.map(persona => persona.id)).toEqual(['ceo', 'cfo', 'release-manager', 'support-n1'])
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
        expect(entry.triggers.length).toBeGreaterThan(0)
        expect(entry.text).not.toBe('')
      }
    }
    // Noms distincts, sans casse
    expect(new Set(personas.map(persona => persona.name.toLowerCase())).size).toBe(4)
  })

  it('chaque fiche porte l\'id de son fichier', () => {
    for (const file of personaFiles()) {
      expect(`${parsePersona(readPersonaSource(file), file).id}.md`).toBe(file)
    }
  })

  it('seule la fiche Release contient « v2.41.0 »', () => {
    const withVersion = personaFiles().filter(file => readPersonaSource(file).includes('v2.41.0'))
    expect(withVersion).toEqual(['release-manager.md'])
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
      onPreciseQuestion: [{ triggers: ['rollback', 'retour arrière'], text: 'Le détail.' }],
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

  it('rejette une puce précise sans [mots: …]', () => {
    expect(() => parsePersona(VALID.replace('[mots: rollback, retour arrière] ', ''))).toThrow(/sans \[mots: …\]/)
    expect(() => parsePersona(VALID.replace('[mots: rollback, retour arrière]', '[mots: ]'))).toThrow(/sans mot déclencheur/)
  })
})
