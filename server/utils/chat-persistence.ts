// Persistance légère du store de chat : un instantané unique (clé chat-snapshot) dans un stockage
// unstorage choisi par l'environnement (REDIS_URL > CHAT_DATA_DIR > mémoire). Module pur (sans
// auto-import Nuxt), testable avec Vitest ; branché par server/plugins/chat-persistence.ts.
import { createStorage, type Storage } from 'unstorage'
import { DEFAULT_CHANNEL_IDS, exportSnapshot, importSnapshot } from './chat-store'
import { type Env, processEnv } from './env'

export const SNAPSHOT_KEY = 'chat-snapshot'
/** Délai maximal entre une mutation et l'écriture de l'instantané */
export const SAVE_DELAY_MS = 300
/** Au-delà, la réhydratation (ou la sauvegarde finale) est abandonnée : Redis injoignable, etc. */
export const STORAGE_TIMEOUT_MS = 5000
/** Intervalle entre deux tentatives de lecture quand le stockage est injoignable */
export const STORAGE_RETRY_MS = 5000

export type StorageConfig =
  | { driver: 'memory' }
  | { driver: 'fs', base: string }
  | { driver: 'redis', url: string }

export type StorageDriverName = StorageConfig['driver']

/** REDIS_URL prime sur CHAT_DATA_DIR ; une valeur vide (ou blanche) compte comme absente. */
export function resolveStorageConfig(env: Env): StorageConfig {
  const url = env.REDIS_URL?.trim()
  if (url) return { driver: 'redis', url }
  const base = env.CHAT_DATA_DIR?.trim()
  if (base) return { driver: 'fs', base }
  return { driver: 'memory' }
}

/** Stockage unstorage du driver configuré ; fs et redis sont chargés à la demande. */
export async function createChatStorage(config: StorageConfig): Promise<Storage> {
  if (config.driver === 'redis') {
    const { default: redisDriver } = await import('unstorage/drivers/redis')
    // Pas de file d'attente infinie si Redis tombe : une commande échoue après quelques tentatives
    const driver = redisDriver({ url: config.url, maxRetriesPerRequest: 2 })
    const client = driver.getInstance?.() as RedisEvents | undefined
    if (client) watchRedisErrors(client)
    return createStorage({ driver })
  }
  if (config.driver === 'fs') {
    const { default: fsDriver } = await import('unstorage/drivers/fs')
    return createStorage({ driver: fsDriver({ base: config.base }) })
  }
  return createStorage()
}

/** Sous-ensemble des événements d'un client ioredis utilisé ici */
export interface RedisEvents {
  on: (event: 'error' | 'ready', listener: (error?: unknown) => void) => unknown
}

/**
 * Remplace le « Unhandled error event » répété d'ioredis : une seule ligne par panne, puis une
 * ligne au retour de la connexion.
 */
export function watchRedisErrors(client: RedisEvents, logger: Pick<Console, 'warn'> = console): void {
  let failing = false
  client.on('error', (error) => {
    if (failing) return
    failing = true
    logger.warn('[chat-persistence] connexion Redis en échec (journalisé une fois jusqu\'au retour)', error)
  })
  client.on('ready', () => {
    if (!failing) return
    failing = false
    logger.warn('[chat-persistence] connexion Redis rétablie')
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai de ${ms} ms dépassé`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export interface ChatPersistenceOptions {
  saveDelayMs?: number
  timeoutMs?: number
  /** Intervalle entre deux tentatives de lecture après un échec */
  retryMs?: number
  logger?: Pick<Console, 'warn' | 'error'>
}

export interface ChatPersistence {
  /** Première lecture de l'instantané ; true s'il a été importé. Ne lève jamais. */
  hydrate: () => Promise<boolean>
  /** Programme une sauvegarde différée (au plus saveDelayMs après le premier appel). */
  scheduleSave: () => void
  /** Écrit l'instantané tout de suite (annule la sauvegarde programmée). Ne lève jamais. */
  flush: () => Promise<void>
  /** Annule les minuteries (sauvegarde programmée, nouvelle tentative de lecture). */
  stop: () => void
  /** Vrai dès qu'une lecture a réussi : tant que c'est faux, aucune écriture n'est faite. */
  canWrite: () => boolean
}

/**
 * Store vierge : aucun message et aucun canal hors canaux par défaut. Un canal créé pendant une
 * panne de lecture, même sans message, rend le store non vierge (il ne doit pas être écrasé).
 */
function storeIsPristine(): boolean {
  const snapshot = exportSnapshot()
  if (snapshot.channels.some(channel => !DEFAULT_CHANNEL_IDS.includes(channel.id))) return false
  return Object.values(snapshot.messages).every(list => list.length === 0)
}

/**
 * Tant qu'aucune lecture n'a réussi (erreur, délai dépassé), les écritures sont suspendues pour ne
 * pas écraser un instantané existant, et la lecture est retentée toutes les retryMs. « Pas
 * d'instantané » ou « instantané invalide » comptent comme des lectures réussies.
 */
export function createChatPersistence(storage: Storage, options: ChatPersistenceOptions = {}): ChatPersistence {
  const saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS
  const timeoutMs = options.timeoutMs ?? STORAGE_TIMEOUT_MS
  const retryMs = options.retryMs ?? STORAGE_RETRY_MS
  const logger = options.logger ?? console
  let timer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let readSucceeded = false
  // Mutation survenue pendant la suspension : à sauvegarder dès que la lecture réussit
  let pending = false
  let stopped = false
  // Une seule ligne par série d'échecs de lecture, pas une toutes les retryMs
  let readFailing = false
  // Écritures chaînées : jamais deux setItem concurrents, le dernier écrit l'emporte
  let writing: Promise<void> = Promise.resolve()

  async function read(): Promise<{ ok: true, data: unknown } | { ok: false }> {
    try {
      const data = await withTimeout(storage.getItem(SNAPSHOT_KEY), timeoutMs, 'lecture de l\'instantané')
      readFailing = false
      return { ok: true, data }
    }
    catch (error) {
      if (readFailing) return { ok: false }
      readFailing = true
      logger.warn(`[chat-persistence] lecture de l'instantané impossible, écritures suspendues (nouvel essai dans ${retryMs} ms)`, error)
      return { ok: false }
    }
  }

  function scheduleRetry(): void {
    if (stopped || retryTimer !== undefined) return
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void retry()
    }, retryMs)
  }

  async function retry(): Promise<void> {
    const result = await read()
    if (!result.ok) return scheduleRetry()
    readSucceeded = true
    if (result.data !== null) {
      // Store local vierge (ni message ni canal créé pendant la panne) : l'instantané distant fait foi
      if (storeIsPristine() && importSnapshot(result.data)) {
        logger.warn('[chat-persistence] lecture rétablie, instantané importé')
      }
      else {
        logger.warn('[chat-persistence] lecture rétablie, état local conservé (il remplacera l\'instantané)')
      }
    }
    if (pending) {
      pending = false
      void save()
    }
  }

  async function hydrate(): Promise<boolean> {
    const result = await read()
    if (!result.ok) {
      scheduleRetry()
      return false
    }
    readSucceeded = true
    if (result.data === null) return false
    if (importSnapshot(result.data)) return true
    logger.warn('[chat-persistence] instantané invalide ignoré, état initial conservé')
    return false
  }

  function save(): Promise<void> {
    writing = writing.then(async () => {
      try {
        await withTimeout(storage.setItem(SNAPSHOT_KEY, exportSnapshot()), timeoutMs, 'écriture de l\'instantané')
      }
      catch (error) {
        logger.error('[chat-persistence] écriture de l\'instantané impossible', error)
      }
    })
    return writing
  }

  function scheduleSave(): void {
    if (!readSucceeded) {
      pending = true
      return
    }
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void save()
    }, saveDelayMs)
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!readSucceeded) {
      if (pending) logger.warn('[chat-persistence] aucune lecture réussie : instantané non écrit à l\'arrêt')
      return writing
    }
    return save()
  }

  function stop(): void {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    timer = undefined
    retryTimer = undefined
  }

  return { hydrate, scheduleSave, flush, stop, canWrite: () => readSucceeded }
}

// État du serveur en cours : promesse de réhydratation attendue par le middleware des routes /api/
let hydration: Promise<unknown> = Promise.resolve()

export function setChatHydration(promise: Promise<unknown>): void {
  hydration = promise
}

export function whenChatHydrated(): Promise<unknown> {
  return hydration
}

/** Driver configuré (pas l'état de la connexion) : exposé par GET /api/health. */
export function configuredStorageDriver(env: Env = processEnv()): StorageDriverName {
  return resolveStorageConfig(env).driver
}
