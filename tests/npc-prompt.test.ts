// 034 CA1 : la question porte son auteur ; 020 CA8 et CA10 : règles de ton, exemples, contexte de lecture du canal ;
// 035 : prompt d'une intervention spontanée
import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types/chat'
import type { NpcRequest } from '../shared/types/npc'
import { buildNpcPrompt } from '../server/npc/prompt'
import { createNpcDispatcher } from '../server/npc/dispatcher'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { addDirectChannel, addMessage, addNpcMessage, getChannel, listMessages, resetChatStore } from '../server/utils/chat-store'
import { NPC_CHANNEL_CONTEXT_MAX } from '../shared/utils/limits'
import { fakeClock, loadPersonas, personaById } from './npc-helpers'

const RELEASE = personaById('release-manager')
const retriever = createLexicalRetriever()

let nextId = 1
function message(author: string, text: string, extra: Partial<Message> = {}): Message {
  const id = nextId++
  return {
    id: `m${id}`,
    channelId: 'incident-en-cours',
    author,
    text,
    createdAt: new Date(Date.UTC(2026, 9, 24, 12, 0, 0) + id * 60_000).toISOString(),
    rev: id,
    ...extra,
  }
}

async function request(question: string, extra: Partial<NpcRequest> = {}): Promise<NpcRequest> {
  return { persona: RELEASE, excerpts: await retriever.retrieve(RELEASE, question), history: [], question, ...extra }
}

describe('034 CA1 : auteur de la question', () => {
  it('dernier message user « Bob : … » et règle « Tu réponds à Bob » ; rien n\'attribue la question à Alice', async () => {
    const history = [message('Alice', 'Le checkout est lent'), message('Alice', 'Quelqu\'un a une idée ?')]
    const prompt = await buildNpcPrompt(await request('Quel déploiement récent ?', { history, questionAuthor: 'Bob', excerpts: [] }))
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'Bob : Quel déploiement récent ?' })
    expect(prompt[0]!.content).toContain('Tu réponds à Bob')
    expect(prompt[0]!.content).toContain('n\'emploie jamais un autre prénom')
    expect(prompt.filter(entry => entry.content.includes('Quel déploiement récent ?')).every(entry => entry.content.startsWith('Bob : '))).toBe(true)
  })

  it('sans questionAuthor : question brute, pas de règle', async () => {
    const prompt = buildNpcPrompt(await request('Quel déploiement récent ?', { excerpts: [] }))
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'Quel déploiement récent ?' })
    expect(prompt[0]!.content).not.toContain('Tu réponds à')
  })
})

describe('020 CA8 : ton de collègue', () => {
  it('règles, interdiction des excuses et exemples de ton', async () => {
    const system = buildNpcPrompt(await request('Bonjour ?'))[0]!.content
    expect(system).toContain('canal d\'incident')
    expect(system).toContain('1 à 3 phrases')
    expect(system).not.toContain('2 à 4 phrases')
    expect(system).toMatch(/jamais d'excuses/)
    expect(system).toContain('Comment puis-je vous aider')
    // 040 CA3 : plus d'exemples de ton à recopier
    expect(system).not.toContain('Exemples de ton')
  })
})

describe('020 CA10 : contexte de lecture du canal', () => {
  it('le system contient les 30 derniers messages du canal au format [HH:MM] Auteur : …, pas les plus anciens', async () => {
    const channel = Array.from({ length: 45 }, (_, index) => message(index % 2 === 0 ? 'Alice' : 'Bob', `ligne numéro ${index}`))
    const channelContext = channel.slice(-NPC_CHANNEL_CONTEXT_MAX)
    const thread = [message('Alice', 'racine du fil'), message('Bob', 'réponse du fil')]
    const prompt = buildNpcPrompt(await request('Quel déploiement ?', { history: thread, channelContext, questionAuthor: 'Bob', excerpts: [] }))
    const system = prompt[0]!.content
    expect(system).toContain('Conversation récente du canal (lecture seule)')
    for (let index = 15; index < 45; index++) expect(system).toMatch(new RegExp(`ligne numéro ${index}$`, 'm'))
    for (let index = 0; index < 15; index++) expect(system).not.toMatch(new RegExp(`ligne numéro ${index}$`, 'm'))
    expect(system).toMatch(/\[\d{2}:\d{2}\] Alice : ligne numéro 16/)
    // Le fil reste en messages de chat
    expect(prompt.slice(1).map(entry => entry.content)).toEqual(['Alice : racine du fil', 'Bob : réponse du fil', 'Bob : Quel déploiement ?'])
  })

  it('marque (toi) et [alerte] ; heure de Paris', async () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 24, 12, minute, 0)).toISOString()
    const mine = message(RELEASE.name, 'Je regarde.', { npc: { id: RELEASE.id, role: RELEASE.role }, createdAt: at(1) })
    const alert = message('Alerting', 'p95 à 2,4 s', {
      createdAt: at(2),
      kind: 'alert',
      alert: { severity: 'SEV2', title: 'Latence', service: 'checkout-api', status: 'firing' } as Message['alert'],
    })
    const system = buildNpcPrompt(await request('Bonjour ?', { channelContext: [mine, alert] }))[0]!.content
    // 12:01 UTC le 24 octobre 2026 = 14:01 à Paris (heure d'été jusqu'au 25 octobre)
    expect(system).toContain(`[14:01] ${RELEASE.name} (toi) : Je regarde.`)
    expect(system).toContain('[14:02] Alerting : [alerte] SEV2 Latence — p95 à 2,4 s')
  })

  it('30 messages de 600 caractères : prompt ≤ 12 000 caractères, lignes coupées à 280', async () => {
    const channelContext = Array.from({ length: 30 }, (_, index) => message('Alice', `${index}`.padEnd(600, 'x')))
    const prompt = buildNpcPrompt(await request('Quel déploiement ?', { channelContext, questionAuthor: 'Bob' }))
    expect(prompt.reduce((total, entry) => total + entry.content.length, 0)).toBeLessThanOrEqual(12_000)
    const lines = prompt[0]!.content.split('\n').filter(line => /^\[\d{2}:\d{2}\] Alice : /.test(line))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every(line => line.length <= 300)).toBe(true)
    // Les plus anciens sont retirés en premier
    expect(prompt[0]!.content).toContain('Alice : 29xxx')
    expect(prompt[0]!.content).not.toContain('Alice : 0xxx')
  })
})

describe('035 : prompt d\'une intervention spontanée', () => {
  it('contient le texte de base, la consigne, aucun extrait « Sur question précise »', () => {
    const base = 'Je commence à m\'inquiéter, on en est où ?'
    const prompt = buildNpcPrompt({ persona: RELEASE, excerpts: [], history: [], question: '', spontaneous: { base } })
    expect(prompt.at(-1)!.role).toBe('user')
    expect(prompt.at(-1)!.content).toContain(base)
    expect(prompt[0]!.content).toContain('sans ajouter aucune information nouvelle')
    expect(prompt[0]!.content).not.toContain('Extraits de ta fiche')
    for (const entry of RELEASE.onPreciseQuestion) {
      for (const message of prompt) expect(message.content).not.toContain(entry.text)
    }
  })
})

describe('dispatcher : requête transmise au moteur', () => {
  it('034 CA2 : questionAuthor en canal comme en conversation directe, et contexte de lecture de l\'incident', async () => {
    resetChatStore()
    const requests: NpcRequest[] = []
    const clock = fakeClock()
    // 45 messages hors fil dans le canal d'incident, puis un fil de 3 messages où arrive la mention
    for (let index = 0; index < 45; index++) addMessage('incident-en-cours', { author: 'Alice', text: `contexte ${index}` })
    const root = addMessage('incident-en-cours', { author: 'Alice', text: 'fil : racine' })
    addMessage('incident-en-cours', { author: 'Alice', text: 'fil : suite', parentId: root.id })
    const question = addMessage('incident-en-cours', { author: 'Bob', text: `@${RELEASE.name} quel déploiement récent ?`, parentId: root.id })
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever,
      responder: { respond: (req) => { requests.push(req); return createKeywordsResponder().respond(req) } },
      personas: loadPersonas(),
      delayMs: () => 100,
      history: m => listMessages(m.channelId).filter(c => c.id === m.parentId || c.parentId === m.parentId),
      channelContext: () => listMessages('incident-en-cours'),
      onError: (error) => { throw error },
      publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
    })
    dispatcher.setEnabled(true)
    dispatcher.handle(question)
    await clock.advance(100)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.questionAuthor).toBe('Bob')
    const context = requests[0]!.channelContext!.map(m => m.text)
    expect(context).toHaveLength(NPC_CHANNEL_CONTEXT_MAX)
    expect(context.at(-1)).toBe('contexte 44')
    expect(context[0]).toBe('contexte 15')
    expect(context.join('\n')).not.toContain('fil :')
    expect(requests[0]!.history.map(m => m.text)).toEqual(['fil : racine', 'fil : suite'])
  })

  it('034 CA2 / 020 CA10 : en conversation directe, questionAuthor est l\'auteur et le contexte celui de incident-en-cours', async () => {
    resetChatStore()
    const requests: NpcRequest[] = []
    const clock = fakeClock()
    const { channel } = addDirectChannel({ participant: 'Alice', npc: RELEASE })
    addMessage('incident-en-cours', { author: 'Bob', text: 'le paiement est tombé' })
    const question = addMessage(channel.id, { author: 'Alice', text: 'quel déploiement récent ?' })
    const dispatcher = createNpcDispatcher({
      ...clock,
      retriever,
      responder: { respond: (req) => { requests.push(req); return Promise.resolve('ok') } },
      personas: loadPersonas(),
      delayMs: () => 100,
      history: m => listMessages(m.channelId),
      channelContext: m => listMessages(getChannel(m.channelId)?.direct ? 'incident-en-cours' : m.channelId),
      directNpcId: id => getChannel(id)?.direct?.npcId,
      onError: (error) => { throw error },
      publish: reply => addNpcMessage(reply.channelId, { npc: reply.persona, text: reply.text, parentId: reply.parentId }),
    })
    dispatcher.setEnabled(true)
    dispatcher.handle(question)
    await clock.advance(100)
    expect(requests[0]!.questionAuthor).toBe('Alice')
    expect(requests[0]!.channelContext!.map(m => m.text)).toEqual(['le paiement est tombé'])
  })
})

describe('051 : cohérence collective, section des autres PNJ', () => {
  const CFO = personaById('cfo')
  const PEERS = 'Ce que les autres PNJ ont déjà dit :'
  const systemOf = (request: NpcRequest) => buildNpcPrompt(request)[0]!.content
  const peerMessage = (text: string) => message(CFO.name, text, { npc: { id: CFO.id, role: CFO.role } })

  it('CA1 : les 6 plus récents des pairs, chronologiques, sans soi-même, alerte ni système ; absente sans pair', async () => {
    const peers = Array.from({ length: 10 }, (_, index) => peerMessage(`réponse pair ${index}`))
    const own = message(RELEASE.name, 'ma propre réponse', { npc: { id: RELEASE.id, role: RELEASE.role } })
    const alert = message('Monitoring', 'alerte x', { kind: 'alert', alert: { severity: 'critical', title: 'T' } as never })
    const system = message('Système', 'avis système', { kind: 'system' })
    const channelContext = [own, ...peers.slice(0, 5), alert, ...peers.slice(5), system]
    const prompt = systemOf(await request('Où en est-on ?', { channelContext }))
    const section = prompt.slice(prompt.indexOf(PEERS), prompt.indexOf('Conversation récente'))
    expect(section).not.toContain('réponse pair 3')
    for (let index = 4; index < 10; index++) expect(section).toContain(`réponse pair ${index}`)
    expect(section.indexOf('réponse pair 4')).toBeLessThan(section.indexOf('réponse pair 9'))
    expect(section).not.toMatch(/ma propre réponse|alerte x|avis système/)
    expect(systemOf(await request('Où en est-on ?', { channelContext: [own, alert, system] }))).not.toContain(PEERS)
  })

  it('CA2 : règle hors spontané ; prompt spontané sans section ni règle (égal à celui sans pair)', async () => {
    const withPeer = await request('Où en est-on ?', { channelContext: [peerMessage('un pair')] })
    expect(systemOf(withPeer)).toContain('Ne contredis pas ce que les autres PNJ')
    const base = { persona: RELEASE, excerpts: [], history: [], question: '', spontaneous: { base: 'On en est où ?' } }
    const context = [message('Alice', 'salut'), peerMessage('un pair')]
    const system = buildNpcPrompt({ ...base, channelContext: context })[0]!.content
    expect(system).not.toContain(PEERS)
    expect(system).not.toContain('Ne contredis pas')
    // le pair reste dans la conversation récente, comme avant
    expect(system).toContain('Conversation récente du canal (lecture seule) :\n')
    expect(system).toContain(': salut\n')
    expect(system).toMatch(/: un pair\n\nRègles/)
  })

  it('CA5 : taille bornée, aucun message dans les deux sections', async () => {
    const channelContext = Array.from({ length: 30 }, (_, index) => index % 2 === 0
      ? peerMessage(`pair-${index} ${'x'.repeat(600)}`)
      : message('Alice', `humain-${index} ${'y'.repeat(600)}`))
    const prompt = systemOf(await request('Où en est-on ?', { channelContext }))
    const start = prompt.indexOf(PEERS)
    const recentAt = prompt.indexOf('Conversation récente')
    const end = prompt.indexOf('\n\nRègles :')
    expect(start).toBeGreaterThan(-1)
    expect(end - start).toBeLessThanOrEqual(6000 + 6 * (280 + 40))
    const peerSection = prompt.slice(start, recentAt)
    const recentSection = prompt.slice(recentAt, end)
    for (const match of peerSection.matchAll(/pair-(\d+)/g)) expect(recentSection).not.toContain(`pair-${match[1]} `)
  })
})
