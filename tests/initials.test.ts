import { describe, expect, it } from 'vitest'
import { avatarColor, formatTime, initials } from '../app/utils/initials'

describe('initials', () => {
  it('prend la première lettre du prénom et du nom', () => {
    expect(initials('Alice Martin')).toBe('AM')
  })

  it('met en majuscule un nom d\'un seul mot', () => {
    expect(initials('bob')).toBe('B')
  })

  it('ignore les espaces superflus', () => {
    expect(initials('   alice    martin  ')).toBe('AM')
  })

  it('garde au plus 2 lettres (premier et dernier mot)', () => {
    expect(initials('jean claude van damme')).toBe('JD')
  })

  it('renvoie un repli pour un nom vide', () => {
    expect(initials('   ')).toBe('?')
  })
})

describe('avatarColor', () => {
  it('est stable pour un même nom', () => {
    expect(avatarColor('Alice Martin')).toBe(avatarColor('Alice Martin'))
    expect(avatarColor('Alice Martin')).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('formatTime', () => {
  it('formate en HH:MM heure de Paris', () => {
    expect(formatTime('2026-01-15T08:05:00.000Z')).toBe('09:05')
    expect(formatTime('2026-07-15T21:30:00.000Z')).toBe('23:30')
  })
})
