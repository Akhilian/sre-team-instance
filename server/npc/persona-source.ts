// Sources des fiches de PNJ : un dossier du disque (NPC_PERSONAS_DIR, <dir>/<scénario>/<id>.md) ou les
// fiches embarquées au build (assets:npc). Module pur : le système de fichiers et le stockage sont
// injectés, testable avec Vitest dans un dossier temporaire. Validation commune aux deux sources
// (parseur, id et scénario cohérents avec le chemin, nom unique) et fusion d'un rechargement.
//
// Garde-fous de lecture du dossier : le chemin vient de l'appelant (l'environnement seulement), noms de
// dossier et de fichier contrôlés, chemin réel confiné sous le chemin réel du dossier (lien symbolique
// sortant refusé), taille par fiche et nombre de fiches plafonnés.
import type { NpcPersona, NpcPersonaReloadReport, NpcPersonaSource } from '../../shared/types/npc'
import { parsePersona } from './persona-parser'

/** Taille maximale d'une fiche, en octets */
export const PERSONA_FILE_MAX_BYTES = 32 * 1024
/** Nombre maximal de fiches lues par chargement */
export const PERSONA_FILES_MAX = 50
/** Nom d'un dossier de scénario, ou d'une fiche sans son extension .md */
const NAME_RE = /^[a-z0-9-]+$/
/** Chemin des erreurs qui portent sur le dossier lui-même */
export const PERSONA_ROOT_PATH = '.'

export type PersonaSourceKind = NpcPersonaSource

/** Fiche valide, avec son chemin relatif (<scénario>/<id>.md) et son texte source */
export interface PersonaFile {
  path: string
  markdown: string
  persona: NpcPersona
}

export interface PersonaLoadError {
  path: string
  message: string
}

export interface PersonaLoadResult {
  files: PersonaFile[]
  errors: PersonaLoadError[]
}

/** Sous-ensemble de fs/promises utilisé (injecté) */
export interface PersonaFs {
  readdir: (path: string) => Promise<string[]>
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ isFile: () => boolean, isDirectory: () => boolean, size: number }>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
}

/** Sous-ensemble d'un stockage unstorage (useStorage('assets:npc')) */
export interface PersonaAssets {
  getKeys: () => Promise<string[]>
  getItem: (key: string) => Promise<unknown>
}

/** Fiche à valider : chemin relatif et lecture différée (une exception devient une erreur de la fiche) */
interface PersonaCandidate {
  path: string
  read: () => Promise<string>
}

class PersonaSourceError extends Error {}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim()
}

/** Code d'une erreur système (ENOENT…), sans le chemin absolu que contient son message */
function fsErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : errorMessage(error)
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Tri par chemin, en ordre des unités de code (indépendant de la locale) */
function byPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

function isInside(root: string, real: string): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`
  return real.startsWith(prefix)
}

/**
 * Lit, parse et valide les candidats dans l'ordre (triés par chemin) : taille, parseur, id et scénario
 * égaux au chemin, nom libre (casse ignorée). Au plus PERSONA_FILES_MAX fiches lues.
 */
async function validateCandidates(candidates: PersonaCandidate[], errors: PersonaLoadError[]): Promise<PersonaLoadResult> {
  const files: PersonaFile[] = []
  const sorted = [...candidates].sort(byPath)
  sorted.forEach((candidate, index) => {
    if (index >= PERSONA_FILES_MAX) {
      errors.push({ path: candidate.path, message: `plus de ${PERSONA_FILES_MAX} fiches : fiche ignorée` })
    }
  })
  for (const { path, read } of sorted.slice(0, PERSONA_FILES_MAX)) {
    try {
      const markdown = await read()
      if (byteLength(markdown) > PERSONA_FILE_MAX_BYTES) {
        throw new PersonaSourceError(`fiche de plus de ${PERSONA_FILE_MAX_BYTES / 1024} Ko`)
      }
      const persona = parsePersona(markdown, path)
      if (`${persona.scenarioId}/${persona.id}.md` !== path) {
        throw new PersonaSourceError(`id « ${persona.id} » ou scénario « ${persona.scenarioId} » différent du chemin`)
      }
      const taken = files.find(other => other.persona.name.toLowerCase() === persona.name.toLowerCase())
      if (taken) throw new PersonaSourceError(`nom « ${persona.name} » déjà pris par ${taken.path}`)
      files.push({ path, markdown, persona })
    }
    catch (error) {
      // Les erreurs du parseur sont déjà préfixées « Fiche PNJ <chemin> : »
      const message = errorMessage(error)
      errors.push({ path, message: message.startsWith('Fiche PNJ ') ? message : `Fiche PNJ ${path} : ${message}` })
    }
  }
  return { files, errors }
}

/**
 * Fiches de <dir>/<scénario>/<id>.md. Les fichiers sans extension .md et les noms cachés (.xxx) sont
 * ignorés ; un nom hors ^[a-z0-9-]+$, un chemin réel hors du dossier, un fichier trop gros ou invalide
 * donne une erreur nommant son chemin relatif. Dossier absent ou illisible : une erreur sur « . ».
 * Ne lève jamais.
 */
export async function readPersonaDir(dir: string, fs: PersonaFs): Promise<PersonaLoadResult> {
  const errors: PersonaLoadError[] = []
  let root: string
  let scenarios: string[]
  try {
    root = await fs.realpath(dir)
    if (!(await fs.stat(root)).isDirectory()) throw new PersonaSourceError('pas un dossier')
    scenarios = (await fs.readdir(root)).sort()
  }
  catch (error) {
    return { files: [], errors: [{ path: PERSONA_ROOT_PATH, message: `dossier des fiches illisible : ${fsErrorText(error)}` }] }
  }

  const candidates: PersonaCandidate[] = []
  for (const scenario of scenarios) {
    if (scenario.startsWith('.')) continue
    const scenarioPath = `${scenario}/`
    let scenarioReal: string
    try {
      scenarioReal = await fs.realpath(`${root}/${scenario}`)
      // Fichiers à la racine du dossier : ignorés
      if (!(await fs.stat(scenarioReal)).isDirectory()) continue
    }
    catch (error) {
      errors.push({ path: scenarioPath, message: `Fiche PNJ ${scenarioPath} : illisible (${fsErrorText(error)})` })
      continue
    }
    if (!NAME_RE.test(scenario)) {
      errors.push({ path: scenarioPath, message: `Fiche PNJ ${scenarioPath} : nom de dossier invalide (attendu ^[a-z0-9-]+$)` })
      continue
    }
    if (!isInside(root, scenarioReal)) {
      errors.push({ path: scenarioPath, message: `Fiche PNJ ${scenarioPath} : dossier hors de NPC_PERSONAS_DIR (lien symbolique ?)` })
      continue
    }
    let names: string[]
    try {
      names = (await fs.readdir(scenarioReal)).sort()
    }
    catch (error) {
      errors.push({ path: scenarioPath, message: `Fiche PNJ ${scenarioPath} : dossier illisible (${fsErrorText(error)})` })
      continue
    }
    for (const name of names) {
      if (name.startsWith('.') || !name.endsWith('.md')) continue
      const path = `${scenario}/${name}`
      if (!NAME_RE.test(name.slice(0, -'.md'.length))) {
        errors.push({ path, message: `Fiche PNJ ${path} : nom de fichier invalide (attendu ^[a-z0-9-]+\\.md$)` })
        continue
      }
      candidates.push({
        path,
        read: async () => {
          const real = await fs.realpath(`${scenarioReal}/${name}`)
          if (!isInside(root, real)) throw new PersonaSourceError('fichier hors de NPC_PERSONAS_DIR (lien symbolique ?)')
          const stats = await fs.stat(real)
          if (!stats.isFile()) throw new PersonaSourceError('pas un fichier')
          if (stats.size > PERSONA_FILE_MAX_BYTES) throw new PersonaSourceError(`fiche de plus de ${PERSONA_FILE_MAX_BYTES / 1024} Ko`)
          return fs.readFile(real, 'utf8')
        },
      })
    }
  }
  return validateCandidates(candidates, errors)
}

/** Fiches embarquées (clés unstorage <scénario>:<id>.md), mêmes validations que le dossier. Ne lève jamais. */
export async function readEmbeddedPersonas(assets: PersonaAssets): Promise<PersonaLoadResult> {
  let keys: string[]
  try {
    keys = (await assets.getKeys()).filter(key => key.endsWith('.md'))
  }
  catch (error) {
    return { files: [], errors: [{ path: PERSONA_ROOT_PATH, message: `fiches embarquées illisibles : ${errorMessage(error)}` }] }
  }
  return validateCandidates(keys.map(key => ({
    path: key.replace(/:/g, '/'),
    read: async () => {
      const raw = await assets.getItem(key)
      if (typeof raw !== 'string') throw new PersonaSourceError('contenu illisible')
      return raw
    },
  })), [])
}

export type PersonaReloadReport = NpcPersonaReloadReport

export interface PersonaReloadOutcome {
  /** Fiches en service après le rechargement (celles d'avant si replaced est faux) */
  files: PersonaFile[]
  /** Faux si le rechargement n'a produit aucune fiche valide : rien n'est remplacé */
  replaced: boolean
  report: PersonaReloadReport
}

/**
 * Fusion d'un rechargement : les fiches valides remplacent les fiches en cours ; une fiche en erreur
 * garde sa version précédente si elle existe (et si son nom n'est pas repris par une fiche chargée) ;
 * une fiche absente du résultat disparaît. Sans aucune fiche valide, rien n'est remplacé.
 */
export function mergePersonaReload(
  previous: readonly PersonaFile[],
  result: PersonaLoadResult,
  source: PersonaSourceKind,
): PersonaReloadOutcome {
  const loaded = result.files
  if (loaded.length === 0) {
    return { files: [...previous], replaced: false, report: { source, loaded: [], errors: result.errors, kept: [] } }
  }
  const failed = new Set(result.errors.map(error => error.path))
  const names = new Set(loaded.map(file => file.persona.name.toLowerCase()))
  const kept = previous.filter(file => failed.has(file.path)
    && !loaded.some(other => other.path === file.path)
    && !names.has(file.persona.name.toLowerCase()))
  const files = [...loaded, ...kept].sort(byPath)
  return {
    files,
    replaced: true,
    report: { source, loaded: loaded.map(file => file.path), errors: result.errors, kept: kept.map(file => file.path) },
  }
}
