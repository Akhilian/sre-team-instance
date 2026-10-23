// Accès à l'environnement du processus, partagé par les modules serveur purs (testables avec Vitest).

export type Env = Record<string, string | undefined>

// process.env sans dépendre de @types/node (absent du projet)
export function processEnv(): Env {
  return (globalThis as { process?: { env: Env } }).process?.env ?? {}
}
