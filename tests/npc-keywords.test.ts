// 019 CA2, 021 CA4 et CA5 : retriever lexical et moteur keywords, purs et déterministes
import { describe, expect, it, vi } from 'vitest'
import type { NpcPersona } from '../shared/types/npc'
import { createLexicalRetriever, rankExcerpts, significantWords, triggerWordMatches } from '../server/npc/lexical-retriever'
import { createKeywordsResponder } from '../server/npc/engines/keywords'
import { DEFAULT_NPC_ENGINE, NPC_ENGINES, resolveNpcEngine } from '../server/npc/engines'
import { loadPersonas, personaById } from './npc-helpers'

const retriever = createLexicalRetriever()
const responder = createKeywordsResponder()

async function answer(persona: NpcPersona, question: string): Promise<string> {
  return responder.respond({ persona, excerpts: await retriever.retrieve(persona, question), history: [], question })
}

const DEPLOY_QUESTION = 'Quel déploiement récent sur le checkout ?'
const COST_QUESTION = 'Quel est le coût de l\'indisponibilité ?'
const SMALL_TALK = 'Bonjour, tu as des nouvelles ?'

describe('significantWords', () => {
  it('minuscules, sans accents ni mots vides, versions entières', () => {
    expect(significantWords('Quel est le coût de l\'indisponibilité de v2.41.0 ?')).toEqual(['cout', 'indisponibilite', 'v2.41.0'])
    expect(significantWords(SMALL_TALK)).toEqual([])
  })
})

describe('retriever lexical', () => {
  it('garde au plus 2 extraits', async () => {
    for (const persona of loadPersonas()) {
      expect((await retriever.retrieve(persona, `${DEPLOY_QUESTION} ${COST_QUESTION} rollback newsletter tickets`)).length).toBeLessThanOrEqual(2)
    }
  })

  it('une puce précise n\'est éligible qu\'avec un déclencheur spécifique ou deux déclencheurs', async () => {
    const release = personaById('release-manager')
    expect((await retriever.retrieve(release, 'Le checkout est lent')).every(excerpt => excerpt.source === 'knows')).toBe(true)
    expect((await retriever.retrieve(release, 'On peut faire un rollback ?')).some(excerpt => excerpt.source === 'precise')).toBe(true)
  })

  it('retrieve est asynchrone et rend le même résultat que rankExcerpts', async () => {
    const release = personaById('release-manager')
    const pending = retriever.retrieve(release, DEPLOY_QUESTION)
    expect(pending).toBeInstanceOf(Promise)
    expect(await pending).toEqual(rankExcerpts(release, DEPLOY_QUESTION))
  })

  it('un déclencheur en plusieurs mots exige la séquence', async () => {
    const release = personaById('release-manager')
    const texts = async (question: string) => (await retriever.retrieve(release, question)).map(excerpt => excerpt.text).join(' ')
    expect(await texts('Un retour arrière est possible ?')).toContain('v2.40.3')
    expect(await texts('Un retour du support, en arrière-plan ?')).not.toContain('v2.40.3')
  })
})

describe('moteur keywords', () => {
  it('Release Manager : le déploiement récent donne v2.41.0, sans ses détails', async () => {
    const text = await answer(personaById('release-manager'), DEPLOY_QUESTION)
    expect(text).toContain('v2.41.0')
    expect(text).not.toContain('timeout de 30 s')
    expect(text.startsWith(personaById('release-manager').tone)).toBe(true)
  })

  it('CEO et CFO ne connaissent pas v2.41.0', async () => {
    for (const id of ['ceo', 'cfo']) {
      const text = await answer(personaById(id), DEPLOY_QUESTION)
      expect(text).not.toContain('v2.41.0')
    }
  })

  it('CFO : le coût de l\'indisponibilité donne 18 000', async () => {
    expect(await answer(personaById('cfo'), COST_QUESTION)).toContain('18 000')
  })

  it('une information précise n\'apparaît jamais en réponse à une banalité : esquive', async () => {
    for (const persona of loadPersonas()) {
      const text = await answer(persona, SMALL_TALK)
      expect(text).toBe(persona.deflection)
      for (const entry of persona.onPreciseQuestion) expect(text).not.toContain(entry.text)
    }
    expect(await answer(personaById('release-manager'), SMALL_TALK)).not.toContain('v2.40.3')
  })

  it('deux appels identiques donnent la même réponse', async () => {
    for (const persona of loadPersonas()) {
      for (const question of [DEPLOY_QUESTION, COST_QUESTION, SMALL_TALK]) {
        expect(await answer(persona, question)).toBe(await answer(persona, question))
      }
    }
  })
})

describe('registre des moteurs', () => {
  it('keywords par défaut ; keywords et openai-compatible disponibles', () => {
    expect(DEFAULT_NPC_ENGINE).toBe('keywords')
    expect(Object.keys(NPC_ENGINES)).toEqual(['keywords', 'openai-compatible'])
    const logger = { warn: vi.fn() }
    expect(resolveNpcEngine({}, logger).name).toBe('keywords')
    expect(resolveNpcEngine({ NPC_ENGINE: 'keywords' }, logger).name).toBe('keywords')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('valeur inconnue : keywords et avertissement', () => {
    const logger = { warn: vi.fn() }
    expect(resolveNpcEngine({ NPC_ENGINE: 'gpt-magique' }, logger).name).toBe('keywords')
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.warn.mock.calls[0]![0]).toContain('gpt-magique')
  })
})

describe('021 CA4 : information précise sur 2 déclencheurs ou un déclencheur spécifique', () => {
  const julien = () => personaById('release-manager')
  const sarah = () => personaById('support-n1')

  it('Julien, « Quel déploiement récent ? » : v2.41.0, ni 10 connexions ni v2.40.3', async () => {
    const text = await answer(julien(), 'Quel déploiement récent ?')
    expect(text).toContain('v2.41.0')
    expect(text).not.toContain('10 connexions')
    expect(text).not.toContain('v2.40.3')
  })

  it('Julien, changelog (déclencheur spécifique) : 10 connexions', async () => {
    expect(await answer(julien(), 'Quel est le changelog de la release ?')).toContain('10 connexions')
  })

  it('Julien, pool et timeouts (2 déclencheurs) : 10', async () => {
    expect(await answer(julien(), 'Quelle configuration du pool et des timeouts ?')).toContain('10')
  })

  it('Sarah, « Et la carte ? » (un seul déclencheur) : pas de carte cadeau', async () => {
    expect(await answer(sarah(), 'Et la carte ?')).not.toContain('carte cadeau')
  })

  it('Sarah, « Des clients débités deux fois ? » : deux fois', async () => {
    expect(await answer(sarah(), 'Des clients débités deux fois ?')).toContain('deux fois')
  })

  it('deux formes du même mot ou deux déclencheurs qui se chevauchent comptent pour un', () => {
    const persona: NpcPersona = {
      ...sarah(),
      knows: ['Rien à signaler.'],
      onPreciseQuestion: [{ triggers: [{ text: 'débit', specific: false }, { text: 'débités', specific: false }, { text: 'prochain point', specific: false }, { text: 'point', specific: false }], text: 'Précis.' }],
    }
    expect(rankExcerpts(persona, 'Débités ?')).toEqual([])
    expect(rankExcerpts(persona, 'Le prochain point ?')).toEqual([])
    expect(rankExcerpts(persona, 'Débités, et le prochain point ?').map(excerpt => excerpt.text)).toEqual(['Précis.'])
  })
})

describe('021 CA5 : nouveaux PNJ (Thomas Keller, Inès Garnier)', () => {
  it('Thomas, maintenance ou incident : aucune maintenance', async () => {
    expect((await answer(personaById('psp'), 'Vous avez une maintenance ou un incident en cours ?')).toLowerCase()).toContain('aucune maintenance')
  })

  it('Thomas, connexions ouvertes : 10', async () => {
    expect(await answer(personaById('psp'), 'Combien de connexions ouvrons-nous chez vous ?')).toContain('10')
  })

  it('Inès, page de statut : message validé', async () => {
    expect(await answer(personaById('communication'), 'Que publie-t-on sur la page de statut ?')).toContain('valid')
  })

  it('Thomas et Inès ignorent les versions', async () => {
    for (const id of ['psp', 'communication']) {
      for (const question of [DEPLOY_QUESTION, 'Quel est le changelog ?', 'Un rollback vers la v2.40.3 ?']) {
        const text = await answer(personaById(id), question)
        expect(text).not.toContain('v2.41.0')
        expect(text).not.toContain('v2.40.3')
      }
    }
  })
})

describe('021 ajustements : questions naturelles, esquive des questions vagues, tolérance des déclencheurs', () => {
  const sources = async (id: string, question: string) => (await retriever.retrieve(personaById(id), question)).map(excerpt => excerpt.source)

  it('Julien, « vous avez déployé quelque chose récemment ? » : la version déployée (puce « Sait »)', async () => {
    const text = await answer(personaById('release-manager'), 'Vous avez déployé quelque chose récemment ?')
    expect(text).toContain('v2.41.0')
    expect(text).not.toContain('10 connexions')
  })

  it('Julien, « combien de connexions vers le PSP ? » : le pool de 10', async () => {
    expect(await answer(personaById('release-manager'), 'Combien de connexions vers le PSP ?')).toContain('10 connexions')
  })

  it('Thomas, appels et requêtes lents à arriver : connexions et attente côté client', async () => {
    for (const question of ['Nos appels arrivent comment chez vous ?', 'Nos requêtes mettent du temps à arriver ?']) {
      const text = await answer(personaById('psp'), question)
      expect(text, question).toContain('10 connexions simultanées')
      expect(text, question).toContain('chez vous')
    }
  })

  it('Inès, « on promet un remboursement aux clients ? » : aucune promesse', async () => {
    expect(await answer(personaById('communication'), 'On promet un remboursement aux clients ?')).toContain('aucune promesse de remboursement')
  })

  it('questions vagues : esquive pour Julien, Thomas, Inès, et jamais d\'information précise chez personne', async () => {
    for (const question of ['Aide-nous', 'Pourquoi nos paiements sont lents ?']) {
      for (const id of ['release-manager', 'psp', 'communication']) {
        expect(await answer(personaById(id), question), `${id} : ${question}`).toBe(personaById(id).deflection)
      }
      for (const persona of loadPersonas()) {
        expect(await sources(persona.id, question), `${persona.id} : ${question}`).not.toContain('precise')
      }
    }
  })

  // Choix assumé : « qu'est-ce qui a changé ? » est la bonne question au Release Manager, il livre le
  // changelog, grâce au déclencheur explicite « changé » et non par une tolérance de préfixe
  it('Julien, « qu\'est-ce qui a changé ? » : le changelog, par le déclencheur « changé »', async () => {
    expect(await answer(personaById('release-manager'), 'Qu\'est-ce qui a changé ?')).toContain('10 connexions')
  })

  it('tolérance des déclencheurs : formes fléchies oui, mot de la question tronqué de plus d\'une lettre non', () => {
    expect(triggerWordMatches('debit', 'debites')).toBe(true)
    expect(triggerWordMatches('publier', 'publie')).toBe(true)
    expect(triggerWordMatches('connexion', 'connexions')).toBe(true)
    expect(triggerWordMatches('changelog', 'change')).toBe(false)
    expect(triggerWordMatches('changement', 'change')).toBe(false)
    expect(triggerWordMatches('psp', 'ps')).toBe(false)
    const persona: NpcPersona = {
      ...personaById('release-manager'),
      knows: ['Rien.'],
      onPreciseQuestion: [{ triggers: [{ text: 'changelog', specific: true }], text: 'Le changelog.' }],
    }
    expect(rankExcerpts(persona, 'Qu\'est-ce qui change ?')).toEqual([])
    expect(rankExcerpts(persona, 'Le changelog ?').map(excerpt => excerpt.text)).toEqual(['Le changelog.'])
  })
})

describe('021 ajustements : cohérence de Sarah avec le scénario', () => {
  it('tickets en évolution (une dizaine, puis une quarantaine) et premier ticket juste avant la première alerte', async () => {
    const sarah = personaById('support-n1')
    expect(await answer(sarah, 'Combien de tickets ?')).toMatch(/une dizaine de tickets au début, puis une quarantaine au bout de 10 minutes/)
    expect(await answer(sarah, 'Depuis quand ?')).toContain('juste avant votre première alerte')
  })
})
