// 037 CA1 et CA2 : cohérence des guides de l'animateur (docs/guide-animateur/) avec les scénarios et les fiches
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { npcScenarioIdOf, SCENARIOS } from '../server/scenarios'
import { ALERT_AUTHOR, ANNOUNCEMENT_AUTHOR } from '../server/utils/chat-store'
import { parseMarkdownBlocks, type InlineSegment, type MarkdownBlock } from '../shared/utils/markdown-blocks'
import type { ScenarioStep } from '../shared/types/scenario'
import { loadPersonas, personaFiles, readPersonaSource } from './npc-helpers'

const GUIDES_DIR = resolve(import.meta.dirname, '../docs/guide-animateur')

/** Espaces fines et insécables ramenées à l'espace simple */
const normalize = (value: string) => value.replace(/[   ]/g, ' ')

const plain = (segments: InlineSegment[]) => segments.map(segment => segment.text).join('')

function readGuide(scenarioId: string): string {
  return normalize(readFileSync(resolve(GUIDES_DIR, `${scenarioId}.md`), 'utf8'))
}

/** Blocs de la section `## title`, jusqu'au `##` suivant */
function section(markdown: string, title: string): MarkdownBlock[] {
  const blocks = parseMarkdownBlocks(markdown)
  const start = blocks.findIndex(block => block.type === 'heading' && block.level === 2 && plain(block.content) === title)
  if (start < 0) return []
  const rest = blocks.slice(start + 1)
  const end = rest.findIndex(block => block.type === 'heading' && block.level <= 2)
  return end < 0 ? rest : rest.slice(0, end)
}

/** Texte brut d'une section, tableaux compris */
function sectionText(markdown: string, title: string): string {
  return section(markdown, title).map((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return plain(block.content)
      case 'list':
        return block.items.map(plain).join('\n')
      case 'table':
        return [block.header, ...block.rows].map(row => row.map(plain).join(' | ')).join('\n')
    }
  }).join('\n')
}

function tableRows(markdown: string, title: string): string[][] {
  const table = section(markdown, title).find(block => block.type === 'table')
  if (!table || table.type !== 'table') return []
  return table.rows.map(row => row.map(plain))
}

/** Offset en secondes au format m:ss */
function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function personasOf(scenarioId: string) {
  const scenario = SCENARIOS.find(candidate => candidate.id === scenarioId)!
  return loadPersonas(npcScenarioIdOf(scenario))
}

function expectedAuthor(step: ScenarioStep, scenarioId: string): string {
  if (step.kind === 'alert') return ALERT_AUTHOR
  if (step.kind === 'announcement') return ANNOUNCEMENT_AUTHOR
  const persona = personasOf(scenarioId).find(candidate => candidate.id === step.npcId)
  if (!persona) throw new Error(`fiche ${step.npcId} introuvable pour ${scenarioId}`)
  return persona.name
}

/** Étapes et fiches du scénario : le texte où doivent figurer les heures et nombres de la vérité terrain */
function sourceCorpus(scenarioId: string): string {
  const scenario = SCENARIOS.find(candidate => candidate.id === scenarioId)!
  const steps = scenario.steps.map(step => ('title' in step ? `${step.title} ${step.text}` : step.text)).join('\n')
  const npcScenario = npcScenarioIdOf(scenario)
  const sheets = personaFiles(npcScenario).map(file => readPersonaSource(file, npcScenario)).join('\n')
  return normalize(`${steps}\n${sheets}`)
}

const TIME = /\d{1,2}h\d{2}/g
// Nombres groupés par milliers (48 210), décimaux (2,4) ou entiers
const NUMBER = /\d{1,3}(?: \d{3})+|\d+(?:,\d+)?/g

describe('guides de l\'animateur', () => {
  for (const scenario of SCENARIOS) {
    describe(scenario.id, () => {
      const guide = readGuide(scenario.id)

      it('commence par un titre et contient les sections obligatoires', () => {
        expect(guide.startsWith('# ')).toBe(true)
        expect(section(guide, 'Chronologie des injections').length).toBeGreaterThan(0)
      })

      it('CA1 : chaque étape a sa ligne (même t en m:ss, même auteur)', () => {
        const rows = tableRows(guide, 'Chronologie des injections')
        expect(rows).toHaveLength(scenario.steps.length)
        for (const step of scenario.steps) {
          const author = expectedAuthor(step, scenario.id)
          const match = rows.find(row => row[0] === mmss(step.at) && row[2] === author)
          expect(match, `étape à ${mmss(step.at)} (${author})`).toBeDefined()
        }
      })
    })
  }

  for (const scenarioId of ['panne-checkout', 'fuite-donnees']) {
    describe(`${scenarioId} : fiches, vérité terrain, pitch`, () => {
      const guide = readGuide(scenarioId)

      it('sections obligatoires dans l\'ordre', () => {
        const titles = parseMarkdownBlocks(guide)
          .filter(block => block.type === 'heading' && block.level === 2)
          .map(block => plain((block as { content: InlineSegment[] }).content))
        expect(titles).toEqual(['Pitch', 'Vérité terrain', 'Chronologie des injections', 'PNJ',
          'Recoupement et décisions attendus', 'Relances si l\'équipe bloque', 'Débrief', 'Préparation'])
      })

      it('CA1 : chaque fiche du scénario a sa ligne dans le tableau PNJ', () => {
        const names = tableRows(guide, 'PNJ').map(row => row[0])
        const personas = personasOf(scenarioId)
        expect(personas.length).toBeGreaterThan(0)
        for (const persona of personas) expect(names, persona.name).toContain(persona.name)
        expect(names).toHaveLength(personas.length)
      })

      it('CA1 : heures et nombres de la vérité terrain figurent dans les étapes ou les fiches', () => {
        const truth = sectionText(guide, 'Vérité terrain')
        const corpus = sourceCorpus(scenarioId)
        const times = truth.match(TIME) ?? []
        expect(times.length).toBeGreaterThan(0)
        for (const time of times) expect(corpus, `heure ${time}`).toContain(time)
        const numbers = (truth.replace(TIME, ' ').match(NUMBER) ?? []).filter(value => value.replace(/\D/g, '').length >= 2)
        expect(numbers.length).toBeGreaterThan(0)
        for (const value of numbers) expect(corpus, `nombre ${value}`).toContain(value)
      })
    })
  }

  describe('CA2 : les pitchs ne livrent pas la cause', () => {
    const FORBIDDEN: Record<string, string[]> = {
      'panne-checkout': ['v2.41.0', 'rollback', 'pool'],
      'fuite-donnees': ['#482', 'Routilo', '48 210'],
    }
    for (const [scenarioId, words] of Object.entries(FORBIDDEN)) {
      it(scenarioId, () => {
        const pitch = sectionText(readGuide(scenarioId), 'Pitch').toLowerCase()
        expect(pitch.length).toBeGreaterThan(100)
        for (const word of words) expect(pitch, word).not.toContain(word.toLowerCase())
        expect(pitch.replace(/\s/g, '')).not.toContain('48210')
      })
    }
  })
})
