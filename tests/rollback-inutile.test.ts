// 056 : scénario « Le rollback qui ne sert à rien » et extension `when` en liste du runner
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SCENARIOS } from '../server/scenarios'
import { rollbackInutile } from '../server/scenarios/rollback-inutile'
import { createFaultState } from '../server/utils/fault-state'
import { clearMessages, listMessages, resetChatStore } from '../server/utils/chat-store'
import { createScenarioRunner, publishScenarioStep } from '../server/utils/scenario-runner'
import { createTeamActions } from '../server/utils/team-actions'
import type { DocshareClient } from '../server/utils/docshare-client'
import type { Scenario, ScenarioCondition, ScenarioStep } from '../shared/types/scenario'
import { loadPersonas } from './npc-helpers'

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Horloge simulée qui laisse les promesses se régler après chaque tâche */
function fakeClock() {
  let time = Date.UTC(2026, 9, 27, 14, 0, 0)
  let nextId = 1
  const tasks = new Map<number, { due: number, fn: () => void }>()
  return {
    now: () => time,
    schedule: (fn: () => void, delayMs: number) => {
      const id = nextId++
      tasks.set(id, { due: time + delayMs, fn })
      return id
    },
    cancel: (id: number) => { tasks.delete(id) },
    async advanceTo(seconds: number, from: number) {
      const target = from + seconds * 1000
      for (;;) {
        const next = [...tasks.entries()].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        tasks.delete(next[0])
        time = next[1].due
        next[1].fn()
        await flush()
      }
      time = target
    },
  }
}

describe('056 CA1 : when en liste (ET)', () => {
  beforeEach(() => resetChatStore())

  const A: ScenarioCondition = { fault: 'a', active: true }
  const B: ScenarioCondition = { fault: 'b', active: true }

  async function outcome(when: ScenarioStep['when'], active: string[]): Promise<string> {
    const clock = fakeClock()
    const faults = createFaultState()
    for (const name of active) faults.set(name, 1)
    const scenario: Scenario = { id: 's', title: 't', description: 'd', steps: [{ at: 1, channelId: 'general', kind: 'announcement', text: 'x', when }] }
    const runner = createScenarioRunner({ ...clock, publish: publishScenarioStep, faults, scenarios: [scenario] })
    runner.start('s')
    await clock.advanceTo(1, clock.now())
    return runner.getRun()!.steps[0]!.status
  }

  it.each([
    [[], 'cancelled'],
    [['a'], 'cancelled'],
    [['b'], 'cancelled'],
    [['a', 'b'], 'published'],
  ])('liste [a, b] avec pannes %j : %s', async (active, expected) => {
    expect(await outcome([A, B], active)).toBe(expected)
  })

  it('liste vide = toujours vraie ; condition seule et absence de when inchangées', async () => {
    expect(await outcome([], [])).toBe('published')
    expect(await outcome(A, [])).toBe('cancelled')
    expect(await outcome(A, ['a'])).toBe('published')
    expect(await outcome(undefined, [])).toBe('published')
  })

  it('liste mêlant active vrai et faux', async () => {
    const mixed = [A, { fault: 'b', active: false }]
    expect(await outcome(mixed, ['a'])).toBe('published')
    expect(await outcome(mixed, ['a', 'b'])).toBe('cancelled')
  })
})

describe('056 CA2, CA4, CA5 : catalogue', () => {
  const steps = rollbackInutile.steps
  const alerts = steps.filter(step => step.kind === 'alert')

  it('CA2 : présent, trié, pannes aux bonnes dates, 9 alertes SEV2 sous A', () => {
    expect(SCENARIOS.map(scenario => scenario.id)).toContain('rollback-inutile')
    const ats = steps.map(step => step.at)
    expect(ats).toEqual([...ats].sort((a, b) => a - b))
    expect(steps[0]).toMatchObject({ at: 0, kind: 'fault', name: 'stale_index', value: 1 })
    expect(steps.find(step => step.kind === 'fault' && step.name === 'upload_latency')).toMatchObject({ at: 360, value: 2.0 })
    expect(alerts.map(alert => alert.at)).toEqual([390, 690, 990, 1290, 1590, 1890, 2190, 2490, 2790])
    for (const alert of alerts) {
      expect(alert).toMatchObject({ severity: 'SEV2', title: 'Latence d\'upload élevée', service: 'docshare-upload', when: { fault: 'upload_latency', active: true } })
      expect(JSON.stringify(alert).toLowerCase()).not.toMatch(/index|document|recherche/)
    }
    expect(steps.some(step => step.kind === 'alert' && /stale|index/i.test(step.title))).toBe(false)
  })

  it('CA4 : actions, délais, pannes, changelog ; aucun texte ne nomme les pannes', () => {
    const actions = rollbackInutile.actions!
    expect(actions).toHaveLength(5)
    expect(actions.find(action => action.label === 'Revenir à la version précédente')).toMatchObject({ type: 'simulated', delaySeconds: 20, faults: [{ name: 'stale_index', value: 0 }] })
    expect(actions.find(action => action.label === 'Redémarrer la base')).toMatchObject({ type: 'simulated', delaySeconds: 45, faults: [{ name: 'upload_latency', value: 0 }] })
    expect(actions.map(action => action.type)).toEqual(['simulated', 'simulated', 'index-check', 'reindex', 'changelog'])
    const changelog = actions.find(action => action.type === 'changelog')!.text!
    expect(changelog).toContain('14h05')
    expect(changelog).toContain('optimisation de l\'indexation')
    expect(changelog).toContain('nouveau chemin d\'upload')
    const texts = [...steps.flatMap(step => step.kind === 'fault' ? [] : [step.text]), ...actions.flatMap(a => [a.label, a.startText, a.doneText, a.text])]
    for (const text of texts) expect(text ?? '').not.toMatch(/stale_index|upload_latency/)
  })

  it('CA5 : 3 fiches, npcId existants, dernière étape à 5 400', () => {
    const personas = loadPersonas('rollback-inutile')
    expect(personas.map(persona => persona.id).sort()).toEqual(['communication-docshare', 'direction-docshare', 'support-docshare'])
    for (const step of steps) if (step.kind === 'npc-message') expect(personas.map(p => p.id)).toContain(step.npcId)
    expect(steps.at(-1)).toMatchObject({ at: 5400, kind: 'announcement' })
  })
})

describe('056 CA3 et CA5 : déroulé avec horloge et client simulés', () => {
  beforeEach(() => resetChatStore())

  function setup() {
    const clock = fakeClock()
    const start = clock.now()
    const faults = createFaultState()
    const personas = loadPersonas('rollback-inutile')
    const runner = createScenarioRunner({
      ...clock,
      publish: publishScenarioStep,
      applyFault: async () => {},
      faults,
      findNpc: id => personas.find(persona => persona.id === id),
      scenarios: [rollbackInutile],
    })
    const client = {
      enabled: true,
      setFault: vi.fn(async () => {}),
      getFaults: vi.fn(async () => ({})),
      indexCheck: vi.fn(async () => ({ summary: 'ok' })),
      startReindex: vi.fn(async () => ({ state: 'running' as const, processed: 0, total: 1 })),
      getReindex: vi.fn(async () => ({ state: 'running' as const, processed: 0, total: 1 })),
    } satisfies DocshareClient
    const actions = createTeamActions({
      client: () => client,
      faults,
      getRun: runner.getRun,
      scenarios: () => [rollbackInutile],
      postOps: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
    })
    const texts = () => listMessages('incident-en-cours').map(message => message.text)
    return { clock, start, runner, actions, texts }
  }

  it('A active : alerte à 390 s ; rollback seul puis message « rollback inutile » à 1 200 s', async () => {
    const { clock, start, runner, actions, texts } = setup()
    runner.start('rollback-inutile')
    await clock.advanceTo(389, start)
    expect(texts().filter(t => t.includes('p95'))).toHaveLength(0)
    await clock.advanceTo(390, start)
    expect(texts().filter(t => t.includes('p95'))).toHaveLength(1)
    await clock.advanceTo(1000, start)
    await actions.run('revenir-version', 'Alice')
    await clock.advanceTo(1020, start)
    await clock.advanceTo(1200, start)
    expect(texts().filter(t => t.includes('le rollback n\'a pas réglé la latence'))).toHaveLength(1)
    expect(texts().some(t => t.includes('clore'))).toBe(false)
  })

  it('A coupée seule : alertes suivantes cancelled, demande de clore à 1 500 s', async () => {
    const { clock, start, runner, actions, texts } = setup()
    runner.start('rollback-inutile')
    await clock.advanceTo(1000, start)
    await actions.run('redemarrer-base', 'Alice')
    await clock.advanceTo(1500, start)
    const run = runner.getRun()!
    const status = (at: number, kind: string) => run.steps.find(step => step.at === at && step.kind === kind)!.status
    expect(status(990, 'alert')).toBe('published')
    expect(status(1290, 'alert')).toBe('cancelled')
    expect(status(1500, 'npc-message')).toBe('published')
    expect(texts().some(t => t.includes('clore l\'incident'))).toBe(true)
    expect(texts().some(t => t.includes('le rollback n\'a pas réglé'))).toBe(false)
  })

  it('A et B coupées : ni message « rollback » ni demande de clore ; 5 actions exposées à 5 399 s', async () => {
    const { clock, start, runner, actions, texts } = setup()
    runner.start('rollback-inutile')
    await clock.advanceTo(1000, start)
    await actions.run('revenir-version', 'Alice')
    await actions.run('redemarrer-base', 'Alice')
    await clock.advanceTo(5399, start)
    expect(texts().some(t => /rollback|clore/.test(t))).toBe(false)
    expect(runner.getRun()!.status).toBe('running')
    expect(actions.list().map(action => action.id)).toHaveLength(5)
    await clock.advanceTo(5400, start)
    expect(runner.getRun()!.status).toBe('finished')
    clearMessages()
  })
})
