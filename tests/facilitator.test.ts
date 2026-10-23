import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FACILITATOR_CODE,
  facilitatorCodeSource,
  generateFacilitatorCode,
  initFacilitatorCode,
  isFacilitatorCode,
  isProductionRuntime,
  resetFacilitatorCode,
  resolveFacilitatorCode,
} from '../server/utils/facilitator'

describe('resolveFacilitatorCode', () => {
  it('source env : FACILITATOR_CODE définie et non vide, en dev comme en production', () => {
    for (const dev of [true, false]) {
      const resolved = resolveFacilitatorCode({ FACILITATOR_CODE: 'secret' }, { dev })
      expect(resolved).toEqual({ source: 'env', code: 'secret' })
      expect(isFacilitatorCode('secret', resolved)).toBe(true)
      expect(isFacilitatorCode('animateur', resolved)).toBe(false)
      expect(isFacilitatorCode('Secret', resolved)).toBe(false)
    }
  })

  it.each([
    ['NODE_ENV=production, serveur dev', { NODE_ENV: 'production' }, true],
    ['NODE_ENV=production, serveur buildé', { NODE_ENV: 'production' }, false],
    ['sans NODE_ENV, serveur buildé', {}, false],
    ['FACILITATOR_CODE vide, serveur buildé', { FACILITATOR_CODE: '' }, false],
    ['FACILITATOR_CODE blanche, serveur buildé', { FACILITATOR_CODE: '  ' }, false],
  ])('source generated (%s) : « animateur » refusé', (_label, env, dev) => {
    const resolved = resolveFacilitatorCode(env, { dev, generate: () => 'abcdefghjk23' })
    expect(resolved).toEqual({ source: 'generated', code: 'abcdefghjk23' })
    expect(isFacilitatorCode(DEFAULT_FACILITATOR_CODE, resolved)).toBe(false)
    expect(isFacilitatorCode('abcdefghjk23', resolved)).toBe(true)
  })

  it.each([
    ['sans NODE_ENV', {}],
    ['NODE_ENV=development', { NODE_ENV: 'development' }],
    ['FACILITATOR_CODE vide', { FACILITATOR_CODE: '' }],
  ])('source default hors production (%s) : « animateur » accepté', (_label, env) => {
    const resolved = resolveFacilitatorCode(env, { dev: true })
    expect(resolved).toEqual({ source: 'default', code: DEFAULT_FACILITATOR_CODE })
    expect(isFacilitatorCode('animateur', resolved)).toBe(true)
    expect(isFacilitatorCode('faux', resolved)).toBe(false)
    expect(isFacilitatorCode('', resolved)).toBe(false)
  })

  it.each([[undefined], [null], [42], [['animateur']], [{ code: 'animateur' }]])('refuse un code non-chaîne (%j)', (code) => {
    expect(isFacilitatorCode(code, { source: 'default', code: DEFAULT_FACILITATOR_CODE })).toBe(false)
  })

  it('isProductionRuntime : NODE_ENV=production ou serveur buildé', () => {
    expect(isProductionRuntime({}, true)).toBe(false)
    expect(isProductionRuntime({ NODE_ENV: 'production' }, true)).toBe(true)
    expect(isProductionRuntime({}, false)).toBe(true)
  })
})

describe('generateFacilitatorCode', () => {
  it('produit un code lisible de 12 caractères, différent à chaque appel', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateFacilitatorCode()))
    expect(codes.size).toBe(50)
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{12}$/)
  })
})

describe('initFacilitatorCode', () => {
  afterEach(() => resetFacilitatorCode())

  it('mémorise la résolution et ne journalise le code généré qu\'une fois', () => {
    const logger = { log: vi.fn() }
    const first = initFacilitatorCode({}, { dev: false, logger })
    const second = initFacilitatorCode({ FACILITATOR_CODE: 'autre' }, { dev: false, logger })
    expect(second).toBe(first)
    expect(first.source).toBe('generated')
    expect(logger.log).toHaveBeenCalledTimes(1)
    expect(logger.log).toHaveBeenCalledWith(`Code animateur généré : ${first.code} — définissez FACILITATOR_CODE`)
    expect(facilitatorCodeSource()).toBe('generated')
    expect(isFacilitatorCode(first.code)).toBe(true)
    expect(isFacilitatorCode('animateur')).toBe(false)
  })

  it('ne journalise rien pour env et default', () => {
    const logger = { log: vi.fn() }
    expect(initFacilitatorCode({ FACILITATOR_CODE: 'secret' }, { dev: false, logger }).source).toBe('env')
    resetFacilitatorCode()
    expect(initFacilitatorCode({}, { dev: true, logger }).source).toBe('default')
    expect(logger.log).not.toHaveBeenCalled()
  })
})
