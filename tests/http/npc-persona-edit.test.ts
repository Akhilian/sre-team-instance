// 026 CA2 et CA3 : édition en ligne d'une fiche (PUT /api/admin/npc-personas/edit), retour à l'original
// (POST …/revert), refus et dérogation de taille de corps limitée à la route d'édition ; 029 CA5 : id déjà
// utilisé dans un autre scénario et nom trop long refusés en 422
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Message } from '../../shared/types/chat'
import type { NpcPersonaEditErrorResponse, NpcPersonaFileSummary, NpcPersonasAdminState } from '../../shared/types/npc'
import { postJson, startServer, type TestServer } from './server'

const ADMIN = { 'x-facilitator-code': 'animateur' }
const CHANNEL = 'incident-en-cours'
const PATH = 'panne-checkout/release-manager.md'
// Puce de « Sait » de release-manager.md qui reçoit le marqueur
const KNOWN_BULLET = 'Récent, donc.'
const QUESTION = '@Julien Moreau quelle est la référence du ticket de mise en production ?'

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms))

let server: TestServer
let original: string

function bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function put(body: unknown, headers: Record<string, string> = ADMIN): Promise<Response> {
  return fetch(`${server.url}/api/admin/npc-personas/edit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function revert(path: string, headers: Record<string, string> = ADMIN): Promise<Response> {
  return postJson(`${server.url}/api/admin/npc-personas/revert`, { path }, headers)
}

async function personas(): Promise<NpcPersonaFileSummary[]> {
  const response = await fetch(`${server.url}/api/admin/npc-personas`, { headers: ADMIN })
  expect(response.status).toBe(200)
  return ((await response.json()) as NpcPersonasAdminState).personas
}

async function served(): Promise<NpcPersonaFileSummary> {
  return (await personas()).find(entry => entry.path === PATH)!
}

/** Pose une question en canal et attend la réponse de Julien Moreau dans son fil */
async function askJulien(): Promise<Message | undefined> {
  const response = await postJson(`${server.url}/api/channels/${CHANNEL}/messages`, { author: 'Alice', text: QUESTION })
  expect(response.status).toBe(201)
  const root = await response.json() as Message
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const messages = await (await fetch(`${server.url}/api/channels/${CHANNEL}/messages`)).json() as Message[]
    const reply = messages.find(message => message.parentId === root.id && message.npc?.id === 'release-manager')
    if (reply) return reply
    await sleep(100)
  }
  return undefined
}

beforeAll(async () => {
  server = await startServer({ FACILITATOR_CODE: 'animateur', NPC_REPLY_DELAY_MS: '100' })
  expect((await postJson(`${server.url}/api/admin/npcs`, { enabled: true }, ADMIN)).status).toBe(200)
  original = (await served()).markdown
  expect(original).toContain(KNOWN_BULLET)
})
afterAll(() => server?.stop())

describe('édition en ligne (026 CA2)', () => {
  it('PUT remplace la fiche, modified pour elle seule, puis revert remet l\'original', async () => {
    const edited = original.replace(KNOWN_BULLET, `${KNOWN_BULLET} Référence du ticket de mise en production : MARQUEUR-EDIT.`)
    const response = await put({ path: PATH, markdown: edited })
    expect(response.status).toBe(200)
    const summary = await response.json() as NpcPersonaFileSummary
    expect(summary).toMatchObject({ path: PATH, id: 'release-manager', name: 'Julien Moreau', modified: true, markdown: edited })

    expect((await askJulien())?.text).toContain('MARQUEUR-EDIT')
    const list = await personas()
    expect(list.filter(entry => entry.modified).map(entry => entry.path)).toEqual([PATH])

    const reverted = await revert(PATH)
    expect(reverted.status).toBe(200)
    expect(await reverted.json()).toMatchObject({ path: PATH, modified: false, markdown: original })
    expect((await personas()).every(entry => !entry.modified)).toBe(true)
    const reply = await askJulien()
    expect(reply).toBeDefined()
    expect(reply!.text).not.toContain('MARQUEUR-EDIT')

    // Plus de version modifiée : 404
    expect((await revert(PATH)).status).toBe(404)
  })
})

describe('refus (026 CA3)', () => {
  it('sans code ou avec un code faux : 401', async () => {
    for (const headers of [{}, { 'x-facilitator-code': 'faux' }]) {
      expect((await put({ path: PATH, markdown: original }, headers)).status).toBe(401)
      expect((await revert(PATH, headers)).status).toBe(401)
    }
  })

  it('path hors des fiches en service : 404', async () => {
    for (const path of ['../etc/passwd', 'panne-checkout/inconnu.md', '/etc/passwd']) {
      expect((await put({ path, markdown: original })).status).toBe(404)
    }
  })

  it('corps mal formé : 400', async () => {
    expect((await put({ path: PATH })).status).toBe(400)
    expect((await put({ path: PATH, markdown: 42 })).status).toBe(400)
    expect((await put('pas du json')).status).toBe(400)
  })

  it('fiche sans name : 422 qui nomme le champ, la fiche en service ne change pas', async () => {
    const response = await put({ path: PATH, markdown: original.replace(/^name: .*\n/m, '') })
    expect(response.status).toBe(422)
    const { errors } = await response.json() as NpcPersonaEditErrorResponse
    expect(errors[0]!.message).toContain('« name »')
    expect(await served()).toMatchObject({ markdown: original, modified: false })
  })

  it('029 CA5 : id déjà utilisé dans un autre scénario, ou nom de 51 caractères : 422, rien ne change', async () => {
    const socPath = 'fuite-donnees/soc.md'
    const soc = (await personas()).find(entry => entry.path === socPath)!
    const sameId = await put({ path: socPath, markdown: soc.markdown.replace(/^id: soc$/m, 'id: cfo') })
    expect(sameId.status).toBe(422)
    const idErrors = (await sameId.json() as NpcPersonaEditErrorResponse).errors
    expect(idErrors[0]!.message).toContain('id « cfo » déjà utilisé par panne-checkout/cfo.md')

    const longName = await put({ path: PATH, markdown: original.replace(/^name: .*$/m, `name: ${'N'.repeat(51)}`) })
    expect(longName.status).toBe(422)
    const nameErrors = (await longName.json() as NpcPersonaEditErrorResponse).errors
    expect(nameErrors[0]!.message).toContain('de plus de 50 caractères')

    expect(await served()).toMatchObject({ markdown: original, modified: false })
    expect((await personas()).find(entry => entry.path === socPath)).toMatchObject({ markdown: soc.markdown, modified: false })
  })

  it('erreur de ligne : 422 avec line', async () => {
    const markdown = original.replace(/^(## Sur question précise\s*)$/m, '$1\n- Puce sans déclencheurs.')
    const line = markdown.split('\n').indexOf('- Puce sans déclencheurs.') + 1
    const response = await put({ path: PATH, markdown })
    expect(response.status).toBe(422)
    const { errors } = await response.json() as NpcPersonaEditErrorResponse
    expect(errors[0]).toMatchObject({ line })
    expect(errors[0]!.message).toContain(`ligne ${line}`)
  })

  it('corps de 30 Ko valide accepté, plus de 40 Ko : 413 ; la dérogation ne vaut que pour cette route', async () => {
    const base = JSON.stringify({ path: PATH, markdown: original.replace(KNOWN_BULLET, `${KNOWN_BULLET} `) })
    const padded = original.replace(KNOWN_BULLET, `${KNOWN_BULLET} ${'x'.repeat(30_000 - bytes(base))}`)
    const body = JSON.stringify({ path: PATH, markdown: padded })
    expect(bytes(body)).toBe(30_000)
    expect((await put(body)).status).toBe(200)
    expect((await revert(PATH)).status).toBe(200)

    const tooBig = JSON.stringify({ path: PATH, markdown: 'a'.repeat(41_000) })
    expect((await put(tooBig)).status).toBe(413)
    // Markdown de plus de 32 Ko dans un corps de moins de 40 Ko : 413 aussi
    expect((await put({ path: PATH, markdown: original + 'a'.repeat(33 * 1024 - bytes(original)) })).status).toBe(413)
    expect(await served()).toMatchObject({ markdown: original, modified: false })

    // 20 Ko ailleurs : toujours 413, en POST comme en PUT
    const padding = 'a'.repeat(20_000)
    expect((await postJson(`${server.url}/api/channels`, { name: 'gros', padding })).status).toBe(413)
    expect((await postJson(`${server.url}/api/admin/npc-personas/revert`, { path: PATH, padding }, ADMIN)).status).toBe(413)
    const otherPut = await fetch(`${server.url}/api/admin/npc-personas/reload`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...ADMIN },
      body: JSON.stringify({ padding }),
    })
    expect(otherPut.status).toBe(413)
  })
})
