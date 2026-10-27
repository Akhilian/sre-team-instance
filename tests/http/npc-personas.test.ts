// 025 CA3, CA4 et CA5 : fiches lues dans NPC_PERSONAS_DIR (copie temporaire de server/npc/personas),
// rechargées à chaud par POST /api/admin/npc-personas/reload, et repli sur les fiches embarquées
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import type { NpcPersonaReloadReport, NpcPersonasAdminState } from '../../shared/types/npc'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const SOURCE_DIR = resolve(import.meta.dirname, '../../server/npc/personas')
// Puce de « Sait » de release-manager.md qui reçoit le marqueur
const KNOWN_BULLET = 'Récent, donc.'
const QUESTION = '@Julien Moreau quelle est la référence du ticket de mise en production ?'

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

async function personas(server: TestServer, headers: Record<string, string> = ADMIN): Promise<Response> {
  return fetch(`${server.url}/api/admin/npc-personas`, { headers })
}

function reload(server: TestServer, headers: Record<string, string> = ADMIN): Promise<Response> {
  return postJson(`${server.url}/api/admin/npc-personas/reload`, { dir: '/etc' }, headers)
}

/** Pose une question en canal et attend la réponse du PNJ npcId dans son fil */
async function askNpc(server: TestServer, text: string, npcId: string): Promise<Message | undefined> {
  const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text })
  expect(response.status).toBe(201)
  const root = await response.json() as Message
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const messages = await (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json() as Message[]
    const reply = messages.find(message => message.parentId === root.id && message.npc?.id === npcId)
    if (reply) return reply
    await sleep(100)
  }
  return undefined
}

describe('NPC_PERSONAS_DIR (025 CA3, CA4)', () => {
  let server: TestServer
  let dir: string
  const release = () => join(dir, 'panne-checkout/release-manager.md')

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'npc-personas-http-'))
    await cp(SOURCE_DIR, dir, { recursive: true })
    const source = await readFile(release(), 'utf8')
    expect(source).toContain(KNOWN_BULLET)
    await writeFile(release(), source.replace(KNOWN_BULLET, `${KNOWN_BULLET} Référence du ticket de mise en production : MARQUEUR-A.`))
    server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_PERSONAS_DIR: dir, NPC_REPLY_DELAY_MS: '100' })
    expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  })
  afterAll(async () => {
    await server?.stop()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('CA3 : sans code ou avec un code faux, les deux routes répondent 401', async () => {
    for (const headers of [{}, { 'x-facilitator-code': 'faux' }]) {
      expect((await personas(server, headers)).status).toBe(401)
      expect((await reload(server, headers)).status).toBe(401)
    }
  })

  it('CA3 : source dir, 14 fiches (027 : 6 + 5, 056 : +3) avec leur markdown, et le marqueur dans la réponse de Julien', async () => {
    const response = await personas(server)
    expect(response.status).toBe(200)
    const state = await response.json() as NpcPersonasAdminState
    expect(state.source).toBe('dir')
    expect(state.personas).toHaveLength(14)
    expect(Object.keys(state.personas[0]!).sort()).toEqual(['id', 'markdown', 'modified', 'name', 'path', 'role', 'scenarioId'])
    const julien = state.personas.find(entry => entry.id === 'release-manager')
    expect(julien).toMatchObject({ path: 'panne-checkout/release-manager.md', name: 'Julien Moreau', scenarioId: 'panne-checkout' })
    expect(julien!.markdown).toContain('MARQUEUR-A')

    const reply = await askNpc(server, QUESTION, 'release-manager')
    expect(reply?.text).toContain('MARQUEUR-A')
  })

  it('CA4 : rechargement (corps ignoré), fiche en erreur gardée, puis 422 sur un dossier vide', async () => {
    await writeFile(release(), (await readFile(release(), 'utf8')).replace('MARQUEUR-A', 'MARQUEUR-B'))
    const cfo = join(dir, 'panne-checkout/cfo.md')
    await writeFile(cfo, (await readFile(cfo, 'utf8')).replace(/^name: .*\n/m, ''))

    const response = await reload(server)
    expect(response.status).toBe(200)
    const report = await response.json() as NpcPersonaReloadReport
    expect(report.source).toBe('dir')
    expect(report.loaded).toContain('panne-checkout/release-manager.md')
    expect(report.loaded).not.toContain('panne-checkout/cfo.md')
    expect(report.kept).toEqual(['panne-checkout/cfo.md'])
    const cfoError = report.errors.find(error => error.path === 'panne-checkout/cfo.md')
    expect(cfoError?.message).toContain('name')
    // Le corps { dir: '/etc' } n'a rien changé à la source
    expect(report.errors.every(error => error.path.startsWith('panne-checkout/'))).toBe(true)

    expect((await askNpc(server, QUESTION, 'release-manager'))?.text).toContain('MARQUEUR-B')
    expect(await askNpc(server, '@Marc Lefort combien coûte une minute d\'indisponibilité ?', 'cfo')).toBeDefined()

    // Dossier vidé (les trois scénarios) : 422, rien n'est remplacé
    await rm(join(dir, 'panne-checkout'), { recursive: true })
    await rm(join(dir, 'fuite-donnees'), { recursive: true })
    await rm(join(dir, 'rollback-inutile'), { recursive: true })
    const empty = await reload(server)
    expect(empty.status).toBe(422)
    expect(await empty.json()).toMatchObject({ source: 'dir', loaded: [], kept: [] })
    const npcs = await (await fetch(`${server.url}/api/npcs`)).json() as { npcs: unknown[] }
    expect(npcs.npcs).toHaveLength(6)
    expect(((await (await personas(server)).json()) as NpcPersonasAdminState).personas).toHaveLength(14)
  })
})

describe('fiches embarquées (025 CA5)', () => {
  it('sans NPC_PERSONAS_DIR : source embedded, 14 fiches, rechargement 200', async () => {
    const server = await startServer({ FACILITATOR_CODE: 'animateur' })
    try {
      const state = await (await personas(server)).json() as NpcPersonasAdminState
      expect(state.source).toBe('embedded')
      expect(state.personas).toHaveLength(14)
      const response = await reload(server)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ source: 'embedded', errors: [], kept: [] })
    }
    finally {
      await server.stop()
    }
  })

  it('dossier inexistant : avertissement et fiches embarquées', async () => {
    const missing = join(tmpdir(), 'npc-personas-absent-025')
    const server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_PERSONAS_DIR: missing })
    try {
      const state = await (await personas(server)).json() as NpcPersonasAdminState
      expect(state.source).toBe('embedded')
      expect(state.personas).toHaveLength(14)
      expect(server.stderr()).toContain('NPC_PERSONAS_DIR')
      expect(server.stderr()).not.toContain(missing)
    }
    finally {
      await server.stop()
    }
  })
})
