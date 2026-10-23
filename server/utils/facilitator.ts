// Code animateur : simple secret partagé (pas une vraie authentification). Résolu une fois par
// processus (plugin server/plugins/facilitator-code.ts au démarrage) : FACILITATOR_CODE si définie,
// sinon un code aléatoire en production (journalisé une fois), sinon « animateur » en dev.
// Module pur, testable directement avec Vitest (env, indicateur dev et aléa injectés).
import { type Env, processEnv } from './env'

export const DEFAULT_FACILITATOR_CODE = 'animateur'
/** Longueur du code généré en production */
export const GENERATED_CODE_LENGTH = 12
// Sans caractères ambigus à la lecture (0/o, 1/l/i)
const GENERATED_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export type FacilitatorCodeSource = 'env' | 'generated' | 'default'

export interface FacilitatorCode {
  source: FacilitatorCodeSource
  code: string
}

/** Production = NODE_ENV=production ou serveur buildé (dev faux) : Render ne définit pas forcément NODE_ENV. */
export function isProductionRuntime(env: Env, dev: boolean): boolean {
  return env.NODE_ENV === 'production' || !dev
}

/** Code lisible de `length` caractères tirés par crypto.getRandomValues (tirage par rejet, sans biais). */
export function generateFacilitatorCode(length = GENERATED_CODE_LENGTH): string {
  const alphabet = GENERATED_CODE_ALPHABET
  const limit = 256 - (256 % alphabet.length)
  let code = ''
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && code.length < length) code += alphabet[byte % alphabet.length]
    }
  }
  return code
}

/** Source et valeur du code ; une FACILITATOR_CODE vide (ou blanche) compte comme absente. */
export function resolveFacilitatorCode(
  env: Env,
  options: { dev: boolean, generate?: () => string },
): FacilitatorCode {
  const fromEnv = env.FACILITATOR_CODE
  if (fromEnv && fromEnv.trim() !== '') return { source: 'env', code: fromEnv }
  if (isProductionRuntime(env, options.dev)) {
    return { source: 'generated', code: (options.generate ?? generateFacilitatorCode)() }
  }
  return { source: 'default', code: DEFAULT_FACILITATOR_CODE }
}

let current: FacilitatorCode | undefined

/**
 * Résout le code du processus au premier appel, puis renvoie toujours le même ; un code généré
 * est écrit une seule fois dans les logs (le code n'est jamais exposé par l'API).
 */
export function initFacilitatorCode(
  env: Env = processEnv(),
  options: { dev: boolean, logger?: Pick<Console, 'log'> } = { dev: false },
): FacilitatorCode {
  if (current) return current
  current = resolveFacilitatorCode(env, options)
  if (current.source === 'generated') {
    (options.logger ?? console).log(`Code animateur généré : ${current.code} — définissez FACILITATOR_CODE`)
  }
  return current
}

/** Oublie la résolution mémorisée (tests). */
export function resetFacilitatorCode(): void {
  current = undefined
}

/** Source exposée par GET /api/health, sans le code. */
export function facilitatorCodeSource(): FacilitatorCodeSource {
  return initFacilitatorCode().source
}

/**
 * Vrai si code est le code animateur. Sans résolution explicite, celle du processus (résolue en
 * mode production par défaut si le plugin ne l'a pas encore fait : jamais « animateur » par accident).
 */
export function isFacilitatorCode(code: unknown, resolved: FacilitatorCode = initFacilitatorCode()): boolean {
  return typeof code === 'string' && code !== '' && code === resolved.code
}
