// Fiches réelles lues sur disque (le parseur reste pur : il prend une chaîne)
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NpcPersona } from '../shared/types/npc'
import { parsePersona } from '../server/npc/persona-parser'

/** Scénario dont les fiches sont lues par défaut */
export const DEFAULT_PERSONAS_SCENARIO = 'panne-checkout'

/** Dossier des fiches d'un scénario : server/npc/personas/<scénario> */
export function personasDir(scenario = DEFAULT_PERSONAS_SCENARIO): string {
  return resolve(import.meta.dirname, '../server/npc/personas', scenario)
}

export const PERSONAS_DIR = personasDir()

export function personaFiles(scenario = DEFAULT_PERSONAS_SCENARIO): string[] {
  return readdirSync(personasDir(scenario)).filter(file => file.endsWith('.md')).sort()
}

export function readPersonaSource(file: string, scenario = DEFAULT_PERSONAS_SCENARIO): string {
  return readFileSync(resolve(personasDir(scenario), file), 'utf8')
}

export function loadPersonas(scenario = DEFAULT_PERSONAS_SCENARIO): NpcPersona[] {
  return personaFiles(scenario).map(file => parsePersona(readPersonaSource(file, scenario), file))
}

export function personaById(id: string, scenario = DEFAULT_PERSONAS_SCENARIO): NpcPersona {
  const persona = loadPersonas(scenario).find(candidate => candidate.id === id)
  if (!persona) throw new Error(`fiche ${id} introuvable dans ${scenario}`)
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
  for (let index = 0; index < 50; index++) await Promise.resolve()
}

