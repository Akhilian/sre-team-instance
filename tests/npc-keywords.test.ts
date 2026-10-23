// 019 CA2 : retriever lexical et moteur keywords, purs et déterministes
import { describe, expect, it, vi } from 'vitest'
import type { NpcPersona } from '../shared/types/npc'
import { createLexicalRetriever, rankExcerpts, significantWords } from '../server/npc/lexical-retriever'
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

  it('une puce précise n\'est éligible qu\'avec un mot déclencheur', async () => {
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
  it('Release Manager : le déploiement récent donne v2.41.0 et ses détails', async () => {
    const text = await answer(personaById('release-manager'), DEPLOY_QUESTION)
    expect(text).toContain('v2.41.0')
    expect(text).toContain('timeout de 30 s')
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
