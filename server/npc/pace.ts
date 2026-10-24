// Rythme de réponse des PNJ (019, évolution « rythme réaliste ») : en vrai, quelqu'un met plusieurs secondes,
// voire minutes, à répondre parce qu'il est occupé ailleurs. Trois modes ; une fiche peut surcharger le rythme
// de son PNJ (section « ## Disponibilité »). Module pur : l'aléa et l'échelle sont injectés.
import type { NpcPersona } from '../../shared/types/npc'
export type { NpcAvailability } from '../../shared/types/npc'
import { NPC_ACK_TEXTS } from './generic-phrases'

export type NpcPaceMode = 'instant' | 'realistic' | 'busy'

export const NPC_PACE_MODES: readonly NpcPaceMode[] = ['instant', 'realistic', 'busy']
/** Mode par défaut du déploiement ; les tests HTTP fixent `instant` (NPC_PACE) */
export const DEFAULT_NPC_PACE: NpcPaceMode = 'realistic'

/** Plages de délai (ms) par mode ; `instant` garde le comportement historique (1 à 2 s, ou NPC_REPLY_DELAY_MS) */
export const PACE_RANGES: Readonly<Record<NpcPaceMode, readonly [number, number]>> = {
  instant: [1000, 2000],
  realistic: [5000, 40_000],
  busy: [30_000, 180_000],
}

/** Libellés de /admin */
export const PACE_LABELS: Readonly<Record<NpcPaceMode, string>> = {
  instant: 'Instantané',
  realistic: 'Réaliste (5 à 40 s)',
  busy: 'Occupé (30 s à 3 min)',
}

/** Multiplicateurs des valeurs de `rythme:` d'une fiche */
export const PACE_FACTORS = { rapide: 0.5, normal: 1, lent: 2 } as const
export type NpcPaceFactorName = keyof typeof PACE_FACTORS

const ALIASES: Readonly<Record<string, NpcPaceMode>> = {
  instant: 'instant', instantane: 'instant', instantanee: 'instant', immediat: 'instant',
  realistic: 'realistic', realiste: 'realistic',
  busy: 'busy', occupe: 'busy', occupee: 'busy',
}

/** Mode nommé en français ou en anglais (casse et accents ignorés) ; undefined si inconnu */
export function parsePaceMode(raw: unknown): NpcPaceMode | undefined {
  if (typeof raw !== 'string') return undefined
  const key = raw.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : undefined
}

/** NPC_DELAY_SCALE : nombre ≥ 0 multipliant tous les délais (0 en test) ; 1 si absent ou invalide */
export function delayScaleFromEnv(raw: string | undefined): number {
  const text = raw?.trim() ?? ''
  const value = Number(text)
  return text !== '' && Number.isFinite(value) && value >= 0 ? value : 1
}

export interface PaceOptions {
  mode: NpcPaceMode
  /** Aléa dans [0, 1[ (défaut Math.random) */
  random?: () => number
  /** Échelle appliquée au délai tiré (défaut 1 ; 0 : aucun délai) */
  scale?: number
  /** Délai fixe en mode `instant` (NPC_REPLY_DELAY_MS), au lieu du tirage de 1 à 2 s */
  fixedInstantMs?: number
}

/**
 * Délai (ms) avant la publication d'une réponse de persona : tirage uniforme dans la plage du mode, ou dans
 * celle de la fiche (`délai:`), multipliée par `rythme:`. En mode `instant` la fiche est ignorée.
 */
export function pickDelayMs(persona: Pick<NpcPersona, 'availability'> | undefined, options: PaceOptions): number {
  const random = options.random ?? Math.random
  const scale = options.scale ?? 1
  if (options.mode === 'instant') {
    const base = options.fixedInstantMs ?? Math.floor(PACE_RANGES.instant[0] + random() * (PACE_RANGES.instant[1] - PACE_RANGES.instant[0]))
    return Math.round(base * scale)
  }
  const availability = persona?.availability
  const [min, max] = availability?.rangeSeconds
    ? [availability.rangeSeconds[0] * 1000, availability.rangeSeconds[1] * 1000]
    : PACE_RANGES[options.mode]
  const factor = availability?.factor ?? 1
  return Math.round((min + random() * (max - min)) * factor * scale)
}

/** Délai à partir duquel un PNJ peut afficher un accusé (« je regarde ») avant de répondre */
export const ACK_MIN_DELAY_MS = 20_000
/** L'accusé part au plus tôt à 2 s, au plus tard à 6 s */
const ACK_AT_MIN_MS = 2000
const ACK_AT_SPREAD_MS = 4000

export interface Acknowledgement {
  text: string
  /** Instant de publication, en ms après la sollicitation */
  atMs: number
}

/**
 * Accusé bref d'un PNJ « occupé » : seulement en mode `busy` et si la réponse est lointaine. Choisit une
 * formule absente de `already` (jamais deux fois la même) ; undefined si elles ont toutes servi.
 */
export function pickAcknowledgement(
  mode: NpcPaceMode,
  delayMs: number,
  already: readonly string[],
  options: { random?: () => number, scale?: number } = {},
): Acknowledgement | undefined {
  if (mode !== 'busy' || delayMs < ACK_MIN_DELAY_MS * (options.scale ?? 1) || (options.scale ?? 1) === 0) return undefined
  const random = options.random ?? Math.random
  const free = NPC_ACK_TEXTS.filter(text => !already.includes(text))
  if (free.length === 0) return undefined
  return {
    text: free[Math.floor(random() * free.length)]!,
    atMs: Math.round((ACK_AT_MIN_MS + random() * ACK_AT_SPREAD_MS) * (options.scale ?? 1)),
  }
}
