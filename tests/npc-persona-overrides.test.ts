// 026 CA1 : couche des fiches modifiées en ligne (validation d'une édition, fusion avec la source,
// rechargement, retour à l'original) et numéros de ligne des erreurs du parseur
import { describe, expect, it } from 'vitest'
import { createPersonaLayer, mergePersonaOverrides } from '../server/npc/persona-overrides'
import { PersonaParseError, parsePersona } from '../server/npc/persona-parser'
import { checkPersonaFile, PERSONA_FILE_MAX_BYTES, type PersonaFile } from '../server/npc/persona-source'
import { bodyMaxBytesFor, BODY_MAX_BYTES, PERSONA_EDIT_BODY_MAX_BYTES, PERSONA_EDIT_PATH } from '../shared/utils/limits'

function persona(id: string, name: string, extra = ''): string {
  return `---
id: ${id}
name: ${name}
role: Rôle de ${name}
scenario: demo
tone: Bonjour :
personality: Calme et méthodique.
deflection: Je ne sais pas.
---
## Sait
- Une information de ${id}.${extra}
## Ignore
- Le reste.
## Sur question précise
- [mots: rollback, retour arrière] Le détail.
`
}

function file(id: string, name: string, extra = ''): PersonaFile {
  return checkPersonaFile(`demo/${id}.md`, persona(id, name, extra), [])
}

function layer() {
  return createPersonaLayer([file('alpha', 'Alpha Un'), file('beta', 'Beta Deux')])
}

const names = (files: readonly PersonaFile[]) => files.map(entry => entry.persona.name)

describe('édition d\'une fiche (CA1)', () => {
  it('une modification valide remplace la fiche en service', () => {
    const personas = layer()
    const result = personas.edit('demo/alpha.md', persona('alpha', 'Alpha Modifié', ' MARQUEUR'))
    expect(result.ok).toBe(true)
    expect(names(personas.served())).toEqual(['Alpha Modifié', 'Beta Deux'])
    expect(personas.served()[0]!.persona.knows[0]).toContain('MARQUEUR')
    expect(personas.isModified('demo/alpha.md')).toBe(true)
    expect(personas.isModified('demo/beta.md')).toBe(false)
    // La source reste à part
    expect(names(personas.source())).toEqual(['Alpha Un', 'Beta Deux'])
  })

  it('refuse sans rien changer : path inconnu, id différent du chemin, nom pris, texte trop gros', () => {
    const personas = layer()
    const before = personas.served()
    const cases = [
      { path: '../etc/passwd', markdown: persona('alpha', 'Alpha Un'), status: 404 },
      { path: 'demo/inconnu.md', markdown: persona('inconnu', 'Inconnu'), status: 404 },
      { path: 'demo/alpha.md', markdown: persona('gamma', 'Alpha Un'), status: 422, message: /id « gamma »/ },
      { path: 'demo/alpha.md', markdown: persona('alpha', 'BETA deux'), status: 422, message: /nom « BETA deux » déjà pris par demo\/beta\.md/ },
      { path: 'demo/alpha.md', markdown: persona('alpha', 'Alpha Un', ` ${'x'.repeat(PERSONA_FILE_MAX_BYTES)}`), status: 413 },
    ]
    for (const { path, markdown, status, message } of cases) {
      const result = personas.edit(path, markdown)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.status).toBe(status)
      if (message) expect(result.errors[0]!.message).toMatch(message)
    }
    expect(personas.served()).toEqual(before)
    expect(personas.isModified('demo/alpha.md')).toBe(false)
  })

  it('garde son propre nom (casse changée) et une fiche sans name nomme le champ', () => {
    const personas = layer()
    expect(personas.edit('demo/alpha.md', persona('alpha', 'ALPHA UN')).ok).toBe(true)
    const result = personas.edit('demo/beta.md', persona('beta', 'x').replace(/^name: .*\n/m, ''))
    expect(result).toMatchObject({ ok: false, status: 422 })
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain('champ « name » manquant')
      expect(result.errors[0]!.line).toBeUndefined()
    }
  })

  it('une puce « Sur question précise » sans [mots: …] à la ligne 14 : line === 14', () => {
    const lines = persona('alpha', 'Alpha Un').split('\n')
    // Ligne 12 : « ## Sur question précise », ligne 13 : une puce valide, ligne 14 : la puce invalide
    lines.splice(11, 0, '## Sur question précise', '- [mots: a, b] Valide.', '- Puce sans déclencheurs.')
    const markdown = lines.join('\r\n')
    expect(markdown.split('\r\n')[13]).toBe('- Puce sans déclencheurs.')
    let caught: unknown
    try {
      parsePersona(markdown, 'demo/alpha.md')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PersonaParseError)
    expect((caught as PersonaParseError).line).toBe(14)
    expect((caught as PersonaParseError).message).toContain('ligne 14')

    const result = layer().edit('demo/alpha.md', markdown)
    expect(result).toMatchObject({ ok: false, status: 422, errors: [{ line: 14 }] })
  })

  it('une ligne de front-matter invalide donne sa ligne', () => {
    const markdown = persona('alpha', 'Alpha Un').replace('tone: Bonjour :', 'tone Bonjour')
    expect(() => parsePersona(markdown)).toThrow(/ligne 6 : ligne de front-matter invalide/)
  })
})

describe('rechargement et retour à l\'original (CA1)', () => {
  it('après un rechargement, la version modifiée reste prioritaire ; revert remet l\'original', () => {
    const personas = layer()
    expect(personas.edit('demo/alpha.md', persona('alpha', 'Alpha Un', ' MODIFIÉ')).ok).toBe(true)
    personas.setSource([file('alpha', 'Alpha Un', ' RELU'), file('beta', 'Beta Deux', ' RELU')])
    const served = personas.served()
    expect(served[0]!.persona.knows[0]).toContain('MODIFIÉ')
    expect(served[1]!.persona.knows[0]).toContain('RELU')

    const reverted = personas.revert('demo/alpha.md')
    expect(reverted.ok).toBe(true)
    if (reverted.ok) expect(reverted.file.persona.knows[0]).toContain('RELU')
    expect(personas.served()[0]!.persona.knows[0]).toContain('RELU')
    expect(personas.isModified('demo/alpha.md')).toBe(false)
    // Plus de version modifiée : 404
    expect(personas.revert('demo/alpha.md')).toMatchObject({ ok: false, status: 404 })
  })

  it('une fiche modifiée dont l\'original a disparu reste en service ; revert répond 409', () => {
    const personas = layer()
    expect(personas.edit('demo/beta.md', persona('beta', 'Beta Deux', ' MODIFIÉ')).ok).toBe(true)
    personas.setSource([file('alpha', 'Alpha Un')])
    expect(names(personas.served())).toEqual(['Alpha Un', 'Beta Deux'])
    expect(personas.revert('demo/beta.md')).toMatchObject({ ok: false, status: 409 })
    expect(personas.isModified('demo/beta.md')).toBe(true)
  })

  it('une fiche de la source dont le nom est pris par une fiche modifiée est écartée', () => {
    const overrides = new Map([['demo/alpha.md', file('alpha', 'Gamma Trois')]])
    const merged = mergePersonaOverrides([file('alpha', 'Alpha Un'), file('gamma', 'gamma trois')], overrides)
    expect(names(merged)).toEqual(['Gamma Trois'])
  })
})

describe('limite de corps de la route d\'édition', () => {
  it('40 Ko pour PUT /api/admin/npc-personas/edit seulement, 16 Ko ailleurs', () => {
    expect(bodyMaxBytesFor('PUT', PERSONA_EDIT_PATH)).toBe(PERSONA_EDIT_BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('put', `${PERSONA_EDIT_PATH}?x=1`)).toBe(PERSONA_EDIT_BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('POST', PERSONA_EDIT_PATH)).toBe(BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('PUT', `${PERSONA_EDIT_PATH}/x`)).toBe(BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('PUT', '/api/admin/npc-personas/reload')).toBe(BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('POST', '/api/channels')).toBe(BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('PATCH', '/api/channels')).toBe(BODY_MAX_BYTES)
    expect(bodyMaxBytesFor('GET', '/api/channels')).toBeUndefined()
    expect(bodyMaxBytesFor('POST', '/channels')).toBeUndefined()
  })
})
