import { describe, expect, it } from 'vitest'
import { isFacilitatorCode } from '../server/utils/facilitator'

describe('isFacilitatorCode', () => {
  it('accepte « animateur » quand FACILITATOR_CODE est absente ou vide', () => {
    expect(isFacilitatorCode('animateur', {})).toBe(true)
    expect(isFacilitatorCode('animateur', { FACILITATOR_CODE: '' })).toBe(true)
    expect(isFacilitatorCode('faux', {})).toBe(false)
    expect(isFacilitatorCode('', {})).toBe(false)
  })

  it('accepte la valeur de FACILITATOR_CODE et refuse alors l\'ancien défaut', () => {
    const env = { FACILITATOR_CODE: 'secret' }
    expect(isFacilitatorCode('secret', env)).toBe(true)
    expect(isFacilitatorCode('animateur', env)).toBe(false)
    expect(isFacilitatorCode('Secret', env)).toBe(false)
  })

  it.each([[undefined], [null], [42], [['animateur']], [{ code: 'animateur' }]])('refuse un code non-chaîne (%j)', (code) => {
    expect(isFacilitatorCode(code, {})).toBe(false)
  })
})

describe('isFacilitatorCode sans env explicite', () => {
  it('lit process.env.FACILITATOR_CODE à chaque appel', () => {
    const previous = process.env.FACILITATOR_CODE
    try {
      delete process.env.FACILITATOR_CODE
      expect(isFacilitatorCode('animateur')).toBe(true)
      process.env.FACILITATOR_CODE = 'secret'
      expect(isFacilitatorCode('animateur')).toBe(false)
      expect(isFacilitatorCode('secret')).toBe(true)
    }
    finally {
      if (previous === undefined) delete process.env.FACILITATOR_CODE
      else process.env.FACILITATOR_CODE = previous
    }
  })
})
