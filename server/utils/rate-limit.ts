// Limiteur de débit en mémoire, à fenêtre fixe par clé (IP). Aucun timer : les compteurs expirés
// sont purgés au fil des appels. Module pur, horloge injectée par `now` (ms) pour les tests.
export interface RateLimitResult {
  allowed: boolean
  /** Secondes avant la fin de la fenêtre courante (en-tête Retry-After), au moins 1 */
  retryAfterSeconds: number
}

export interface RateLimiter {
  hit: (key: string, now: number) => RateLimitResult
  /** Nombre de clés suivies (tests) */
  size: () => number
  reset: () => void
}

export function createRateLimiter(options: { limit: number, windowMs: number }): RateLimiter {
  let windows = new Map<string, { start: number, count: number }>()
  let lastPurge = 0

  function purge(now: number): void {
    // Au plus une purge par fenêtre : coût amorti constant par requête
    if (now - lastPurge < options.windowMs) return
    lastPurge = now
    for (const [key, window] of windows) {
      if (now - window.start >= options.windowMs) windows.delete(key)
    }
  }

  function hit(key: string, now: number): RateLimitResult {
    purge(now)
    let window = windows.get(key)
    if (!window || now - window.start >= options.windowMs) {
      window = { start: now, count: 0 }
      windows.set(key, window)
    }
    window.count += 1
    const retryAfterSeconds = Math.max(1, Math.ceil((window.start + options.windowMs - now) / 1000))
    return { allowed: window.count <= options.limit, retryAfterSeconds }
  }

  return {
    hit,
    size: () => windows.size,
    reset: () => {
      windows = new Map()
      lastPurge = 0
    },
  }
}

/**
 * IP du client derrière le proxy Render : la DERNIÈRE entrée de x-forwarded-for, ajoutée par le
 * proxy (les précédentes viennent du client et peuvent être forgées). Undefined si l'en-tête est vide.
 */
export function clientIpFromForwardedFor(header: string | undefined): string | undefined {
  const entries = (header ?? '').split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  return entries.at(-1)
}

export interface WriteRateLimiter {
  /** author : auteur (ou nom) lu dans le corps, vide si absent */
  hit: (ip: string, author: string, now: number) => RateLimitResult
  reset: () => void
}

/**
 * Deux fenêtres fixes : IP + auteur (perAuthorLimit) puis IP seule (perIpLimit, plus large). Une requête
 * refusée sur sa clé IP + auteur n'est pas décomptée de l'IP : un participant qui s'emballe ne bloque
 * pas les autres participants derrière le même NAT.
 */
export function createWriteRateLimiter(options: { perAuthorLimit: number, perIpLimit: number, windowMs: number }): WriteRateLimiter {
  const byAuthor = createRateLimiter({ limit: options.perAuthorLimit, windowMs: options.windowMs })
  const byIp = createRateLimiter({ limit: options.perIpLimit, windowMs: options.windowMs })
  return {
    hit(ip, author, now) {
      // JSON : séparation sans ambiguïté entre IP et auteur
      const authorResult = byAuthor.hit(JSON.stringify([ip, author]), now)
      if (!authorResult.allowed) return authorResult
      return byIp.hit(ip, now)
    },
    reset() {
      byAuthor.reset()
      byIp.reset()
    },
  }
}
