import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NpcPersona } from '../shared/types/npc'
import type { Scenario, ScenarioStep } from '../shared/types/scenario'
import {
  ScenarioConflictError,
  ScenarioNotFoundError,
  createScenarioRunner,
  publishScenarioStep,
} from '../server/utils/scenario-runner'
import { createFaultState } from '../server/utils/fault-state'
import { clearMessages, listMessages, resetChatStore } from '../server/utils/chat-store'
import { SCENARIO_LABEL_MAX_LENGTH, formatScenarioOffset, scenarioStepLabel } from '../shared/utils/scenarios'
import { personaById } from './npc-helpers'

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0)

/** Planificateur simulé : les tâches s'exécutent quand advance() fait passer l'horloge à leur échéance */
function fakeClock() {
  let time = T0
  let nextId = 1
  const tasks = new Map<number, { due: number, fn: () => void }>()
  return {
    now: () => time,
    schedule: (fn: () => void, delayMs: number) => {
      const id = nextId++
      tasks.set(id, { due: time + delayMs, fn })
      return id
    },
    cancel: (id: number) => {
      tasks.delete(id)
    },
    pending: () => tasks.size,
    advance(ms: number) {
      const target = time + ms
      for (;;) {
        const next = [...tasks.entries()].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        tasks.delete(next[0])
        time = next[1].due
        next[1].fn()
      }
      time = target
    },
  }
}

const DEMO: Scenario = {
  id: 'demo',
  title: 'Démo',
  description: 'Test',
  steps: [
    { at: 0, channelId: 'incident-en-cours', kind: 'alert', severity: 'SEV2', title: 'Latence', service: 'api', text: 'Lent' },
    { at: 3, channelId: 'general', kind: 'announcement', text: 'Le support appelle' },
    { at: 6, channelId: 'incident-en-cours', kind: 'alert', severity: 'SEV1', title: '5xx', service: 'api', text: 'Erreurs' },
  ],
}

const BROKEN: Scenario = {
  id: 'broken',
  title: 'Canal disparu',
  description: 'Test',
  steps: [
    { at: 0, channelId: 'general', kind: 'announcement', text: 'Début' },
    { at: 2, channelId: 'canal-inconnu', kind: 'announcement', text: 'Perdu' },
    { at: 4, channelId: 'general', kind: 'announcement', text: 'Fin' },
  ],
}

function setup() {
  const clock = fakeClock()
  const runner = createScenarioRunner({ ...clock, publish: publishScenarioStep, scenarios: [DEMO, BROKEN] })
  return { clock, runner }
}

function messageCount(): number {
  return listMessages('general').length + listMessages('incident-en-cours').length
}

describe('scenario-runner', () => {
  beforeEach(() => resetChatStore())

  it('liste les scénarios avec nombre d\'étapes et durée, sans run au départ', () => {
    const { runner } = setup()
    expect(runner.list()).toEqual([
      { id: 'demo', title: 'Démo', description: 'Test', stepCount: 3, durationSeconds: 6 },
      { id: 'broken', title: 'Canal disparu', description: 'Test', stepCount: 3, durationSeconds: 4 },
    ])
    expect(runner.getRun()).toBeNull()
  })

  it('publie l\'étape at: 0 au lancement, les suivantes seulement après leur délai', () => {
    const { clock, runner } = setup()
    const run = runner.start('demo')
    expect(run).toMatchObject({ scenarioId: 'demo', title: 'Démo', status: 'running', startedAt: new Date(T0).toISOString() })
    expect(run.steps.map(step => step.status)).toEqual(['published', 'pending', 'pending'])
    expect(run.steps[0]).toMatchObject({ index: 0, at: 0, kind: 'alert', channelId: 'incident-en-cours', label: 'Latence' })
    expect(run.steps[0]!.publishedAt).toBe(new Date(T0).toISOString())
    expect(listMessages('incident-en-cours')).toHaveLength(1)
    expect(listMessages('incident-en-cours')[0]).toMatchObject({ kind: 'alert', alert: { severity: 'SEV2', title: 'Latence' } })

    clock.advance(2_999)
    expect(listMessages('general')).toHaveLength(0)
    clock.advance(1)
    expect(listMessages('general')[0]).toMatchObject({ kind: 'announcement', text: 'Le support appelle' })
    expect(runner.getRun()!.steps[1]).toMatchObject({ status: 'published', publishedAt: new Date(T0 + 3_000).toISOString() })
    expect(runner.getRun()!.status).toBe('running')
  })

  it('passe à finished après la dernière étape', () => {
    const { clock, runner } = setup()
    runner.start('demo')
    clock.advance(6_000)
    const run = runner.getRun()!
    expect(run.status).toBe('finished')
    expect(run.steps.map(step => step.status)).toEqual(['published', 'published', 'published'])
    expect(messageCount()).toBe(3)
    expect(clock.pending()).toBe(0)
  })

  it('stop annule les étapes restantes et ne publie plus rien', () => {
    const { clock, runner } = setup()
    runner.start('demo')
    clock.advance(3_000)
    const stopped = runner.stop()!
    expect(stopped.status).toBe('stopped')
    expect(stopped.steps.map(step => step.status)).toEqual(['published', 'published', 'cancelled'])
    expect(clock.pending()).toBe(0)
    clock.advance(60_000)
    expect(messageCount()).toBe(2)
    expect(runner.getRun()!.status).toBe('stopped')
  })

  it('stop sans run en cours renvoie null', () => {
    const { clock, runner } = setup()
    expect(runner.stop()).toBeNull()
    runner.start('demo')
    clock.advance(6_000)
    expect(runner.stop()).toBeNull()
    expect(runner.getRun()!.status).toBe('finished')
  })

  it('refuse un second lancement pendant un run (409), distinct du scénario inconnu (404)', () => {
    const { clock, runner } = setup()
    expect(() => runner.start('inconnu')).toThrow(ScenarioNotFoundError)
    runner.start('demo')
    let caught: unknown
    try {
      runner.start('broken')
    }
    catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ScenarioConflictError)
    expect(caught).not.toBeInstanceOf(ScenarioNotFoundError)
    expect(runner.getRun()!.scenarioId).toBe('demo')

    // Relançable une fois terminé ou arrêté
    clock.advance(6_000)
    expect(runner.start('demo').status).toBe('running')
    runner.stop()
    expect(runner.start('broken').scenarioId).toBe('broken')
  })

  it('marque failed une étape vers un canal inconnu, et publie les suivantes', () => {
    const { clock, runner } = setup()
    runner.start('broken')
    clock.advance(4_000)
    const run = runner.getRun()!
    expect(run.steps.map(step => step.status)).toEqual(['published', 'failed', 'published'])
    expect(run.steps[1]).not.toHaveProperty('publishedAt')
    expect(run.status).toBe('finished')
    expect(listMessages('general').map(message => message.text)).toEqual(['Début', 'Fin'])
  })

  it('l\'arrêt par réinitialisation (stop puis clearMessages) se comporte comme stop', () => {
    const { clock, runner } = setup()
    runner.start('demo')
    // Ce que fait POST /api/admin/reset
    runner.stop()
    clearMessages()
    clock.advance(10_000)
    expect(messageCount()).toBe(0)
    expect(runner.getRun()!.steps.map(step => step.status)).toEqual(['published', 'cancelled', 'cancelled'])
    expect(runner.getRun()!.status).toBe('stopped')
  })

  it('renvoie des copies : modifier l\'état renvoyé ne touche pas l\'exécuteur', () => {
    const { runner } = setup()
    const run = runner.start('demo')
    run.status = 'stopped'
    run.steps[1]!.status = 'cancelled'
    expect(runner.getRun()!.status).toBe('running')
    expect(runner.getRun()!.steps[1]!.status).toBe('pending')
  })
})

const WITH_NPC: Scenario = {
  id: 'pnj',
  title: 'Lanceur d\'alerte',
  description: 'Test',
  steps: [
    { at: 0, channelId: 'incident-en-cours', kind: 'npc-message', npcId: 'support-n1', text: 'Les clients ne peuvent plus payer.' },
    { at: 2, channelId: 'incident-en-cours', kind: 'npc-message', npcId: 'inconnu', text: 'Personne' },
    { at: 4, channelId: 'incident-en-cours', kind: 'alert', severity: 'SEV2', title: 'Latence', service: 'api', text: 'Lent' },
  ],
}

describe('scenario-runner : étapes npc-message (021 CA2)', () => {
  beforeEach(() => resetChatStore())

  const sarah = personaById('support-n1')
  const findNpc = (id: string): NpcPersona | undefined => (id === sarah.id ? sarah : undefined)

  it('publie avec la fiche résolue et passe en published ; label « Nom : début du texte »', () => {
    const clock = fakeClock()
    const publish = vi.fn<(step: ScenarioStep, npc?: NpcPersona) => void>()
    const runner = createScenarioRunner({ ...clock, publish, findNpc, scenarios: [WITH_NPC] })
    const run = runner.start('pnj')
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(WITH_NPC.steps[0], sarah)
    expect(run.steps[0]).toMatchObject({ kind: 'npc-message', status: 'published', label: 'Sarah Benali : Les clients ne peuvent plus payer.' })
    expect(run.steps[0]!.label.startsWith(sarah.name)).toBe(true)
  })

  it('npcId inconnu : failed, sans bloquer les étapes suivantes', () => {
    const clock = fakeClock()
    const publish = vi.fn<(step: ScenarioStep, npc?: NpcPersona) => void>()
    const runner = createScenarioRunner({ ...clock, publish, findNpc, scenarios: [WITH_NPC] })
    runner.start('pnj')
    clock.advance(4_000)
    const run = runner.getRun()!
    expect(run.steps.map(step => step.status)).toEqual(['published', 'failed', 'published'])
    expect(run.status).toBe('finished')
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1]![0]).toBe(WITH_NPC.steps[2])
  })

  it('publication réelle : message racine signé de la fiche, avec npc, sans kind', () => {
    const clock = fakeClock()
    const runner = createScenarioRunner({ ...clock, publish: publishScenarioStep, findNpc, scenarios: [WITH_NPC] })
    runner.start('pnj')
    const [message] = listMessages('incident-en-cours')
    expect(message).toMatchObject({ author: 'Sarah Benali', text: 'Les clients ne peuvent plus payer.', npc: { id: 'support-n1', role: sarah.role } })
    expect(message!.parentId).toBeUndefined()
    expect(message!.kind).toBeUndefined()
  })

  it('sans findNpc : l\'étape npc-message passe en failed', () => {
    const clock = fakeClock()
    const runner = createScenarioRunner({ ...clock, publish: publishScenarioStep, scenarios: [WITH_NPC] })
    expect(runner.start('pnj').steps[0]).toMatchObject({ status: 'failed', label: 'support-n1 : Les clients ne peuvent plus payer.' })
    expect(listMessages('incident-en-cours')).toHaveLength(0)
  })
})

describe('shared/utils/scenarios', () => {
  it('formate le délai en +MM:SS', () => {
    expect(formatScenarioOffset(0)).toBe('+00:00')
    expect(formatScenarioOffset(6)).toBe('+00:06')
    expect(formatScenarioOffset(100)).toBe('+01:40')
    expect(formatScenarioOffset(840)).toBe('+14:00')
  })

  it('prend le titre d\'une alerte et le début d\'une annonce', () => {
    expect(scenarioStepLabel(DEMO.steps[0]!)).toBe('Latence')
    expect(scenarioStepLabel({ at: 0, channelId: 'general', kind: 'announcement', text: ' Court ' })).toBe('Court')
    const long = scenarioStepLabel({ at: 0, channelId: 'general', kind: 'announcement', text: 'mot '.repeat(50) })
    expect(long.length).toBeLessThanOrEqual(SCENARIO_LABEL_MAX_LENGTH)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('scenario-runner : étapes fault', () => {
  beforeEach(() => resetChatStore())

  const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

  function faultSetup(applyFault: (name: string, value: number) => Promise<void>, steps: ScenarioStep[]) {
    const clock = fakeClock()
    const faults = createFaultState()
    const scenario: Scenario = { id: 'f', title: 'Pannes', description: 'Test', steps }
    const runner = createScenarioRunner({ ...clock, publish: publishScenarioStep, applyFault, faults, scenarios: [scenario] })
    return { clock, faults, runner }
  }

  const ann = (at: number, text: string, when?: ScenarioStep['when']): ScenarioStep =>
    ({ at, channelId: 'general', kind: 'announcement', text, when })

  it('applique la panne à at exactement, met à jour le registre et publie l\'étape (CA2)', async () => {
    const applyFault = vi.fn(async () => {})
    const { clock, faults, runner } = faultSetup(applyFault, [{ at: 60, kind: 'fault', name: 'upload_latency', value: 3 }])
    const run = runner.start('f')
    expect(run.steps[0]).toMatchObject({ kind: 'fault', label: 'Panne upload_latency=3', channelId: '' })
    clock.advance(59_000)
    await flush()
    expect(applyFault).not.toHaveBeenCalled()
    clock.advance(1_000)
    await flush()
    expect(applyFault).toHaveBeenCalledTimes(1)
    expect(applyFault).toHaveBeenCalledWith('upload_latency', 3)
    expect(faults.isActive('upload_latency')).toBe(true)
    expect(runner.getRun()!.steps[0]!.status).toBe('published')
    expect(runner.getRun()!.status).toBe('finished')
  })

  it('étape failed si le client rejette, registre inchangé, le scénario continue (CA3)', async () => {
    const { clock, faults, runner } = faultSetup(async () => { throw new Error('HTTP 500') }, [
      { at: 1, kind: 'fault', name: 'upload_latency', value: 3 },
      ann(2, 'Suite'),
    ])
    runner.start('f')
    clock.advance(1_000)
    await flush()
    expect(runner.getRun()!.steps[0]!.status).toBe('failed')
    expect(faults.activeNames()).toEqual([])
    clock.advance(1_000)
    await flush()
    expect(runner.getRun()!.steps[1]!.status).toBe('published')
    expect(runner.getRun()!.status).toBe('finished')
    expect(listMessages('general').map(m => m.text)).toEqual(['Suite'])
  })

  it('applyFault qui lève de façon synchrone donne aussi failed', async () => {
    const { runner } = faultSetup((() => { throw new Error('x') }) as never, [{ at: 0, kind: 'fault', name: 'a', value: 1 }])
    runner.start('f')
    await flush()
    expect(runner.getRun()!.steps[0]!.status).toBe('failed')
  })

  it('condition when évaluée à at : active true / false, panne activée puis coupée (CA4)', async () => {
    const steps: ScenarioStep[] = [
      { at: 1, kind: 'fault', name: 'upload_latency', value: 3 },
      ann(2, 'si-active', { fault: 'upload_latency', active: true }),
      ann(2, 'si-inactive', { fault: 'upload_latency', active: false }),
      { at: 3, kind: 'fault', name: 'upload_latency', value: 0 },
      ann(4, 'apres-active', { fault: 'upload_latency', active: true }),
      ann(4, 'apres-inactive', { fault: 'upload_latency', active: false }),
    ]
    const { clock, runner } = faultSetup(async () => {}, steps)
    runner.start('f')
    for (let i = 0; i < 4; i++) {
      clock.advance(1_000)
      await flush()
    }
    expect(runner.getRun()!.steps.map(s => s.status)).toEqual([
      'published', 'published', 'cancelled', 'published', 'cancelled', 'published',
    ])
    expect(listMessages('general').map(m => m.text)).toEqual(['si-active', 'apres-inactive'])
    expect(runner.getRun()!.status).toBe('finished')
  })

  it('stop coupe exactement les pannes activées avec succès et vide le registre (CA5)', async () => {
    const applyFault = vi.fn(async (name: string, value: number) => {
      if (name === 'b' && value === 0) throw new Error('coupure impossible')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { clock, faults, runner } = faultSetup(applyFault, [
      { at: 1, kind: 'fault', name: 'a', value: 2 },
      { at: 1, kind: 'fault', name: 'b', value: 5 },
      { at: 1, kind: 'fault', name: 'c', value: 0 },
      { at: 1, kind: 'fault', name: 'd', value: 1 },
      ann(100, 'tard'),
    ])
    runner.start('f')
    clock.advance(1_000)
    await flush()
    applyFault.mockClear()
    expect(faults.activeNames().sort()).toEqual(['a', 'b', 'd'])
    runner.stop()
    await flush()
    expect(applyFault.mock.calls.sort()).toEqual([['a', 0], ['b', 0], ['d', 0]])
    expect(faults.activeNames()).toEqual([])
    expect(faults.get('a')).toBeUndefined()
    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it('coupe une panne dont l\'appel se résout après l\'arrêt', async () => {
    let resolve!: () => void
    const applyFault = vi.fn((_name: string, value: number) => value === 0 ? Promise.resolve() : new Promise<void>((r) => { resolve = r }))
    const { clock, faults, runner } = faultSetup(applyFault, [{ at: 1, kind: 'fault', name: 'a', value: 2 }])
    runner.start('f')
    clock.advance(1_000)
    runner.stop()
    resolve()
    await flush()
    expect(applyFault).toHaveBeenLastCalledWith('a', 0)
    expect(faults.activeNames()).toEqual([])
  })
})
