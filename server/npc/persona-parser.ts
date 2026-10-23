// Parseur des fiches de PNJ : Markdown avec un front-matter minimal `clé: valeur` (sans dépendance YAML).
// Module pur : il prend le texte de la fiche, la lecture du fichier revient à l'appelant.
//
// ---
// id: release-manager
// name: Julien Moreau
// role: Release Manager, équipe Paiements
// scenario: panne-checkout
// tone: Phrase d'ouverture de ses réponses (moteur keywords).
// personality: Une phrase sur son caractère et son style (prompt des moteurs à modèle).
// deflection: Réponse quand il n'a rien d'utile à dire.
// ---
// ## Sait
// - une information par puce (les lignes indentées qui suivent prolongent la puce)
// ## Ignore
// - ...
// ## Sur question précise
// - [mots: rollback, retour arrière, !v2.40.3] information livrée seulement si la question contient au
//   moins 2 de ces déclencheurs, ou un déclencheur spécifique (préfixé de !) ; une entrée qui n'a ni
//   déclencheur spécifique ni au moins 2 déclencheurs est refusée
import type { NpcPersona, NpcPreciseEntry } from '../../shared/types/npc'

export class PersonaParseError extends Error {
  constructor(source: string, message: string) {
    super(`Fiche PNJ ${source} : ${message}`)
    this.name = 'PersonaParseError'
  }
}

const REQUIRED_FIELDS = ['id', 'name', 'role', 'scenario', 'tone', 'personality', 'deflection'] as const
type RequiredField = typeof REQUIRED_FIELDS[number]

/** Titres de section reconnus (comparés sans casse) → liste visée */
const SECTIONS = {
  'sait': 'knows',
  'ignore': 'ignores',
  'sur question précise': 'precise',
} as const
type SectionKey = typeof SECTIONS[keyof typeof SECTIONS]

const PRECISE_RE = /^\[mots\s*:\s*([^\]]*)\]\s*(.*)$/i

function parseFrontMatter(lines: string[], source: string): { fields: Map<string, string>, bodyStart: number } {
  let start = 0
  while (start < lines.length && lines[start]!.trim() === '') start++
  if (lines[start]?.trim() !== '---') throw new PersonaParseError(source, 'front-matter absent (la fiche doit commencer par ---)')
  const fields = new Map<string, string>()
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (line === '---') return { fields, bodyStart: index + 1 }
    if (line === '' || line.startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) throw new PersonaParseError(source, `ligne de front-matter invalide « ${line} » (attendu clé: valeur)`)
    fields.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  throw new PersonaParseError(source, 'front-matter non fermé (--- manquant)')
}

function parsePrecise(text: string, source: string): NpcPreciseEntry {
  const match = PRECISE_RE.exec(text)
  if (!match) throw new PersonaParseError(source, `puce « Sur question précise » sans [mots: …] : « ${text} »`)
  const triggers = match[1]!.split(',')
    .map(word => word.trim())
    .map(word => word.startsWith('!') ? { text: word.slice(1).trim(), specific: true } : { text: word, specific: false })
    .filter(trigger => trigger.text !== '')
  const entry = match[2]!.trim()
  if (triggers.length === 0) throw new PersonaParseError(source, `puce « Sur question précise » sans mot déclencheur : « ${text} »`)
  if (entry === '') throw new PersonaParseError(source, `puce « Sur question précise » sans texte : « ${text} »`)
  // Un seul mot courant ne doit pas suffire à livrer une information précise
  if (triggers.length < 2 && !triggers.some(trigger => trigger.specific)) {
    throw new PersonaParseError(source, `puce « Sur question précise » avec un seul déclencheur, non spécifique (au moins 2, ou un préfixé de !) : « ${text} »`)
  }
  return { triggers, text: entry }
}

/**
 * Lit une fiche ; lève PersonaParseError (message explicite, préfixé de source) si un champ obligatoire
 * manque ou si une section obligatoire est vide. source sert seulement aux messages d'erreur.
 */
export function parsePersona(markdown: string, source = 'sans nom'): NpcPersona {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const { fields, bodyStart } = parseFrontMatter(lines, source)
  const value = (field: RequiredField): string => {
    const raw = fields.get(field)
    if (raw === undefined || raw === '') throw new PersonaParseError(source, `champ « ${field} » manquant`)
    return raw
  }
  const head = Object.fromEntries(REQUIRED_FIELDS.map(field => [field, value(field)])) as Record<RequiredField, string>

  const bullets: Record<SectionKey, string[]> = { knows: [], ignores: [], precise: [] }
  let section: SectionKey | null = null
  for (const line of lines.slice(bodyStart)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      section = SECTIONS[heading[1]!.toLowerCase() as keyof typeof SECTIONS] ?? null
      continue
    }
    if (section === null || line.trim() === '') continue
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const list = bullets[section]
    if (bullet) list.push(bullet[1]!.trim())
    // Ligne indentée : suite de la puce précédente
    else if (/^\s+\S/.test(line) && list.length > 0) list[list.length - 1] += ` ${line.trim()}`
  }

  if (bullets.knows.length === 0) throw new PersonaParseError(source, 'section « ## Sait » absente ou vide')
  if (bullets.ignores.length === 0) throw new PersonaParseError(source, 'section « ## Ignore » absente ou vide')
  if (bullets.precise.length === 0) throw new PersonaParseError(source, 'section « ## Sur question précise » absente ou vide')

  return {
    id: head.id,
    name: head.name,
    role: head.role,
    scenarioId: head.scenario,
    tone: head.tone,
    personality: head.personality,
    deflection: head.deflection,
    knows: bullets.knows,
    ignores: bullets.ignores,
    onPreciseQuestion: bullets.precise.map(text => parsePrecise(text, source)),
  }
}
