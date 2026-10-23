// Couche des fiches modifiées en ligne depuis /admin (026), au-dessus des fiches lues à la source
// (dossier ou embarquées). Module pur, sans entrée-sortie : les fiches en service sont celles de la
// source, chacune remplacée par sa version modifiée si elle existe ; une fiche modifiée dont l'original
// a disparu de la source reste en service. État en mémoire seulement (perdu au redémarrage).
//
// Le chemin d'une édition n'est jamais un chemin de fichier : c'est une clé comparée aux fiches en service.
import type { NpcPersonaEditError } from '../../shared/types/npc'
import { byPath, checkPersonaFile, PERSONA_FILE_MAX_BYTES, type PersonaFile, personaErrorMessage } from './persona-source'
import { PersonaParseError } from './persona-parser'

export type PersonaEditError = NpcPersonaEditError

/** Refus d'une édition ou d'un retour à l'original ; status : code HTTP de la route */
export interface PersonaLayerFailure {
  ok: false
  status: 404 | 409 | 413 | 422
  errors: PersonaEditError[]
}

export type PersonaLayerResult = { ok: true, file: PersonaFile } | PersonaLayerFailure

export interface PersonaLayer {
  /** Fiches en service : source fusionnée avec les fiches modifiées, triées par chemin */
  served: () => PersonaFile[]
  /** Fiches lues à la source (sans les modifications) */
  source: () => PersonaFile[]
  /** Remplace les fiches de la source (chargement, rechargement) ; les fiches modifiées restent prioritaires */
  setSource: (files: readonly PersonaFile[]) => void
  isModified: (path: string) => boolean
  /** Remplace la fiche en service path par markdown, si elle est valide ; rien ne change sinon */
  edit: (path: string, markdown: string) => PersonaLayerResult
  /** Supprime la version modifiée de path et remet l'original de la source */
  revert: (path: string) => PersonaLayerResult
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function failure(status: PersonaLayerFailure['status'], message: string, line?: number): PersonaLayerFailure {
  return { ok: false, status, errors: [line === undefined ? { message } : { message, line }] }
}

/**
 * Fusion : chaque fiche de la source remplacée par sa version modifiée, plus les fiches modifiées dont
 * l'original a disparu. Une fiche de la source non modifiée dont le nom (casse ignorée) est pris par une
 * fiche modifiée est écartée : les modifications sont prioritaires.
 */
export function mergePersonaOverrides(source: readonly PersonaFile[], overrides: ReadonlyMap<string, PersonaFile>): PersonaFile[] {
  const overrideNames = new Set([...overrides.values()].map(file => file.persona.name.toLowerCase()))
  const fromSource = source
    .filter(file => !overrides.has(file.path))
    .filter(file => !overrideNames.has(file.persona.name.toLowerCase()))
  return [...fromSource, ...overrides.values()].sort(byPath)
}

export function createPersonaLayer(initial: readonly PersonaFile[] = []): PersonaLayer {
  let sourceFiles: PersonaFile[] = [...initial]
  const overrides = new Map<string, PersonaFile>()
  const served = () => mergePersonaOverrides(sourceFiles, overrides)

  return {
    served,
    source: () => [...sourceFiles],
    setSource(files) {
      sourceFiles = [...files]
    },
    isModified: path => overrides.has(path),

    edit(path, markdown) {
      const current = served()
      if (!current.some(file => file.path === path)) return failure(404, `Fiche inconnue : ${path.slice(0, 200)}`)
      if (byteLength(markdown) > PERSONA_FILE_MAX_BYTES) {
        return failure(413, `Fiche PNJ ${path} : fiche de plus de ${PERSONA_FILE_MAX_BYTES / 1024} Ko`)
      }
      try {
        const file = checkPersonaFile(path, markdown, current.filter(other => other.path !== path))
        overrides.set(path, file)
        return { ok: true, file }
      }
      catch (error) {
        return failure(422, personaErrorMessage(path, error), error instanceof PersonaParseError ? error.line : undefined)
      }
    },

    revert(path) {
      if (!overrides.has(path)) return failure(404, `Aucune version modifiée pour ${path.slice(0, 200)}`)
      const original = sourceFiles.find(file => file.path === path)
      if (!original) return failure(409, `Fiche PNJ ${path} : l'original n'existe plus à la source`)
      const name = original.persona.name.toLowerCase()
      const taken = served().find(other => other.path !== path && other.persona.name.toLowerCase() === name)
      if (taken) return failure(409, `Fiche PNJ ${path} : nom « ${original.persona.name} » de l'original déjà pris par ${taken.path}`)
      overrides.delete(path)
      return { ok: true, file: original }
    },
  }
}
