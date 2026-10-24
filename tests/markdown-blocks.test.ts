// 037 CA3 : parseur Markdown des guides de l'animateur
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownBlocks } from '../shared/utils/markdown-blocks'

const text = (value: string) => ({ type: 'text', text: value })

describe('parseMarkdownBlocks', () => {
  it('titres #, ## et ###', () => {
    expect(parseMarkdownBlocks('# Un\n\n## Deux\n\n### Trois')).toEqual([
      { type: 'heading', level: 1, content: [text('Un')] },
      { type: 'heading', level: 2, content: [text('Deux')] },
      { type: 'heading', level: 3, content: [text('Trois')] },
    ])
  })

  it('paragraphes : les lignes consécutives sont jointes, une ligne vide sépare', () => {
    expect(parseMarkdownBlocks('Première\nsuite.\n\nSecond.')).toEqual([
      { type: 'paragraph', content: [text('Première suite.')] },
      { type: 'paragraph', content: [text('Second.')] },
    ])
  })

  it('listes à puces et numérotées', () => {
    expect(parseMarkdownBlocks('- a\n- b\n\n1. un\n2. deux')).toEqual([
      { type: 'list', ordered: false, items: [[text('a')], [text('b')]] },
      { type: 'list', ordered: true, items: [[text('un')], [text('deux')]] },
    ])
  })

  it('tableau avec en-tête', () => {
    const blocks = parseMarkdownBlocks('| t | Auteur |\n| --- | --- |\n| 0:00 | **Sarah** |\n| 0:20 | `Alerting` |')
    expect(blocks).toEqual([{
      type: 'table',
      header: [[text('t')], [text('Auteur')]],
      rows: [
        [[text('0:00')], [{ type: 'strong', text: 'Sarah' }]],
        [[text('0:20')], [{ type: 'code', text: 'Alerting' }]],
      ],
    }])
  })

  it('gras et code en ligne', () => {
    expect(parseInline('a **b** et `c` d')).toEqual([text('a '), { type: 'strong', text: 'b' }, text(' et '), { type: 'code', text: 'c' }, text(' d')])
  })

  it('marqueur non fermé : texte littéral', () => {
    expect(parseInline('2 ** 3 et `x')).toEqual([text('2 ** 3 et `x')])
  })

  it('HTML : reste du texte littéral, jamais interprété', () => {
    const blocks = parseMarkdownBlocks('<script>alert(1)</script>\n\n<b>x</b>')
    expect(blocks).toEqual([
      { type: 'paragraph', content: [text('<script>alert(1)</script>')] },
      { type: 'paragraph', content: [text('<b>x</b>')] },
    ])
  })

  it('HTML dans une cellule de tableau, un titre ou une puce : texte', () => {
    const [table] = parseMarkdownBlocks('| a |\n| --- |\n| <b>x</b> |')
    expect(table).toEqual({ type: 'table', header: [[text('a')]], rows: [[[text('<b>x</b>')]]] })
    expect(parseMarkdownBlocks('## <i>t</i>\n\n- <u>p</u>')).toEqual([
      { type: 'heading', level: 2, content: [text('<i>t</i>')] },
      { type: 'list', ordered: false, items: [[text('<u>p</u>')]] },
    ])
  })
})
