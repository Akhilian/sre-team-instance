import { describe, expect, it } from 'vitest'
import { clientIpFromForwardedFor, createRateLimiter, createWriteRateLimiter } from '../server/utils/rate-limit'
import { WRITE_RATE_IP_LIMIT, WRITE_RATE_LIMIT, WRITE_RATE_WINDOW_MS } from '../shared/utils/limits'

describe('createRateLimiter', () => {
  it('autorise limit requêtes par fenêtre, puis refuse avec Retry-After', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 10_000 })
    for (let index = 0; index < 3; index++) expect(limiter.hit('1.2.3.4', 1000).allowed).toBe(true)
    const refused = limiter.hit('1.2.3.4', 4000)
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSeconds).toBe(7)
    // Autre IP : compteur indépendant
    expect(limiter.hit('5.6.7.8', 4000).allowed).toBe(true)
    // Nouvelle fenêtre
    expect(limiter.hit('1.2.3.4', 11_000).allowed).toBe(true)
  })

  it('Retry-After vaut au moins 1 s', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 })
    limiter.hit('a', 0)
    expect(limiter.hit('a', 9_999).retryAfterSeconds).toBe(1)
  })

  it('purge les compteurs expirés', () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 10_000 })
    for (let index = 0; index < 50; index++) limiter.hit(`ip-${index}`, 20_000)
    expect(limiter.size()).toBe(50)
    limiter.hit('autre', 30_000)
    expect(limiter.size()).toBe(1)
  })
})

describe('clientIpFromForwardedFor', () => {
  it('prend la dernière entrée (ajoutée par le proxy), pas la première forgeable', () => {
    expect(clientIpFromForwardedFor('6.6.6.6, 203.0.113.9')).toBe('203.0.113.9')
    expect(clientIpFromForwardedFor(' 203.0.113.9 ')).toBe('203.0.113.9')
    expect(clientIpFromForwardedFor('1.1.1.1, ,')).toBe('1.1.1.1')
    expect(clientIpFromForwardedFor('')).toBeUndefined()
    expect(clientIpFromForwardedFor(undefined)).toBeUndefined()
  })
})

describe('createWriteRateLimiter', () => {
  it('limite par IP + auteur sans décompter de l\'IP les requêtes refusées', () => {
    const limiter = createWriteRateLimiter({ perAuthorLimit: 3, perIpLimit: 5, windowMs: 10_000 })
    for (let index = 0; index < 10; index++) limiter.hit('nat', 'Spam', 0)
    // Spam a consommé 3 places sur l'IP, il en reste 2 pour les autres
    expect(limiter.hit('nat', 'Spam', 0).allowed).toBe(false)
    expect(limiter.hit('nat', 'Alice', 0).allowed).toBe(true)
    expect(limiter.hit('nat', 'Bob', 0).allowed).toBe(true)
    // Plafond par IP atteint, même pour un auteur neuf
    expect(limiter.hit('nat', 'Carol', 0).allowed).toBe(false)
    expect(limiter.hit('autre-ip', 'Carol', 0).allowed).toBe(true)
  })

  it('40 participants derrière une IP, à 10 écritures par 10 s chacun, ne sont jamais refusés', () => {
    const limiter = createWriteRateLimiter({
      perAuthorLimit: WRITE_RATE_LIMIT,
      perIpLimit: WRITE_RATE_IP_LIMIT,
      windowMs: WRITE_RATE_WINDOW_MS,
    })
    let refused = 0
    // 30 s d'atelier, une écriture par participant et par seconde au pic
    for (let second = 0; second < 30; second++) {
      for (let participant = 0; participant < 40; participant++) {
        if (!limiter.hit('nat', `Participant ${participant}`, second * 1000).allowed) refused++
      }
    }
    expect(refused).toBe(0)
  })
})
