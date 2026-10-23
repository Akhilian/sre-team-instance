// 025 CA1 et CA2 : lecture des fiches dans un dossier (temporaire, vrai fs/promises), fusion d'un
// rechargement et remplacement à chaud dans le dispatcher ; 029 CA5 : id unique tous scénarios, nom
// d'au plus 50 caractères (chargement, rechargement, édition), NPC_ENGINE en sync: false
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { createPersonaLayer } from '../server/npc/persona-overrides'
import {
  mergePersonaReload,
  PERSONA_FILE_MAX_BYTES,
  PERSONA_FILES_MAX,
  type PersonaFile,
  readEmbeddedPersonas,
  readPersonaDir,
} from '../server/npc/persona-source'
import { addMessage, resetChatStore } from '../server/utils/chat-store'
import { AUTHOR_MAX_LENGTH } from '../shared/utils/limits'
import { fakeClock, loadPersonas } from './npc-helpers'

function persona(id: string, name: string, scenario = 'demo'): string {
  return `---
id: ${id}
name: ${name}
role: Rôle de ${name}
scenario: ${scenario}
tone: Bonjour :
personality: Calme et méthodique.
deflection: Je ne sais pas.
---
## Sait
- Une information de ${id}.
## Ignore
- Le reste.
## Sur question précise
- [mots: rollback, retour arrière] Le détail.
`
}

let root: string
let outside: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'npc-personas-'))
  outside = await fs.mkdtemp(join(tmpdir(), 'npc-outside-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

async function write(path: string, content: string) {
  await fs.mkdir(join(root, path, '..'), { recursive: true })
  await fs.writeFile(join(root, path), content)
}

describe('readPersonaDir (CA1)', () => {
  it('charge les fiches valides avec leur markdown et refuse les autres en nommant leur chemin', async () => {
    await write('demo/alpha.md', persona('alpha', 'Alpha Un'))
    await write('demo/beta.md', persona('beta', 'Beta Deux'))
    // Trop gros (valide par ailleurs)
    await write('demo/big.md', persona('big', 'Gros Fichier') + `\n${'x'.repeat(PERSONA_FILE_MAX_BYTES)}\n`)
    await write('demo/Bad_Name.md', persona('Bad_Name', 'Mauvais Nom'))
    // Lien symbolique vers une fiche hors du dossier
    await fs.writeFile(join(outside, 'evil.md'), persona('evil', 'Hors Dossier'))
    await fs.symlink(join(outside, 'evil.md'), join(root, 'demo/evil.md'))
    await write('demo/gamma.md', persona('autre-id', 'Gamma Trois'))
    // Même nom que alpha (casse ignorée), trié après lui
    await write('demo/zeta.md', persona('zeta', 'ALPHA UN'))
    // Ignorés sans erreur : extension autre, fichier caché, fichier à la racine
    await write('demo/notes.txt', 'rien')
    await write('demo/.cache.md', 'rien')
    await write('racine.md', persona('racine', 'Racine'))

    const result = await readPersonaDir(root, fs)
    expect(result.files.map(file => file.path)).toEqual(['demo/alpha.md', 'demo/beta.md'])
    expect(result.files[0]!.markdown).toBe(persona('alpha', 'Alpha Un'))
    expect(result.files[1]!.persona).toMatchObject({ id: 'beta', name: 'Beta Deux', scenarioId: 'demo' })

    const errors = new Map(result.errors.map(error => [error.path, error.message]))
    expect([...errors.keys()].sort()).toEqual(['demo/Bad_Name.md', 'demo/big.md', 'demo/evil.md', 'demo/gamma.md', 'demo/zeta.md'])
    for (const [path, message] of errors) expect(message).toContain(path)
    expect(errors.get('demo/big.md')).toMatch(/32 Ko/)
    expect(errors.get('demo/Bad_Name.md')).toMatch(/nom de fichier invalide/)
    expect(errors.get('demo/evil.md')).toMatch(/hors de NPC_PERSONAS_DIR/)
    expect(errors.get('demo/gamma.md')).toMatch(/différent du chemin/)
    expect(errors.get('demo/zeta.md')).toMatch(/déjà pris par demo\/alpha\.md/)
  })

  it('refuse un dossier de scénario qui sort du dossier par lien symbolique, ou mal nommé', async () => {
    await fs.mkdir(join(outside, 'demo'))
    await fs.writeFile(join(outside, 'demo/alpha.md'), persona('alpha', 'Alpha Un'))
    await fs.symlink(join(outside, 'demo'), join(root, 'demo'))
    await write('Autre_Scenario/beta.md', persona('beta', 'Beta Deux', 'Autre_Scenario'))
    await write('ok/gamma.md', persona('gamma', 'Gamma', 'ok'))

    const result = await readPersonaDir(root, fs)
    expect(result.files.map(file => file.path)).toEqual(['ok/gamma.md'])
    expect(result.errors.map(error => error.path).sort()).toEqual(['Autre_Scenario/', 'demo/'])
    expect(result.errors.find(error => error.path === 'demo/')!.message).toMatch(/hors de NPC_PERSONAS_DIR/)
  })

  it('accepte un lien symbolique qui reste dans le dossier, et un dossier donné par un lien', async () => {
    await write('demo/alpha.md', persona('alpha', 'Alpha Un'))
    await fs.mkdir(join(root, 'stock'))
    await fs.writeFile(join(root, 'stock/source.txt'), persona('beta', 'Beta Deux'))
    await fs.symlink(join(root, 'stock/source.txt'), join(root, 'demo/beta.md'))
    const link = join(outside, 'lien')
    await fs.symlink(root, link)

    const result = await readPersonaDir(link, fs)
    expect(result.files.map(file => file.path)).toEqual(['demo/alpha.md', 'demo/beta.md'])
    expect(result.errors).toEqual([])
  })

  it(`lit au plus ${PERSONA_FILES_MAX} fiches`, async () => {
    for (let index = 0; index < PERSONA_FILES_MAX + 2; index++) {
      const id = `p${String(index).padStart(2, '0')}`
      await write(`demo/${id}.md`, persona(id, `Nom ${id}`))
    }
    const result = await readPersonaDir(root, fs)
    expect(result.files).toHaveLength(PERSONA_FILES_MAX)
    expect(result.errors.map(error => error.path)).toEqual(['demo/p50.md', 'demo/p51.md'])
  })

  it('un dossier inexistant donne une erreur, sans exception', async () => {
    const result = await readPersonaDir(join(root, 'absent'), fs)
    expect(result.files).toEqual([])
    expect(result.errors).toEqual([{ path: '.', message: 'dossier des fiches illisible : ENOENT' }])
    // Un fichier à la place du dossier
    await write('fichier.md', 'x')
    expect((await readPersonaDir(join(root, 'fichier.md'), fs)).errors[0]!.message).toMatch(/illisible/)
  })
})

describe('readEmbeddedPersonas', () => {
  it('applique les mêmes validations aux clés <scénario>:<id>.md', async () => {
    const items: Record<string, unknown> = {
      'demo:alpha.md': persona('alpha', 'Alpha Un'),
      'demo:beta.md': persona('autre', 'Beta'),
      'demo:gamma.md': 42,
      'demo:readme.txt': 'ignoré',
    }
    const result = await readEmbeddedPersonas({ getKeys: async () => Object.keys(items), getItem: async key => items[key] })
    expect(result.files.map(file => file.path)).toEqual(['demo/alpha.md'])
    expect(result.errors.map(error => error.path)).toEqual(['demo/beta.md', 'demo/gamma.md'])
  })
})

describe('mergePersonaReload (CA2)', () => {
  async function load(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) await write(path, content)
    return readPersonaDir(root, fs)
  }

  it('fiche en erreur : version précédente gardée ; fiche supprimée : disparaît', async () => {
    const before = (await load({
      'demo/alpha.md': persona('alpha', 'Alpha Un'),
      'demo/beta.md': persona('beta', 'Beta Deux'),
      'demo/gamma.md': persona('gamma', 'Gamma Trois'),
    })).files
    await write('demo/alpha.md', persona('alpha', 'Alpha Modifié'))
    await write('demo/beta.md', persona('beta', 'Beta Deux').replace(/^name: .*\n/m, ''))
    await fs.rm(join(root, 'demo/gamma.md'))

    const outcome = mergePersonaReload(before, await readPersonaDir(root, fs), 'dir')
    expect(outcome.replaced).toBe(true)
    expect(outcome.report.loaded).toEqual(['demo/alpha.md'])
    expect(outcome.report.kept).toEqual(['demo/beta.md'])
    expect(outcome.report.errors).toHaveLength(1)
    expect(outcome.report.errors[0]).toMatchObject({ path: 'demo/beta.md' })
    expect(outcome.report.errors[0]!.message).toContain('« name »')
    expect(outcome.files.map(file => [file.path, file.persona.name])).toEqual([
      ['demo/alpha.md', 'Alpha Modifié'],
      ['demo/beta.md', 'Beta Deux'],
    ])
  })

  it('aucune fiche valide : rien n\'est remplacé', async () => {
    const before = (await load({ 'demo/alpha.md': persona('alpha', 'Alpha Un') })).files
    await write('demo/alpha.md', 'cassée')
    const broken = mergePersonaReload(before, await readPersonaDir(root, fs), 'dir')
    expect(broken.replaced).toBe(false)
    expect(broken.files).toEqual(before)
    expect(broken.report).toMatchObject({ source: 'dir', loaded: [], kept: [] })
    expect(broken.report.errors.map(error => error.path)).toEqual(['demo/alpha.md'])

    await fs.rm(join(root, 'demo'), { recursive: true })
    const empty = mergePersonaReload(before, await readPersonaDir(root, fs), 'dir')
    expect(empty).toMatchObject({ replaced: false, files: before, report: { loaded: [], errors: [], kept: [] } })
  })

  it('une version gardée cède son nom à une fiche chargée', () => {
    const file = (path: string, name: string): PersonaFile => {
      const id = path.slice('demo/'.length, -3)
      return { path, markdown: '', persona: { ...loadPersonas()[0]!, id, name, scenarioId: 'demo' } }
    }
    const outcome = mergePersonaReload(
      [file('demo/a.md', 'Nom A'), file('demo/b.md', 'Nom B')],
      { files: [file('demo/a.md', 'Nom B')], errors: [{ path: 'demo/b.md', message: 'cassée' }] },
      'dir',
    )
    expect(outcome.report.kept).toEqual([])
    expect(outcome.files.map(entry => entry.path)).toEqual(['demo/a.md'])
  })
})

describe('dispatcher.replacePersonas (CA2)', () => {
  function setup() {
    return createNpcDispatcher({
      ...fakeClock(),
      retriever: createLexicalRetriever(),
      responder: createKeywordsResponder(),
      personas: loadPersonas(),
      publish: () => {},
    })
  }

  it('garde l\'état activé et le scénario ; findByName voit les nouveaux noms', () => {
    const dispatcher = setup()
    dispatcher.setEnabled(true)
    const [first, ...rest] = loadPersonas()
    const added = { ...first!, id: 'nouveau', name: 'Nouveau Venu' }
    dispatcher.replacePersonas([...rest, added])
    expect(dispatcher.isEnabled()).toBe(true)
    expect(dispatcher.scenarioId()).toBe('panne-checkout')
    expect(dispatcher.findByName('nouveau venu')?.id).toBe('nouveau')
    expect(dispatcher.findByName(first!.name)).toBeUndefined()
    expect(dispatcher.list().map(npc => npc.id)).toContain('nouveau')

    // Coupés : restent coupés
    dispatcher.setEnabled(false)
    dispatcher.replacePersonas(loadPersonas())
    expect(dispatcher.isEnabled()).toBe(false)
    expect(dispatcher.scenarioId()).toBe('panne-checkout')
  })

  it('les réponses déjà planifiées ne sont pas annulées', async () => {
    resetChatStore()
    const clock = fakeClock()
    const published: string[] = []
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever: createLexicalRetriever(),
      responder: createKeywordsResponder(),
      personas: loadPersonas(),
      delayMs: () => 1000,
      publish: reply => published.push(reply.persona.id),
    })
    dispatcher.setEnabled(true)
    const question = addMessage('incident-en-cours', { author: 'Alice', text: '@Julien Moreau quel déploiement récent ?' })
    expect(dispatcher.handle(question)).toEqual(['release-manager'])
    dispatcher.replacePersonas(loadPersonas().filter(entry => entry.id !== 'release-manager'))
    await clock.advance(1000)
    expect(published).toEqual(['release-manager'])
  })

  it('scénario courant sans fiche : repli sur celui de la première fiche', () => {
    const dispatcher = setup()
    const other = loadPersonas().map(entry => ({ ...entry, scenarioId: 'autre' }))
    dispatcher.replacePersonas(other)
    expect(dispatcher.scenarioId()).toBe('autre')
    expect(dispatcher.list()).toHaveLength(6)
  })
})

describe('029 CA5 : id unique tous scénarios, nom borné', () => {
  const LONG_NAME = `${'N'.repeat(AUTHOR_MAX_LENGTH)}x`

  it('fuite-donnees/x.md dont l\'id existe dans panne-checkout : rejetée, le message cite l\'autre chemin', async () => {
    await write('panne-checkout/x.md', persona('x', 'Xavier Un', 'panne-checkout'))
    await write('panne-checkout/y.md', persona('y', 'Yves Deux', 'panne-checkout'))
    await write('fuite-donnees/x.md', persona('x', 'Xavier Bis', 'fuite-donnees'))
    const result = await readPersonaDir(root, fs)
    const errors = new Map(result.errors.map(error => [error.path, error.message]))
    expect(errors.get('fuite-donnees/x.md')).toContain('Fiche PNJ fuite-donnees/x.md')
    expect(errors.get('fuite-donnees/x.md')).toContain('id « x » déjà utilisé par panne-checkout/x.md')
    expect(result.files.map(file => file.path)).not.toContain('fuite-donnees/x.md')
    // Aucune ne l'emporte selon l'ordre des chemins : l'autre est écartée aussi, en citant la première
    expect(errors.get('panne-checkout/x.md')).toContain('déjà utilisé par fuite-donnees/x.md')
    expect(result.files.map(file => file.path)).toEqual(['panne-checkout/y.md'])
  })

  it('rechargement : la version précédente de panne-checkout/x.md reste en service', async () => {
    await write('panne-checkout/x.md', persona('x', 'Xavier Un', 'panne-checkout'))
    await write('panne-checkout/y.md', persona('y', 'Yves Deux', 'panne-checkout'))
    const before = await readPersonaDir(root, fs)
    await write('fuite-donnees/x.md', persona('x', 'Xavier Bis', 'fuite-donnees'))
    const outcome = mergePersonaReload(before.files, await readPersonaDir(root, fs), 'dir')
    expect(outcome.files.map(file => file.path)).toEqual(['panne-checkout/x.md', 'panne-checkout/y.md'])
    expect(outcome.report.kept).toEqual(['panne-checkout/x.md'])
    expect(outcome.report.errors.map(error => error.path)).toContain('fuite-donnees/x.md')
  })

  it(`nom de ${AUTHOR_MAX_LENGTH + 1} caractères : rejetée ; ${AUTHOR_MAX_LENGTH} : acceptée`, async () => {
    await write('demo/long.md', persona('long', LONG_NAME))
    await write('demo/juste.md', persona('juste', 'N'.repeat(AUTHOR_MAX_LENGTH)))
    const result = await readPersonaDir(root, fs)
    expect(result.files.map(file => file.path)).toEqual(['demo/juste.md'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.path).toBe('demo/long.md')
    expect(result.errors[0]!.message).toContain(`de plus de ${AUTHOR_MAX_LENGTH} caractères`)
  })

  it('édition en ligne : 422 pour un id déjà utilisé ailleurs et pour un nom trop long', async () => {
    await write('panne-checkout/x.md', persona('x', 'Xavier Un', 'panne-checkout'))
    await write('fuite-donnees/z.md', persona('z', 'Zoé Trois', 'fuite-donnees'))
    const layer = createPersonaLayer((await readPersonaDir(root, fs)).files)
    const sameId = layer.edit('fuite-donnees/z.md', persona('x', 'Zoé Trois', 'fuite-donnees'))
    expect(sameId).toMatchObject({ ok: false, status: 422 })
    expect(!sameId.ok && sameId.errors[0]!.message).toContain('id « x » déjà utilisé par panne-checkout/x.md')
    const long = layer.edit('fuite-donnees/z.md', persona('z', LONG_NAME, 'fuite-donnees'))
    expect(long).toMatchObject({ ok: false, status: 422 })
    expect(!long.ok && long.errors[0]!.message).toContain(`de plus de ${AUTHOR_MAX_LENGTH} caractères`)
    expect(layer.isModified('fuite-donnees/z.md')).toBe(false)
  })

  it('render.yaml : NPC_ENGINE en sync: false', () => {
    const yaml = readFileSync(resolve(import.meta.dirname, '../render.yaml'), 'utf8')
    expect(yaml).toMatch(/- key: NPC_ENGINE\n\s+sync: false\n/)
  })
})
