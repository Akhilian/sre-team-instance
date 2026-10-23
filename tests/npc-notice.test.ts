// 023 CA1 : avis local quand on s'adresse à des PNJ coupés
import { describe, expect, it } from 'vitest'
import { npcNoticeFor } from '../app/utils/npc-notice'

const npcNames = ['Julien Moreau', 'Marc Lefort', 'Sarah Benali']
const off = { enabled: false, npcNames }

describe('npcNoticeFor', () => {
  it('PNJ actifs : null, même avec une mention ou en conversation directe', () => {
    expect(npcNoticeFor('@Julien Moreau tu es là ?', { enabled: true, npcNames })).toBeNull()
    expect(npcNoticeFor('Bonjour', { enabled: true, npcNames, directNpcName: 'Julien Moreau' })).toBeNull()
  })

  it('PNJ coupés, deux mentions : les deux noms dans l\'ordre du texte', () => {
    const notice = npcNoticeFor('@Julien Moreau et @Marc Lefort ?', off)
    expect(notice).toBe('Les PNJ ne sont pas actifs pour le moment : Julien Moreau et Marc Lefort ne répondront pas.')
    expect(notice!.indexOf('Julien Moreau')).toBeLessThan(notice!.indexOf('Marc Lefort'))
  })

  it('PNJ coupés, une mention : phrase au singulier', () => {
    expect(npcNoticeFor('@Julien Moreau tu es là ?', off)).toBe('Les PNJ ne sont pas actifs pour le moment : Julien Moreau ne répondra pas.')
  })

  it('PNJ coupés, sans mention de PNJ ou avec la mention d\'un participant : null', () => {
    expect(npcNoticeFor('Quelqu\'un regarde le checkout ?', off)).toBeNull()
    expect(npcNoticeFor('@Bob tu regardes ?', off)).toBeNull()
    expect(npcNoticeFor('écrire à julien moreau', off)).toBeNull()
  })

  it('PNJ coupés, conversation directe sans mention : le PNJ de la conversation', () => {
    expect(npcNoticeFor('Quel déploiement récent ?', { ...off, directNpcName: 'Julien Moreau' }))
      .toBe('Les PNJ ne sont pas actifs pour le moment : Julien Moreau ne répondra pas.')
  })

  it('même mention répétée (ou PNJ de la conversation mentionné) : nom cité une seule fois', () => {
    const notice = npcNoticeFor('@Julien Moreau ? @julien moreau ?', off)!
    expect(notice.match(/Julien Moreau/g)).toHaveLength(1)
    const direct = npcNoticeFor('@Julien Moreau ?', { ...off, directNpcName: 'Julien Moreau' })!
    expect(direct.match(/Julien Moreau/g)).toHaveLength(1)
  })
})
