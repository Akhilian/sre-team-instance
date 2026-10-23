// H2 : écritures POST /api/* limitées par fenêtre de WRITE_RATE_WINDOW_MS, sinon 429 avec Retry-After :
// WRITE_RATE_LIMIT par IP + auteur, WRITE_RATE_IP_LIMIT par IP (atelier derrière un seul NAT).
// Exclus : /api/presence (battement toutes les 3 s, borné par sa purge) et /api/admin/* (animateur).
// Le corps (≤ BODY_MAX_BYTES, contrôlé avant) est lu ici pour l'auteur ; h3 le garde pour la route.
import { AUTHOR_MAX_LENGTH } from '~~/shared/utils/limits'

const limiter = createWriteRateLimiter({
  perAuthorLimit: WRITE_RATE_LIMIT,
  perIpLimit: WRITE_RATE_IP_LIMIT,
  windowMs: WRITE_RATE_WINDOW_MS,
})

/** author (messages, réactions) ou name (acquittement d'alerte) ; vide pour la création de canal */
function authorOf(path: string, body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  const raw = path.endsWith('/alert-status') ? record.name : record.author
  // Tronqué : la clé reste bornée quoi qu'envoie le client
  return typeof raw === 'string' ? raw.trim().slice(0, AUTHOR_MAX_LENGTH) : ''
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') return
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/') || path === '/api/presence' || path.startsWith('/api/admin/')) return

  // Derrière Render, dernière entrée de x-forwarded-for (celle du proxy), sinon l'adresse du socket
  const ip = clientIpFromForwardedFor(getRequestHeader(event, 'x-forwarded-for')) ?? getRequestIP(event) ?? 'inconnue'
  const body = await readBody(event).catch(() => null)
  const result = limiter.hit(ip, authorOf(path, body), Date.now())
  if (result.allowed) return
  setResponseHeader(event, 'Retry-After', result.retryAfterSeconds)
  throw createError({ statusCode: 429, message: 'Trop de requêtes, réessayez plus tard' })
})
