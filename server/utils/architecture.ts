// Modèle d'architecture pour /admin : fonction pure (environnement et instantané injectés), sans secret.
// Les URL sont réduites à leur hôte (et port) ; aucune clé, utilisateur, mot de passe, chemin ni fiche.
import type { ArchitectureComponent, ArchitectureHosting, ArchitectureLink, ArchitectureModel } from '../../shared/types/architecture'
import type { NpcAdminState, NpcPersonaSource } from '../../shared/types/npc'
import type { ScenarioRun } from '../../shared/types/scenario'
import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_DEFAULT_MODEL } from '../npc/engines/anthropic'
import { type Env } from './env'
import { resolveStorageConfig } from './chat-persistence'

export interface ArchitectureSnapshot {
  npc: NpcAdminState
  run: ScenarioRun | null
  personas: { source: NpcPersonaSource, count: number }
}

/** host (avec port) d'une URL ; undefined si absente ou invalide. Jamais href, identifiants ni chemin. */
function hostOf(url: string | undefined): string | undefined {
  const value = url?.trim()
  if (!value) return undefined
  try {
    return new URL(value).host || undefined
  } catch {
    return undefined
  }
}

function hostingOf(env: Env): ArchitectureHosting {
  if (env.KUBERNETES_SERVICE_HOST?.trim()) return 'kubernetes'
  if (env.RENDER?.trim()) return 'render'
  return 'local'
}

function engineOf(env: Env, name: string, lastModelCall: ArchitectureModel['npcEngine']['lastModelCall']): ArchitectureModel['npcEngine'] {
  if (name === 'openai-compatible') {
    return {
      name,
      model: env.NPC_LLM_MODEL?.trim() || undefined,
      host: hostOf(env.NPC_LLM_BASE_URL),
      lastModelCall,
    }
  }
  if (name === 'anthropic') {
    return {
      name,
      model: env.NPC_ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL,
      host: hostOf(env.NPC_ANTHROPIC_BASE_URL) ?? hostOf(ANTHROPIC_DEFAULT_BASE_URL),
      lastModelCall,
    }
  }
  return { name, lastModelCall }
}

export const ARCHITECTURE_LINKS: readonly ArchitectureLink[] = [
  { from: 'participants', to: 'api', label: 'polling HTTP' },
  { from: 'facilitator', to: 'api', label: 'code animateur' },
  { from: 'nuxt-pages', to: 'api', label: 'appels /api' },
  { from: 'api', to: 'persistence', label: 'instantané' },
  { from: 'api', to: 'scenario-runner', label: 'étapes planifiées' },
  { from: 'api', to: 'npc-dispatcher', label: 'messages' },
  { from: 'npc-dispatcher', to: 'spontaneous', label: 'tic de 15 s' },
  { from: 'npc-dispatcher', to: 'engine-keywords', label: 'réponse' },
  { from: 'npc-dispatcher', to: 'engine-openai', label: 'réponse' },
  { from: 'npc-dispatcher', to: 'engine-anthropic', label: 'réponse' },
  { from: 'npc-dispatcher', to: 'personas-embedded', label: 'fiches' },
  { from: 'npc-dispatcher', to: 'personas-directory', label: 'fiches' },
]

export function buildArchitecture(env: Env, state: ArchitectureSnapshot): ArchitectureModel {
  const hosting = hostingOf(env)
  const storageConfig = resolveStorageConfig(env)
  const storage: ArchitectureModel['storage'] = { driver: storageConfig.driver }
  if (storageConfig.driver === 'redis') storage.host = hostOf(storageConfig.url)

  const { npc, run, personas } = state
  const npcEngine = engineOf(env, npc.engine, npc.lastModelCall)
  const source = personas.source === 'dir' ? 'directory' : 'embedded'
  const running = run?.status === 'running'
  const scenario = run
    ? {
        id: run.scenarioId,
        title: run.title,
        status: run.status,
        step: run.steps.filter(step => step.status === 'published').length,
        totalSteps: run.steps.length,
      }
    : null

  const component = (id: string, label: string, legend: string, active: boolean): ArchitectureComponent =>
    ({ id, label, legend, active })
  const engine = npc.engine

  const components: ArchitectureComponent[] = [
    component('participants', 'Participants', 'Navigateurs des participants : canaux, fils, conversations directes.', true),
    component('facilitator', 'Animateur', 'Page /admin : annonces, alertes, scénarios, PNJ.', true),
    component('nuxt-pages', 'Pages Nuxt', 'Interface rendue côté serveur puis hydratée dans le navigateur.', true),
    component('api', 'API Nitro', 'Routes /api : messages, présence, administration.', true),
    component('scenario-runner', 'Scénario', 'Planificateur qui publie les étapes de l\'incident au fil du temps.', running),
    component('npc-dispatcher', 'PNJ', 'Répartiteur des réponses des personnages (mentions, fils, conversations directes).', npc.enabled),
    component('spontaneous', 'Interventions spontanées', 'Les PNJ prennent la parole sans être sollicités.', npc.enabled && npc.spontaneous),
    component('persistence', 'Persistance', 'Instantané des conversations enregistré dans le stockage choisi.', true),
    component('storage-memory', 'Mémoire', 'Aucune persistance : tout est perdu au redémarrage.', storage.driver === 'memory'),
    component('storage-fs', 'Fichier', 'Instantané écrit dans un dossier local.', storage.driver === 'fs'),
    component('storage-redis', 'Redis', 'Instantané enregistré dans un Redis externe.', storage.driver === 'redis'),
    component('engine-keywords', 'Mots-clés', 'Réponses déterministes à partir des fiches, sans modèle.', engine === 'keywords'),
    component('engine-openai', 'openai-compatible', 'Modèle local ou distant (Ollama, vLLM…) via l\'API OpenAI.', engine === 'openai-compatible'),
    component('engine-anthropic', 'Anthropic', 'Modèle Claude via l\'API Anthropic.', engine === 'anthropic'),
    component('personas-embedded', 'Fiches embarquées', 'Fiches Markdown intégrées au build.', source === 'embedded'),
    component('personas-directory', 'Fiches en dossier', 'Fiches Markdown lues dans NPC_PERSONAS_DIR.', source === 'directory'),
    component('hosting-render', 'Render', 'Web Service Node déployé par render.yaml.', hosting === 'render'),
    component('hosting-kubernetes', 'Kubernetes', 'Pod unique du chart Helm (cluster local).', hosting === 'kubernetes'),
    component('hosting-local', 'Poste local', 'Processus Node lancé à la main (dev ou build).', hosting === 'local'),
  ]

  return {
    hosting,
    storage,
    npcEngine,
    npcs: {
      enabled: npc.enabled,
      active: npc.enabled ? npc.npcs.map(item => item.name) : [],
      scenarioId: npc.scenarioId,
      spontaneous: npc.spontaneous,
    },
    scenario,
    personas: { source, count: personas.count },
    components,
    links: ARCHITECTURE_LINKS.map(link => ({ ...link })),
  }
}
