// 036 CA1 et CA2 : modèle d'architecture (environnement et instantané injectés), sans secret
import { describe, expect, it } from 'vitest'
import type { NpcAdminState } from '../shared/types/npc'
import type { ScenarioRun } from '../shared/types/scenario'
import { buildArchitecture, type ArchitectureSnapshot } from '../server/utils/architecture'

function npcState(overrides: Partial<NpcAdminState> = {}): NpcAdminState {
  return {
    enabled: true,
    npcs: [{ id: 'release', name: 'Julien Moreau', role: 'Release Manager' }],
    engine: 'keywords',
    lastModelCall: null,
    scenarioId: 'panne-checkout',
    spontaneous: true,
    ...overrides,
  }
}

function snapshot(overrides: Partial<ArchitectureSnapshot> = {}): ArchitectureSnapshot {
  return { npc: npcState(), run: null, personas: { source: 'embedded', count: 8 }, ...overrides }
}

function active(model: ReturnType<typeof buildArchitecture>, id: string): boolean | undefined {
  return model.components.find(component => component.id === id)?.active
}

const IDS = ['participants', 'facilitator', 'nuxt-pages', 'api', 'scenario-runner', 'npc-dispatcher', 'spontaneous', 'persistence',
  'storage-memory', 'storage-fs', 'storage-redis', 'engine-keywords', 'engine-openai', 'engine-anthropic', 'personas-embedded',
  'personas-directory', 'hosting-render', 'hosting-kubernetes', 'hosting-local']

describe('buildArchitecture', () => {
  it('hébergement : kubernetes prioritaire sur render, render, sinon local', () => {
    const k8s = buildArchitecture({ KUBERNETES_SERVICE_HOST: '10.0.0.1', RENDER: 'true' }, snapshot())
    expect(k8s.hosting).toBe('kubernetes')
    expect(active(k8s, 'hosting-kubernetes')).toBe(true)
    expect(active(k8s, 'hosting-render')).toBe(false)
    expect(buildArchitecture({ RENDER: 'true' }, snapshot()).hosting).toBe('render')
    const local = buildArchitecture({}, snapshot())
    expect(local.hosting).toBe('local')
    expect(active(local, 'hosting-local')).toBe(true)
  })

  it('stockage : Redis réduit à hôte:port, mémoire par défaut, fs sans chemin', () => {
    const redis = buildArchitecture({ REDIS_URL: 'redis://:s3cret@redis:6379' }, snapshot())
    expect(redis.storage).toEqual({ driver: 'redis', host: 'redis:6379' })
    expect(active(redis, 'storage-redis')).toBe(true)
    expect(active(redis, 'storage-memory')).toBe(false)
    expect(active(redis, 'storage-fs')).toBe(false)
    expect(buildArchitecture({}, snapshot()).storage).toEqual({ driver: 'memory' })
    const fs = buildArchitecture({ CHAT_DATA_DIR: '/var/secret-dir' }, snapshot())
    expect(fs.storage).toEqual({ driver: 'fs' })
    expect(JSON.stringify(fs)).not.toContain('secret-dir')
  })

  it('moteur openai-compatible : modèle et hôte, sans identifiants', () => {
    const model = buildArchitecture(
      { NPC_LLM_BASE_URL: 'http://user:pw@ollama:11434/v1', NPC_LLM_MODEL: 'qwen2.5:1.5b' },
      snapshot({ npc: npcState({ engine: 'openai-compatible' }) }),
    )
    expect(model.npcEngine).toMatchObject({ name: 'openai-compatible', model: 'qwen2.5:1.5b', host: 'ollama:11434' })
    expect(active(model, 'engine-openai')).toBe(true)
    expect(active(model, 'engine-keywords')).toBe(false)
  })

  it('moteur anthropic : modèle par défaut et hôte de l\'API', () => {
    const model = buildArchitecture({}, snapshot({ npc: npcState({ engine: 'anthropic' }) }))
    expect(model.npcEngine.host).toBe('api.anthropic.com')
    expect(model.npcEngine.model).toBeTruthy()
    expect(active(model, 'engine-anthropic')).toBe(true)
    const custom = buildArchitecture({ NPC_ANTHROPIC_MODEL: 'm-1' }, snapshot({ npc: npcState({ engine: 'anthropic' }) }))
    expect(custom.npcEngine.model).toBe('m-1')
  })

  it('moteur keywords : ni modèle ni hôte, même avec les variables du modèle', () => {
    const model = buildArchitecture({ NPC_LLM_BASE_URL: 'http://ollama:11434/v1', NPC_LLM_MODEL: 'x' }, snapshot())
    expect(model.npcEngine.name).toBe('keywords')
    expect(model.npcEngine).not.toHaveProperty('model')
    expect(model.npcEngine).not.toHaveProperty('host')
    expect(active(model, 'engine-keywords')).toBe(true)
  })

  it('URL invalide : hôte absent', () => {
    const model = buildArchitecture({ NPC_LLM_BASE_URL: 'pas une url' }, snapshot({ npc: npcState({ engine: 'openai-compatible' }) }))
    expect(model.npcEngine.host).toBeUndefined()
  })

  it('scénario : étape = étapes publiées, null sans exécution', () => {
    expect(buildArchitecture({}, snapshot()).scenario).toBeNull()
    const run: ScenarioRun = {
      scenarioId: 'panne-checkout',
      title: 'Panne checkout',
      status: 'running',
      startedAt: '2026-10-24T10:00:00.000Z',
      steps: [
        { index: 0, at: 0, kind: 'alert', channelId: 'c', label: 'a', status: 'published' },
        { index: 1, at: 10, kind: 'alert', channelId: 'c', label: 'b', status: 'published' },
        { index: 2, at: 20, kind: 'announcement', channelId: 'c', label: 'c', status: 'pending' },
      ],
    }
    const model = buildArchitecture({}, snapshot({ run }))
    expect(model.scenario).toEqual({ id: 'panne-checkout', title: 'Panne checkout', status: 'running', step: 2, totalSteps: 3 })
    expect(active(model, 'scenario-runner')).toBe(true)
    const finished = buildArchitecture({}, snapshot({ run: { ...run, status: 'finished' } }))
    expect(active(finished, 'scenario-runner')).toBe(false)
  })

  it('PNJ : coupés, aucun nom actif ; fiches en dossier', () => {
    const off = buildArchitecture({}, snapshot({ npc: npcState({ enabled: false }), personas: { source: 'dir', count: 16 } }))
    expect(off.npcs).toMatchObject({ enabled: false, active: [], scenarioId: 'panne-checkout', spontaneous: true })
    expect(active(off, 'npc-dispatcher')).toBe(false)
    expect(active(off, 'spontaneous')).toBe(false)
    expect(off.personas).toEqual({ source: 'directory', count: 16 })
    expect(active(off, 'personas-directory')).toBe(true)
    expect(active(off, 'personas-embedded')).toBe(false)
    expect(buildArchitecture({}, snapshot()).npcs.active).toEqual(['Julien Moreau'])
  })

  it('chaque composant requis a une légende non vide, et les liens relient des composants', () => {
    const model = buildArchitecture({}, snapshot())
    const ids = model.components.map(component => component.id)
    for (const id of IDS) expect(ids).toContain(id)
    for (const component of model.components) expect(component.legend.trim()).not.toBe('')
    expect(model.links).toContainEqual({ from: 'participants', to: 'api', label: 'polling HTTP' })
    for (const link of model.links) {
      expect(ids).toContain(link.from)
      expect(ids).toContain(link.to)
    }
  })

  it('aucun secret dans le modèle sérialisé', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-ant-SECRET',
      NPC_LLM_API_KEY: 'llm-SECRET',
      FACILITATOR_CODE: 'code-SECRET',
      REDIS_URL: 'redis://:s3cret@redis:6379',
      NPC_LLM_BASE_URL: 'http://user:pw@ollama:11434/v1',
      NPC_LLM_MODEL: 'qwen2.5:1.5b',
    }
    for (const engine of ['keywords', 'openai-compatible', 'anthropic']) {
      const json = JSON.stringify(buildArchitecture(env, snapshot({ npc: npcState({ engine }) })))
      for (const forbidden of ['SECRET', 's3cret', 'pw@', 'user:']) expect(json).not.toContain(forbidden)
    }
  })
})
