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
// ## Intervient spontanément   (facultative)
// - [mots: newsletter, black friday] texte : un de ces mots apparaît dans un message humain du canal d'incident
// - [après: 8 min] texte : 8 minutes écoulées depuis le lancement du scénario
// - [sans point: 6 min] texte : aucun point de situation dans le canal depuis 6 minutes
import type { NpcPersona, NpcPreciseEntry, NpcSpontaneousRule } from '../../shared/types/npc'

export class PersonaParseError extends Error {
  /** Ligne fautive (à partir de 1, dans le texte d'origine), si l'erreur porte sur une ligne précise */
  readonly line: number | undefined

  constructor(source: string, message: string, line?: number) {
    super(`Fiche PNJ ${source} : ${line === undefined ? '' : `ligne ${line} : `}${message}`)
    this.name = 'PersonaParseError'
    this.line = line
  }
}

const REQUIRED_FIELDS = ['id', 'name', 'role', 'scenario', 'tone', 'personality', 'deflection'] as const
type RequiredField = typeof REQUIRED_FIELDS[number]

/** Titres de section reconnus (comparés sans casse) → liste visée */
const SECTIONS = {
  'sait': 'knows',
  'ignore': 'ignores',
  'sur question précise': 'precise',
  'intervient spontanément': 'spontaneous',
  'intervient spontanement': 'spontaneous',
} as const
type SectionKey = typeof SECTIONS[keyof typeof SECTIONS]

const PRECISE_RE = /^\[mots\s*:\s*([^\]]*)\]\s*(.*)$/i
const SPONTANEOUS_RE = /^\[\s*([^\]:]*?)\s*:\s*([^\]]*)\]\s*(.*)$/
const MINUTES_RE = /^(\d{1,3})\s*min(?:utes?)?$/i
/** Durée maximale d'une règle spontanée (minutes) : au-delà, la règle ne se déclencherait jamais pendant un atelier */
const SPONTANEOUS_MAX_MINUTES = 180

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
    if (colon <= 0) throw new PersonaParseError(source, `ligne de front-matter invalide « ${line} » (attendu clé: valeur)`, index + 1)
    fields.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  throw new PersonaParseError(source, 'front-matter non fermé (--- manquant)')
}

/** line : ligne de début de la puce (à partir de 1), reprise dans les erreurs */
function parsePrecise(text: string, source: string, line: number): NpcPreciseEntry {
  const match = PRECISE_RE.exec(text)
  if (!match) throw new PersonaParseError(source, `puce « Sur question précise » sans [mots: …] : « ${text} »`, line)
  const triggers = match[1]!.split(',')
    .map(word => word.trim())
    .map(word => word.startsWith('!') ? { text: word.slice(1).trim(), specific: true } : { text: word, specific: false })
    .filter(trigger => trigger.text !== '')
  const entry = match[2]!.trim()
  if (triggers.length === 0) throw new PersonaParseError(source, `puce « Sur question précise » sans mot déclencheur : « ${text} »`, line)
  if (entry === '') throw new PersonaParseError(source, `puce « Sur question précise » sans texte : « ${text} »`, line)
  // Un seul mot courant ne doit pas suffire à livrer une information précise
  if (triggers.length < 2 && !triggers.some(trigger => trigger.specific)) {
    throw new PersonaParseError(source, `puce « Sur question précise » avec un seul déclencheur, non spécifique (au moins 2, ou un préfixé de !) : « ${text} »`, line)
  }
  return { triggers, text: entry }
}

/** line : ligne de début de la puce (à partir de 1), reprise dans les erreurs */
function parseSpontaneous(text: string, source: string, line: number): NpcSpontaneousRule {
  const match = SPONTANEOUS_RE.exec(text)
  if (!match) {
    throw new PersonaParseError(source, `règle « Intervient spontanément » sans condition ([mots: …], [après: N min] ou [sans point: N min]) : « ${text} »`, line)
  }
  const kind = match[1]!.toLowerCase()
  const condition = match[2]!.trim()
  const message = match[3]!.trim()
  if (message === '') throw new PersonaParseError(source, `règle « Intervient spontanément » sans texte : « ${text} »`, line)

  if (kind === 'mots') {
    const words = condition.split(',').map(word => word.trim()).filter(word => word !== '')
    if (words.length === 0) throw new PersonaParseError(source, `règle « Intervient spontanément » sans mot : « ${text} »`, line)
    return { trigger: { type: 'keywords', words }, text: message }
  }
  if (kind === 'après' || kind === 'apres' || kind === 'sans point') {
    const minutes = MINUTES_RE.exec(condition)
    const value = minutes ? Number(minutes[1]) : 0
    if (value < 1 || value > SPONTANEOUS_MAX_MINUTES) {
      throw new PersonaParseError(source, `règle « Intervient spontanément » : durée invalide « ${condition} » (attendu un nombre entier de minutes entre 1 et ${SPONTANEOUS_MAX_MINUTES}, ex. 8 min) : « ${text} »`, line)
    }
    return { trigger: { type: kind === 'sans point' ? 'no-status' : 'after', minutes: value }, text: message }
  }
  throw new PersonaParseError(source, `règle « Intervient spontanément » : condition inconnue « ${match[1]} » (attendu mots, après ou sans point) : « ${text} »`, line)
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

  const bullets: Record<SectionKey, string[]> = { knows: [], ignores: [], precise: [], spontaneous: [] }
  /** Ligne de début (à partir de 1) de chaque puce « Sur question précise » et « Intervient spontanément » */
  const preciseLines: number[] = []
  const spontaneousLines: number[] = []
  let section: SectionKey | null = null
  for (let index = bodyStart; index < lines.length; index++) {
    const line = lines[index]!
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      section = SECTIONS[heading[1]!.toLowerCase() as keyof typeof SECTIONS] ?? null
      continue
    }
    if (section === null || line.trim() === '') continue
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const list = bullets[section]
    if (bullet) {
      list.push(bullet[1]!.trim())
      if (section === 'precise') preciseLines.push(index + 1)
      if (section === 'spontaneous') spontaneousLines.push(index + 1)
    }
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
    onPreciseQuestion: bullets.precise.map((text, index) => parsePrecise(text, source, preciseLines[index]!)),
    spontaneous: bullets.spontaneous.map((text, index) => parseSpontaneous(text, source, spontaneousLines[index]!)),
  }
}
