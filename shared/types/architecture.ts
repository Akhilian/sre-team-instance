// Modèle d'architecture exposé à l'animateur (GET /api/admin/architecture) : jamais de secret,
// d'identifiant d'URL, de chemin ni de contenu de fiche

import type { LastModelCall } from './npc'

export type ArchitectureHosting = 'kubernetes' | 'render' | 'local'

export type ArchitectureStorageDriver = 'memory' | 'fs' | 'redis'

export interface ArchitectureComponent {
  id: string
  label: string
  /** Légende française d'une ligne */
  legend: string
  active: boolean
}

export interface ArchitectureLink {
  /** Id d'un composant */
  from: string
  /** Id d'un composant */
  to: string
  label: string
}

export interface ArchitectureModel {
  hosting: ArchitectureHosting
  /** host : hôte et port de Redis seulement */
  storage: { driver: ArchitectureStorageDriver, host?: string }
  npcEngine: {
    name: string
    model?: string
    host?: string
    lastModelCall: LastModelCall | null
  }
  npcs: {
    enabled: boolean
    /** Noms des PNJ actifs (vide si les PNJ sont coupés) */
    active: string[]
    scenarioId: string
    spontaneous: boolean
  }
  /** Étape = nombre d'étapes publiées ; null sans exécution */
  scenario: { id: string, title: string, status: string, step: number, totalSteps: number } | null
  personas: { source: 'embedded' | 'directory', count: number }
  components: ArchitectureComponent[]
  links: ArchitectureLink[]
}
