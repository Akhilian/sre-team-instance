// 020 CA9 : filtre de sortie stripServiceTone, et son application par les adaptateurs openai-compatible et anthropic
import { describe, expect, it, vi } from 'vitest'
import type { NpcRequest } from '../shared/types/npc'
import { cleanModelOutput, stripServiceTone } from '../server/npc/service-tone'
import { buildNpcPrompt } from '../server/npc/prompt'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { createOpenAiCompatibleResponder } from '../server/npc/engines/openai-compatible'
import { createAnthropicResponder } from '../server/npc/engines/anthropic'
import { createLexicalRetriever } from '../server/npc/lexical-retriever'
import { personaById } from './npc-helpers'

describe('stripServiceTone', () => {
  const cases: [string, string, string][] = [
    ['excuse en tête', 'Je suis désolé pour les perturbations. On regarde le pool.', 'On regarde le pool.'],
    ['salutation et remerciement', 'Bonjour à tous ! Merci pour votre message. Le coût est de 1 200 €/min.', 'Le coût est de 1 200 €/min.'],
    ['fin « N\'hésitez pas »', 'Le pool est saturé. N\'hésitez pas si besoin.', 'Le pool est saturé.'],
    ['fin « Comment puis-je vous aider »', 'On est sur le rollback. Comment puis-je vous aider ?', 'On est sur le rollback.'],
    ['texte sans motif', 'On regarde le pool, retour dans 5 min.', 'On regarde le pool, retour dans 5 min.'],
    ['« désolé » au milieu d\'une phrase utile', 'Le pool est saturé, désolé de ne pas avoir plus, mais je ne sais pas pourquoi.', 'Le pool est saturé, désolé de ne pas avoir plus, mais je ne sais pas pourquoi.'],
    ['« je ne suis pas désolé » n\'est pas une excuse', 'Je ne suis pas désolé, c\'est le pool.', 'Je ne suis pas désolé, c\'est le pool.'],
    ['accents tolérés, excuses', 'Toutes mes excuses pour la gêne. Le rollback prend 5 min.', 'Le rollback prend 5 min.'],
    ['sans accent, majuscules', 'JE SUIS VRAIMENT DESOLEE. Pool saturé.', 'Pool saturé.'],
    ['compassion', 'Je comprends votre frustration. On y travaille.', 'On y travaille.'],
    ['salutation suivie d\'une suite sur la même phrase', 'Bonjour, le pool est saturé.', 'Le pool est saturé.'],
    ['excuse suivie d\'une suite sur la même phrase', 'Je suis désolé, le pool est saturé.', 'Le pool est saturé.'],
    ['décimale et version non coupées', 'Merci pour votre patience. Release v2.41.0, 1,2 million d\'abonnés.', 'Release v2.41.0, 1,2 million d\'abonnés.'],
    ['plusieurs formules de tête et de fin', 'Bonjour ! Je suis désolé pour la gêne. Merci de votre patience. Le pool est saturé. N\'hésitez pas à revenir vers moi. Comment puis-je vous aider ?', 'Le pool est saturé.'],
    ['texte entièrement formule', 'Bonjour à tous ! Je suis désolé pour les perturbations. N\'hésitez pas à me contacter.', ''],
    ['vide', '   ', ''],
  ]
  it.each(cases)('%s', (_name, input, expected) => {
    expect(stripServiceTone(input)).toBe(expected)
  })
})

const RELEASE = personaById('release-manager')
const retriever = createLexicalRetriever()
const keywords = createKeywordsResponder()

async function request(question: string): Promise<NpcRequest> {
  return { persona: RELEASE, excerpts: await retriever.retrieve(RELEASE, question), history: [], question }
}

describe('adaptateurs : filtre de sortie', () => {
  function openAi(content: string) {
    const logger = { warn: vi.fn() }
    const engine = createOpenAiCompatibleResponder({
      baseUrl: 'http://modele.test/v1',
      model: 'm',
      timeoutMs: 1000,
      fetch: (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch,
      fallback: keywords,
      logger,
    })
    return { engine, logger }
  }
  function anthropic(text: string) {
    const logger = { warn: vi.fn() }
    const engine = createAnthropicResponder({
      baseUrl: 'https://api.anthropic.test',
      model: 'm',
      apiKey: 'k',
      timeoutMs: 1000,
      fetch: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status: 200 })) as typeof fetch,
      fallback: keywords,
      logger,
    })
    return { engine, logger }
  }

  it.each([['openai-compatible', openAi], ['anthropic', anthropic]] as const)('%s : l\'excuse de tête est retirée', async (_name, make) => {
    const { engine, logger } = make('Je suis désolé pour les perturbations. Le pool est saturé.')
    expect(await engine.respond(await request('Quel déploiement ?'))).toBe('Le pool est saturé.')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([['openai-compatible', openAi], ['anthropic', anthropic]] as const)('%s : réponse réduite à une excuse → réponse keywords', async (_name, make) => {
    const { engine, logger } = make('Je suis désolé pour les perturbations.')
    const req = await request('Quel déploiement récent ?')
    expect(await engine.respond(req)).toBe(await keywords.respond(req))
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]![0]).toContain('réponse vide')
  })

  it('intervention spontanée : réponse réduite à une excuse → texte de base (keywords)', async () => {
    const { engine } = openAi('Je suis désolé.')
    const base = 'On en est où ? Je commence à m\'inquiéter.'
    expect(await engine.respond({ persona: RELEASE, excerpts: [], history: [], question: '', spontaneous: { base } })).toBe(base)
  })
})

describe('cleanModelOutput : sorties réelles observées avec qwen2.5:1.5b', () => {
  const RELEASE_NAME = 'Julien Moreau'

  it('préfixe « Nom : » imité de l\'historique retiré (complet, prénom, avec [HH:MM], casse tolérée)', () => {
    const raw = 'Julien Moreau : Dernier déploiement sur checkout-api v2.41.0, il y a quelques minutes.'
    const expected = 'Dernier déploiement sur checkout-api v2.41.0, il y a quelques minutes.'
    expect(cleanModelOutput(raw, { personaName: RELEASE_NAME })).toBe(expected)
    expect(cleanModelOutput(raw.replace('Julien Moreau', 'julien'), { personaName: RELEASE_NAME })).toBe(expected)
    expect(cleanModelOutput(`[14:03] Julien Moreau (toi) : ${expected}`, { personaName: RELEASE_NAME })).toBe(expected)
    expect(cleanModelOutput(`Julien  :  ${expected}`, { personaName: RELEASE_NAME })).toBe(expected)
    // Un « : » ordinaire ou un autre nom n'est pas touché
    expect(cleanModelOutput('Bob : je regarde.', { personaName: RELEASE_NAME })).toBe('Bob : je regarde.')
  })

  const BASE = 'Les ventes perdues, ça se chiffre vite. Il me faut un ordre de grandeur.'

  it('préambule méta et guillemets retirés d\'une intervention spontanée', () => {
    const raw = `Je vais reformuler en 1 à 2 phrases : "${BASE}"`
    expect(cleanModelOutput(raw, { personaName: 'Marc Lefort', spontaneous: true })).toBe(BASE)
    expect(cleanModelOutput(`Voici la reformulation : « ${BASE} »`, { personaName: 'Marc Lefort', spontaneous: true })).toBe(BASE)
    expect(cleanModelOutput(`Reformulation : “${BASE}”`, { personaName: 'Marc Lefort', spontaneous: true })).toBe(BASE)
    expect(cleanModelOutput(`Marc Lefort : "${BASE}"`, { personaName: 'Marc Lefort', spontaneous: true })).toBe(BASE)
  })

  it('trace de consigne restante ou sortie vide : vide (donc texte de base via le repli keywords)', () => {
    expect(cleanModelOutput('Voici mon message de base reformulé pour le canal.', { personaName: 'Marc Lefort', spontaneous: true })).toBe('')
    expect(cleanModelOutput('Je vais reformuler en 1 à 2 phrases :', { personaName: 'Marc Lefort', spontaneous: true })).toBe('')
  })

  it('adaptateur : la sortie « Je vais reformuler… » donne le texte de base de la règle, la réponse « Julien Moreau : … » est nettoyée', async () => {
    const make = (content: string) => createOpenAiCompatibleResponder({
      baseUrl: 'http://modele.test/v1',
      model: 'm',
      timeoutMs: 1000,
      fetch: (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch,
      fallback: keywords,
      logger: { warn: vi.fn() },
    })
    const reply = await make('Julien Moreau : Dernier déploiement v2.41.0.').respond(await request('Quel déploiement ?'))
    expect(reply).toBe('Dernier déploiement v2.41.0.')
    const base = 'Les ventes perdues, ça se chiffre vite.'
    const spontaneous = (content: string) => make(content).respond({ persona: RELEASE, excerpts: [], history: [], question: '', spontaneous: { base } })
    expect(await spontaneous(`Je vais reformuler en 1 à 2 phrases : "${base}"`)).toBe(base)
    expect(await spontaneous('Je vais reformuler en 1 à 2 phrases : "Bon, les ventes, ça part vite. Message de base respecté."')).toBe(base)
  })
})

describe('intervention spontanée : aucune fuite de la fiche (CFO)', () => {
  const CFO = personaById('cfo')
  const BASE = 'Les ventes perdues, ça se chiffre vite. Il me faut un ordre de grandeur de l\'impact et une idée du retour, je dois en parler au COMEX.'
  const LEAK = 'Les ventes perdues se chiffrent à environ 1 200 € par minute. Le retour est attendu pour un client sur trois, les autres achètent ailleurs.'

  function model(content: string) {
    return createOpenAiCompatibleResponder({
      baseUrl: 'http://modele.test/v1',
      model: 'm',
      timeoutMs: 1000,
      fetch: (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch,
      fallback: keywords,
      logger: { warn: vi.fn() },
    })
  }
  const ask = (content: string, base = BASE) => model(content).respond({ persona: CFO, excerpts: [], history: [], question: '', spontaneous: { base } })

  it('la sortie qui divulgue « 1 200 € par minute » retombe sur le texte de base', async () => {
    expect(await ask(LEAK)).toBe(BASE)
  })

  it('nombre absent du message de base (6 %, 2,4, 1 200) ou texte plus de 2× plus long : texte de base ; nombre du message de base accepté', async () => {
    for (const out of ['Ça fait 6 % du chiffre.', 'Environ 2,4 millions.', 'Déjà 1 200 € de perdus.']) {
      expect(cleanModelOutput(out, { personaName: CFO.name, spontaneous: true, base: 'Il me faut un point.' })).toBe('')
    }
    expect(cleanModelOutput('Ça fait vraiment beaucoup trop de monde qui attend sans aucune réponse claire de notre part.', { personaName: CFO.name, spontaneous: true, base: 'Il me faut un point.' })).toBe('')
    expect(cleanModelOutput('Un point dans 15 min ?', { personaName: CFO.name, spontaneous: true, base: 'Un point dans 15 min, svp ?' })).toBe('Un point dans 15 min ?')
    expect(cleanModelOutput('Il me faut 1 200 €.', { personaName: CFO.name, spontaneous: true, base: 'Il me faut 1200 € vite.' })).toBe('Il me faut 1 200 €.')
  })

  it('le prompt spontané ne contient aucune puce Sait / Ignore / Sur question précise, ni extrait', () => {
    const prompt = buildNpcPrompt({
      persona: CFO,
      excerpts: [{ source: 'knows', text: CFO.knows[0]!, score: 3 }],
      history: [],
      question: '',
      spontaneous: { base: BASE },
    })
    const all = prompt.map(entry => entry.content).join('\n')
    for (const item of [...CFO.knows, ...CFO.ignores, ...CFO.onPreciseQuestion.map(entry => entry.text)]) expect(all).not.toContain(item)
    expect(all).not.toContain('1 200')
    expect(all).not.toMatch(/Ce que tu sais|Ce que tu ignores|Extraits de ta fiche/)
    expect(all).toContain(CFO.personality)
    expect(all).toContain(BASE)
  })
})
