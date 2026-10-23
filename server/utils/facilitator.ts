// Code animateur : simple secret partagé (pas une vraie authentification), lu à chaque appel
// pour suivre FACILITATOR_CODE sans préfixe NUXT_. Module pur, testable directement avec Vitest.
export const DEFAULT_FACILITATOR_CODE = 'animateur'

type Env = Record<string, string | undefined>

// process.env sans dépendre de @types/node (absent du projet)
function processEnv(): Env {
  return (globalThis as { process?: { env: Env } }).process?.env ?? {}
}

/** Vrai si code est la chaîne FACILITATOR_CODE, ou « animateur » quand la variable est absente ou vide. */
export function isFacilitatorCode(code: unknown, env: Env = processEnv()): boolean {
  const expected = env.FACILITATOR_CODE || DEFAULT_FACILITATOR_CODE
  return typeof code === 'string' && code === expected
}
