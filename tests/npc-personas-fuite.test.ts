// 027 CA1, CA3, CA4 et CA6 : fiches de fuite-donnees, répartition de l'information, cohérence des heures
// et moteur keywords sur les vraies fiches
import { describe, expect, it } from 'vitest'
import type { NpcPersona } from '../shared/types/npc'
import { checkPersonaFile, type PersonaFile } from '../server/npc/persona-source'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { SCENARIOS } from '../server/scenarios'
import { loadPersonas, personaById, personaFiles, readPersonaSource } from './npc-helpers'

const SCENARIO = 'fuite-donnees'
const IDS = ['dev-data', 'dpo', 'porte-parole', 'soc', 'support-clients']

/**
 * Chronologie canonique du scénario, seul endroit à ajuster : toute heure écrite dans les fiches ou dans
 * les étapes doit en faire partie (17h00 et 17h désignent la même échéance).
 */
const CANONICAL_TIMES = ['18h05', '18h20', '23h14', '9h31', '9h52', '17h00', '17h']
/** Heures au format 9h31 ou 17h, sans chiffre ni lettre collés */
const TIME_PATTERN = /(?<![\p{L}\d])\d{1,2}h(?:\d{2})?(?![\p{L}\d])/gu

const fuite = () => SCENARIOS.find(scenario => scenario.id === SCENARIO)!

/** Fichiers de fuite-donnees dont la source contient text */
function filesWith(text: string): string[] {
  return personaFiles(SCENARIO).filter(file => readPersonaSource(file, SCENARIO).includes(text))
}

/** Textes hors « Sur question précise » d'une fiche : front-matter, présentation, Sait, Ignore */
function outsidePrecise(file: string): string {
  const source = readPersonaSource(file, SCENARIO)
  return source.slice(0, source.indexOf('## Sur question précise'))
}

function preciseTexts(persona: NpcPersona): string[] {
  return persona.onPreciseQuestion.map(entry => entry.text)
}

const retriever = createLexicalRetriever()
const responder = createKeywordsResponder()

async function answer(persona: NpcPersona, question: string): Promise<string> {
  return responder.respond({ persona, excerpts: await retriever.retrieve(persona, question), history: [], question })
}

describe('fiches de fuite-donnees (027 CA1)', () => {
  it('les 5 fiches passent checkPersonaFile et ont toutes personality', () => {
    expect(personaFiles(SCENARIO)).toEqual(IDS.map(id => `${id}.md`))
    const checked: PersonaFile[] = []
    for (const file of personaFiles(SCENARIO)) {
      const result = checkPersonaFile(`${SCENARIO}/${file}`, readPersonaSource(file, SCENARIO), checked)
      checked.push(result)
      const persona = result.persona
      expect(persona.scenarioId).toBe(SCENARIO)
      expect(persona.personality.length).toBeGreaterThan(40)
      expect(persona.personality).not.toBe(persona.tone)
      expect(persona.knows.length).toBeGreaterThan(0)
      expect(persona.ignores.length).toBeGreaterThan(0)
      expect(persona.onPreciseQuestion.length).toBeGreaterThan(0)
      for (const entry of persona.onPreciseQuestion) {
        expect(entry.triggers.length >= 2 || entry.triggers.some(trigger => trigger.specific)).toBe(true)
      }
    }
  })

  it('aucun id ni aucun nom (casse ignorée) commun avec panne-checkout', () => {
    const panne = loadPersonas()
    const ids = loadPersonas(SCENARIO).map(persona => persona.id)
    const names = loadPersonas(SCENARIO).map(persona => persona.name.toLowerCase())
    for (const persona of panne) {
      expect(ids).not.toContain(persona.id)
      expect(names).not.toContain(persona.name.toLowerCase())
    }
    expect(new Set(names).size).toBe(5)
  })

  it('les 11 fiches des deux scénarios se valident ensemble (noms uniques)', () => {
    const all: PersonaFile[] = []
    for (const scenario of ['fuite-donnees', 'panne-checkout']) {
      for (const file of personaFiles(scenario)) {
        all.push(checkPersonaFile(`${scenario}/${file}`, readPersonaSource(file, scenario), all))
      }
    }
    expect(all).toHaveLength(11)
  })
})

describe('répartition de l\'information (027 CA3)', () => {
  it.each([
    ['18h05', ['dev-data.md']],
    ['#482', ['dev-data.md']],
    ['48 210', ['dev-data.md']],
    ['23h14', ['soc.md']],
    ['9h31', ['soc.md']],
    ['198.51.100.77', ['soc.md']],
    ['72 heures', ['dpo.md']],
    ['18h20', ['dev-data.md', 'soc.md']],
    ['date de naissance', ['dev-data.md', 'support-clients.md']],
  ])('« %s » ne figure que dans %j', (text, files) => {
    expect(filesWith(text)).toEqual(files)
  })

  it.each([
    ['dev-data', ['18h05', '#482', '48 210', '18h20', 'date de naissance']],
    ['soc', ['23h14', '9h31', '198.51.100.77', '18h20']],
    ['support-clients', ['date de naissance']],
  ])('%s : les faits-clés n\'apparaissent que dans « Sur question précise »', (id, facts) => {
    const persona = personaById(id, SCENARIO)
    for (const fact of facts) {
      expect(outsidePrecise(`${id}.md`), fact).not.toContain(fact)
      expect(persona.knows.some(text => text.includes(fact)), fact).toBe(false)
      expect(preciseTexts(persona).some(text => text.includes(fact)), fact).toBe(true)
    }
  })

  it('dpo : « 72 heures » dans « Sait »', () => {
    expect(personaById('dpo', SCENARIO).knows.some(text => text.includes('72 heures'))).toBe(true)
  })
})

describe('cohérence de la chronologie (027 CA4)', () => {
  it('toute heure des fiches et des étapes appartient à la chronologie canonique', () => {
    const texts = [
      ...personaFiles(SCENARIO).map(file => readPersonaSource(file, SCENARIO)),
      ...fuite().steps.map(step => JSON.stringify(step)),
    ]
    const found = texts.flatMap(text => text.match(TIME_PATTERN) ?? [])
    expect(found.length).toBeGreaterThan(0)
    for (const time of found) expect(CANONICAL_TIMES, time).toContain(time)
  })

  it('9h52 figure dans l\'étape t=0 et dans la fiche soc', () => {
    const first = fuite().steps[0]!
    expect(first.at).toBe(0)
    expect(first.text).toContain('9h52')
    expect(readPersonaSource('soc.md', SCENARIO)).toContain('9h52')
  })

  it('« 3 lectures » de l\'alerte t=80 et les 1 + 2 téléchargements de la fiche soc concordent', () => {
    const alert = fuite().steps.find(step => step.at === 80)!
    expect(alert.kind).toBe('alert')
    expect(JSON.stringify(alert)).toContain('3 lectures')
    expect(JSON.stringify(alert)).toContain('6,1 Mo')

    const logs = preciseTexts(personaById('soc', SCENARIO)).find(text => text.includes('23h14'))!
    expect(logs).toContain('3 téléchargements')
    expect(logs).toContain('6,1 Mo')
    // Un téléchargement depuis 203.0.113.24, deux depuis 198.51.100.77
    expect(logs.match(TIME_PATTERN)).toEqual(['18h20', '23h14', '9h31'])
    expect(logs).toMatch(/un téléchargement lundi à 18h20 depuis 203\.0\.113\.24, puis deux depuis 198\.51\.100\.77/)
  })
})

describe('moteur keywords sur les fiches de fuite-donnees (027 CA6)', () => {
  it.each([
    ['soc', 'quels téléchargements dans les journaux d\'accès, à quelle heure ?', '23h14'],
    ['dev-data', 'quelles données contient l\'export, combien de clients ?', '48 210'],
    ['dpo', 'quel délai pour notifier la CNIL ?', '72 heures'],
    ['support-clients', 'qu\'est-ce que le SMS mentionne exactement ?', 'date de naissance'],
  ])('%s : « %s » donne %s', async (id, question, expected) => {
    expect(await answer(personaById(id, SCENARIO), question)).toContain(expected)
  })

  it.each([
    ['dev-data', 'qui a rendu le bucket public ?', '#482'],
    ['dev-data', 'qui a modifié le bucket ?', '#482'],
    ['dev-data', 'pourquoi le bucket est public ?', '#482'],
    ['dev-data', 'il y a quoi dans l\'export ?', '48 210'],
    ['soc', 'qui a accédé au fichier ?', '23h14'],
    ['support-clients', 'les SMS contiennent quelles informations ?', 'date de naissance'],
    ['support-clients', 'qu\'y a-t-il dans le SMS ?', 'date de naissance'],
    ['dpo', 'on a combien de temps pour déclarer ?', '72 heures'],
  ])('question naturelle, %s : « %s » donne %s', async (id, question, expected) => {
    expect(await answer(personaById(id, SCENARIO), question)).toContain(expected)
  })

  it('« il y a quoi dans l\'export ? » ne propose pas de supprimer le fichier', async () => {
    expect(await answer(personaById('dev-data', SCENARIO), 'il y a quoi dans l\'export ?')).not.toContain('supprimer le fichier')
  })

  it('une question vague ou hors sujet donne la deflection de chacun', async () => {
    const vague = [
      'Quelle est la recette de la tarte aux pommes ?',
      'Bonjour, tu as des nouvelles ?',
      'Quoi de neuf ?',
      'Tu peux nous aider ?',
      'Ça va ?',
    ]
    for (const persona of loadPersonas(SCENARIO)) {
      for (const question of vague) {
        expect(await answer(persona, question), `${persona.id} : ${question}`).toBe(persona.deflection)
      }
    }
  })
})
