// Fiches réelles lues sur disque (le parseur reste pur : il prend une chaîne)
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NpcPersona } from '../shared/types/npc'
import { parsePersona } from '../server/npc/persona-parser'

export const PERSONAS_DIR = resolve(import.meta.dirname, '../server/npc/personas/panne-checkout')

export function personaFiles(): string[] {
  return readdirSync(PERSONAS_DIR).filter(file => file.endsWith('.md')).sort()
}

export function readPersonaSource(file: string): string {
  return readFileSync(resolve(PERSONAS_DIR, file), 'utf8')
}

export function loadPersonas(): NpcPersona[] {
  return personaFiles().map(file => parsePersona(readPersonaSource(file), file))
}

export function personaById(id: string): NpcPersona {
  const persona = loadPersonas().find(candidate => candidate.id === id)
  if (!persona) throw new Error(`fiche ${id} introuvable`)
  return persona
}
