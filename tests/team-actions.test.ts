import { describe, expect, it, vi } from 'vitest'
import type { Scenario, ScenarioRun } from '../shared/types/scenario'
import { createFaultState } from '../server/utils/fault-state'
import { clearMessages, listMessages, resetChatStore } from '../server/utils/chat-store'
import type { DocshareClient, ReindexStatus } from '../server/utils/docshare-client'
import { ACTION_ERROR_TEXT, TeamActionNotFoundError, createTeamActions } from '../server/utils/team-actions'
import type { OpsPhase } from '../server/utils/team-actions'

function fakeClock() {
  let time = 0
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
    pending: () => tasks.size,
    async advance(ms: number) {
      const target = time + ms
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

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const SCENARIO: Scenario = {
  id: 'actions-test',
  title: 'Test actions',
  description: 'fixture',
  steps: [{ at: 0, channelId: 'general', kind: 'announcement', text: 'Début' }],
  actions: [
    { id: 'rollback', label: 'Revenir en arrière', delaySeconds: 30, startText: 'Rollback lancé', doneText: 'Rollback terminé', faults: [{ name: 'bad_release', value: 0 }] },
    { id: 'check', label: 'Contrôler l\'index', type: 'index-check' },
    { id: 'reindex', label: 'Réindexer', type: 'reindex' },
    { id: 'notes', label: 'Changelog', type: 'changelog', text: 'Release 1.2 déployée à 14h' },
  ],
}

interface Posted { channelId: string, text: string, action: string, by: string, phase: OpsPhase }

function setup(overrides: Partial<DocshareClient> = {}, run: ScenarioRun | null = { scenarioId: SCENARIO.id, title: 't', status: 'running', startedAt: '', steps: [] }, scenarios: Scenario[] = [SCENARIO]) {
  const clock = fakeClock()
  const posted: Posted[] = []
  const faults = createFaultState()
  faults.set('bad_release', 1)
  const client = {
    enabled: true,
    setFault: vi.fn(async () => {}),
    getFaults: vi.fn(async () => ({})),
    indexCheck: vi.fn(async () => ({ summary: 'Index OK : 12 documents' })),
    startReindex: vi.fn(async (): Promise<ReindexStatus> => ({ state: 'running', processed: 0, total: 10 })),
    getReindex: vi.fn(async (): Promise<ReindexStatus> => ({ state: 'running', processed: 0, total: 10 })),
    ...overrides,
  } satisfies DocshareClient
  const actions = createTeamActions({
    client: () => client,
    faults,
    getRun: () => run,
    scenarios: () => scenarios,
    postOps: (channelId, text, ops) => { posted.push({ channelId, text, ...ops }) },
    schedule: clock.schedule,
    cancel: clock.cancel,
    now: clock.now,
  })
  return { actions, clock, posted, faults, client }
}

describe('055 actions simulées (CA2)', () => {
  it('start immédiat, rien avant l\'échéance, puis une panne coupée et le message de fin', async () => {
    const { actions, clock, posted, faults, client } = setup()
    expect(await actions.run('rollback', 'Alice')).toEqual({ status: 'started' })
    expect(posted).toEqual([{ channelId: 'general', text: 'Rollback lancé', action: 'Revenir en arrière', by: 'Alice', phase: 'start' }])
    expect(client.setFault).not.toHaveBeenCalled()
    await clock.advance(29_000)
    expect(posted).toHaveLength(1)
    expect(client.setFault).not.toHaveBeenCalled()
    await clock.advance(1000)
    expect(client.setFault).toHaveBeenCalledTimes(1)
    expect(client.setFault).toHaveBeenCalledWith('bad_release', 0)
    expect(faults.isActive('bad_release')).toBe(false)
    expect(posted.map(p => p.phase)).toEqual(['start', 'done'])
    expect(posted[1]!.text).toBe('Rollback terminé')
  })

  it('setFault rejeté : message error, registre inchangé, action relançable', async () => {
    const { actions, clock, posted, faults } = setup({ setFault: vi.fn(async () => { throw new Error('http://secret.internal jeton') }) })
    await actions.run('rollback', 'Alice')
    await clock.advance(30_000)
    expect(faults.isActive('bad_release')).toBe(true)
    expect(posted.at(-1)).toMatchObject({ phase: 'error', text: ACTION_ERROR_TEXT })
    expect(actions.list().find(a => a.id === 'rollback')!.running).toBe(false)
  })
})

describe('055 index-check, reindex, changelog (CA3)', () => {
  it('index-check poste le summary', async () => {
    const { actions, posted } = setup()
    await actions.run('check', 'Bob')
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ phase: 'done', text: 'Index OK : 12 documents', by: 'Bob' })
  })

  it('changelog poste son texte sans appel client', async () => {
    const { actions, posted, client } = setup()
    await actions.run('notes', 'Bob')
    expect(posted[0]!.text).toBe('Release 1.2 déployée à 14h')
    for (const fn of [client.setFault, client.indexCheck, client.startReindex, client.getReindex]) expect(fn).not.toHaveBeenCalled()
  })

  it('reindex : un seul POST, progression à chaque changement, final puis plus de sondage', async () => {
    const states: ReindexStatus[] = [
      { state: 'running', processed: 0, total: 10 },
      { state: 'running', processed: 4, total: 10 },
      { state: 'running', processed: 4, total: 10 },
      { state: 'done', processed: 10, total: 10, summary: 'Réindexation terminée : 10 documents' },
    ]
    let i = 0
    const { actions, clock, posted, client } = setup({ getReindex: vi.fn(async () => states[Math.min(i++, states.length - 1)]!) })
    await actions.run('reindex', 'Alice')
    expect(client.startReindex).toHaveBeenCalledTimes(1)
    expect(posted.map(p => p.phase)).toEqual(['start'])
    await clock.advance(5000)
    expect(posted.map(p => p.phase)).toEqual(['start'])
    await clock.advance(5000)
    expect(posted.at(-1)).toMatchObject({ phase: 'progress', text: 'Réindexer : 4/10' })
    await clock.advance(5000)
    expect(posted.map(p => p.phase)).toEqual(['start', 'progress'])
    await clock.advance(5000)
    expect(posted.map(p => p.phase)).toEqual(['start', 'progress', 'progress', 'done'])
    expect(posted.at(-1)!.text).toBe('Réindexation terminée : 10 documents')
    const calls = (client.getReindex as ReturnType<typeof vi.fn>).mock.calls.length
    await clock.advance(60_000)
    expect(client.getReindex).toHaveBeenCalledTimes(calls)
    expect(clock.pending()).toBe(0)
    expect(actions.list().find(a => a.id === 'reindex')!.running).toBe(false)
  })

  it('reindex : échec du démarrage et plafond de sondage donnent un message error', async () => {
    const a = setup({ startReindex: vi.fn(async () => { throw new Error('x') }) })
    await a.actions.run('reindex', 'Alice')
    expect(a.posted.at(-1)).toMatchObject({ phase: 'error', text: ACTION_ERROR_TEXT })
    const b = setup()
    await b.actions.run('reindex', 'Alice')
    await b.clock.advance(10 * 60 * 1000 + 5000)
    expect(b.posted.at(-1)).toMatchObject({ phase: 'error' })
    expect(b.clock.pending()).toBe(0)
  })
})

describe('055 anti-doublon (CA4)', () => {
  it('simulated : 409, pas de second timer ni start, relançable après l\'échéance', async () => {
    const { actions, clock, posted } = setup()
    await actions.run('rollback', 'Alice')
    expect(actions.list().find(a => a.id === 'rollback')!.running).toBe(true)
    const second = await actions.run('rollback', 'Bob')
    expect(second.status).toBe('conflict')
    expect(posted.filter(p => p.phase === 'start')).toHaveLength(1)
    expect(clock.pending()).toBe(1)
    await clock.advance(30_000)
    expect(await actions.run('rollback', 'Bob')).toEqual({ status: 'started' })
  })

  it('reindex déjà running : aucun second POST, la progression est postée', async () => {
    const { actions, posted, client } = setup({ getReindex: vi.fn(async () => ({ state: 'running', processed: 3, total: 10 })) })
    await actions.run('reindex', 'Alice')
    const second = await actions.run('reindex', 'Bob')
    expect(second.status).toBe('conflict')
    expect(client.startReindex).toHaveBeenCalledTimes(1)
    expect(posted.at(-1)).toMatchObject({ phase: 'progress' })
    expect(posted.at(-1)!.text).toContain('déjà en cours')
    expect(posted.at(-1)!.text).toContain('3/10')
  })
})

describe('055 hors scénario et arrêt (CA5)', () => {
  it('sans scénario running ou sans actions : liste vide, 404', async () => {
    for (const s of [
      setup({}, null),
      setup({}, { scenarioId: SCENARIO.id, title: 't', status: 'stopped', startedAt: '', steps: [] }),
      setup({}, undefined, [{ ...SCENARIO, actions: undefined }]),
    ]) {
      expect(s.actions.list()).toEqual([])
      await expect(s.actions.run('rollback', 'Alice')).rejects.toBeInstanceOf(TeamActionNotFoundError)
    }
    await expect(setup().actions.run('inconnue', 'Alice')).rejects.toBeInstanceOf(TeamActionNotFoundError)
  })

  it('stop() au milieu d\'un délai : ni message ni setFault ; sondage reindex arrêté', async () => {
    const { actions, clock, posted, client } = setup()
    await actions.run('rollback', 'Alice')
    await actions.run('reindex', 'Alice')
    const before = posted.length
    actions.stop()
    expect(actions.list().every(a => !a.running)).toBe(true)
    await clock.advance(60_000)
    expect(posted).toHaveLength(before)
    expect(client.setFault).not.toHaveBeenCalled()
    expect(client.getReindex).not.toHaveBeenCalled()
  })

  it('stop() pendant un appel en vol : rien n\'est publié ensuite', async () => {
    let release: (value: ReindexStatus) => void = () => {}
    const { actions, posted } = setup({ startReindex: vi.fn(() => new Promise<ReindexStatus>((resolve) => { release = resolve })) })
    const pending = actions.run('reindex', 'Alice')
    actions.stop()
    release({ state: 'done', processed: 1, total: 1 })
    await pending
    expect(posted).toHaveLength(0)
  })
})

describe('055 message Ops dans le store', () => {
  it('addOpsMessage publie un message kind ops signé Ops', async () => {
    const { addOpsMessage } = await import('../server/utils/chat-store')
    resetChatStore()
    clearMessages()
    const message = addOpsMessage('general', { text: 'Rollback lancé', ops: { action: 'Rollback', by: 'Alice', phase: 'start' } })
    expect(message).toMatchObject({ author: 'Ops', kind: 'ops', ops: { action: 'Rollback', by: 'Alice', phase: 'start' } })
    expect(listMessages('general').at(-1)!.ops).toEqual(message.ops)
    resetChatStore()
  })
})
