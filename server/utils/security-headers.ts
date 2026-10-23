// En-têtes de sécurité et CSP à nonce. Module pur (sans auto-import Nuxt), testable avec Vitest ;
// branché par server/plugins/security-headers.ts.

/** Posés sur toutes les réponses, pages comme API, erreurs comprises */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

/** Nonce de 16 octets aléatoires, en base64 (un par page rendue) */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

/**
 * CSP d'une page : scripts limités à l'origine et aux balises portant le nonce ; 'unsafe-inline'
 * reste nécessaire pour les styles (CSS en ligne de Nuxt, attributs style rendus par :style).
 */
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src 'self'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')
}

/** Ajoute nonce="…" à chaque balise <script> d'un fragment HTML qui n'en a pas déjà un. */
export function addScriptNonce(fragment: string, nonce: string): string {
  return fragment.replace(/<script(?=[\s>])(?![^>]*\snonce=)/gi, `<script nonce="${nonce}"`)
}
