import { describe, expect, it } from 'vitest'
import { mentionsName, splitMentions } from '../shared/utils/mentions'

const names = ['Alice', 'Alice Martin', 'Bob']

describe('splitMentions', () => {
  it('reconnaît une mention simple au milieu du texte', () => {
    expect(splitMentions('merci @Bob pour le fix', names)).toEqual([
      { type: 'text', value: 'merci ' },
      { type: 'mention', value: '@Bob', name: 'Bob' },
      { type: 'text', value: ' pour le fix' },
    ])
  })

  it('reconnaît une mention en début et en fin de texte', () => {
    expect(splitMentions('@Bob tu regardes ? cc @Alice', names)).toEqual([
      { type: 'mention', value: '@Bob', name: 'Bob' },
      { type: 'text', value: ' tu regardes ? cc ' },
      { type: 'mention', value: '@Alice', name: 'Alice' },
    ])
  })

  it('accepte une ponctuation juste après le nom', () => {
    expect(splitMentions('(@Bob), ok', names)).toEqual([
      { type: 'text', value: '(' },
      { type: 'mention', value: '@Bob', name: 'Bob' },
      { type: 'text', value: '), ok' },
    ])
  })

  it('préfère le nom à espaces au nom court', () => {
    expect(splitMentions('@Alice Martin go', names)).toEqual([
      { type: 'mention', value: '@Alice Martin', name: 'Alice Martin' },
      { type: 'text', value: ' go' },
    ])
  })

  it('ignore la casse et renvoie le nom connu', () => {
    expect(splitMentions('@bob ?', names)).toEqual([
      { type: 'mention', value: '@bob', name: 'Bob' },
      { type: 'text', value: ' ?' },
    ])
  })

  it('laisse en texte un @ ne correspondant à aucun nom connu', () => {
    expect(splitMentions('@inconnu salut', names)).toEqual([{ type: 'text', value: '@inconnu salut' }])
  })

  it('ne reconnaît pas un préfixe de mot (@Bobby)', () => {
    expect(splitMentions('@Bobby salut', names)).toEqual([{ type: 'text', value: '@Bobby salut' }])
  })

  it('ne reconnaît pas une adresse e-mail', () => {
    expect(splitMentions('cc ops@bob.fr', names)).toEqual([{ type: 'text', value: 'cc ops@bob.fr' }])
  })

  it('renvoie un seul segment texte sans mention', () => {
    expect(splitMentions('rien à signaler', names)).toEqual([{ type: 'text', value: 'rien à signaler' }])
    expect(splitMentions('', names)).toEqual([{ type: 'text', value: '' }])
  })
})

describe('mentionsName', () => {
  it('est vrai si une mention me désigne (casse indifférente)', () => {
    expect(mentionsName('@bob tu peux redémarrer ?', names, 'Bob')).toBe(true)
  })

  it('est faux si la mention désigne quelqu\'un d\'autre', () => {
    expect(mentionsName('@Alice tu peux redémarrer ?', names, 'Bob')).toBe(false)
    expect(mentionsName('écrire à ops@bob.fr', names, 'Bob')).toBe(false)
  })

  it('distingue « Alice » de « Alice Martin »', () => {
    expect(mentionsName('@Alice Martin go', names, 'Alice')).toBe(false)
  })

  it('est faux si me est vide', () => {
    expect(mentionsName('@Bob salut', names, '')).toBe(false)
  })
})
