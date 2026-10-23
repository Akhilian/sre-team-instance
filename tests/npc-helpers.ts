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

/** Instant de départ des horloges simulées */
export const T0 = Date.UTC(2026, 9, 23, 14, 0, 0)

/** Planificateur simulé : advance() exécute les tâches échues, puis laisse les promesses se régler */
export function fakeClock() {
  let time = T0
  let nextId = 1
  const tasks = new Map<number, { due: number, fn: () => void }>()
  return {
    now: () => time,
    schedule: (fn: () => void, delayMs: number) => {
      const id = nextId++
      tasks.set(id, { due: time + delayMs, fn })
      return id
    },
    cancel: (id: number) => {
      tasks.delete(id)
    },
    async advance(ms: number) {
      const target = time + ms
      for (;;) {
        const next = [...tasks.entries()].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        tasks.delete(next[0])
        time = next[1].due
        next[1].fn()
        await flush()
      }
      time = target
      await flush()
    },
  }
}

export async function flush() {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

