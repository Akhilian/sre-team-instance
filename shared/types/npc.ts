// Personnages non joueurs (PNJ) : fiches, extraits de connaissances et interfaces des moteurs.
// Le moteur de réponse (NpcResponder) et la récupération des connaissances (KnowledgeRetriever) sont
// interchangeables : un nouveau fournisseur n'implémente que NpcResponder, dans un fichier d'adaptateur.
import type { Message } from './chat'

/** Mot ou expression déclencheur d'une entrée « Sur question précise » */
export interface NpcTrigger {
  /** Tel qu'écrit dans la fiche, sans le préfixe ! */
  text: string
  /** Préfixé de ! dans la fiche : suffit seul à rendre l'entrée éligible */
  specific: boolean
}

/**
 * Information livrée seulement si la question contient au moins 2 déclencheurs distincts de l'entrée,
 * ou un déclencheur spécifique
 */
export interface NpcPreciseEntry {
  triggers: NpcTrigger[]
  text: string
}

/** Fiche d'un PNJ (server/npc/personas/<scénario>/<id>.md) */
export interface NpcPersona {
  id: string
  /** Nom complet, mentionnable par @Nom et signature de ses messages */
  name: string
  role: string
  scenarioId: string
  /** Phrase d'ouverture de ses réponses (moteur keywords seulement : c'est une réplique, pas une consigne) */
  tone: string
  /** Caractère et style de réponse, en une phrase (prompt des moteurs à modèle) */
  personality: string
  /** Réponse quand il n'a rien d'utile à dire sur la question */
  deflection: string
  /** Ce qu'il sait et livre volontiers (section « Sait ») */
  knows: string[]
  /** Ce qu'il ignore (section « Ignore ») : guide des moteurs à modèle, jamais livré tel quel */
  ignores: string[]
  /** Ce qu'il ne livre qu'à une question précise (section « Sur question précise ») */
  onPreciseQuestion: NpcPreciseEntry[]
}

/** Extrait de la fiche retenu pour répondre à une question */
export interface KnowledgeExcerpt {
  /** Section d'origine */
  source: 'knows' | 'precise'
  text: string
  /** Pertinence (plus haut = plus pertinent), propre au retriever */
  score: number
}

/** Tout ce dont un moteur a besoin pour formuler une réponse */
export interface NpcRequest {
  persona: NpcPersona
  /** Extraits pertinents, du plus au moins pertinent ; vide si rien ne correspond */
  excerpts: KnowledgeExcerpt[]
  /** Messages récents du fil ou du canal (au plus 10), du plus ancien au plus récent, question exclue */
  history: Message[]
  /** Texte du message qui mentionne le PNJ */
  question: string
}

/** Sélection des extraits de la fiche pertinents pour une question (asynchrone : embeddings ou index distant possibles) */
export interface KnowledgeRetriever {
  retrieve(persona: NpcPersona, question: string): Promise<KnowledgeExcerpt[]>
}

/** Moteur de réponse : fiche + extraits + historique → texte de la réponse */
export interface NpcResponder {
  respond(request: NpcRequest): Promise<string>
}

/** PNJ tel qu'exposé par l'API */
export interface NpcSummary {
  id: string
  name: string
  role: string
}

/** Réponse de GET /api/npcs (public) */
export interface NpcsResponse {
  enabled: boolean
  npcs: NpcSummary[]
}

/** Réponse de GET|POST /api/admin/npcs */
export interface NpcAdminState extends NpcsResponse {
  /** Moteur de réponse en service (NPC_ENGINE) */
  engine: string
  /** Scénario dont les PNJ sont proposés */
  scenarioId: string
}

/** Source des fiches : dossier NPC_PERSONAS_DIR ou fiches embarquées au build */
export type NpcPersonaSource = 'dir' | 'embedded'

/** Fiche chargée, telle qu'exposée à l'animateur (GET /api/admin/npc-personas) */
export interface NpcPersonaFileSummary {
  /** Chemin relatif : <scénario>/<id>.md */
  path: string
  id: string
  name: string
  role: string
  scenarioId: string
  /** Texte source de la fiche chargée */
  markdown: string
}

export interface NpcPersonasAdminState {
  source: NpcPersonaSource
  personas: NpcPersonaFileSummary[]
}

/** Rapport de POST /api/admin/npc-personas/reload (200, ou 422 si aucune fiche valide) */
export interface NpcPersonaReloadReport {
  source: NpcPersonaSource
  /** Fiches valides relues */
  loaded: string[]
  errors: { path: string, message: string }[]
  /** Fiches en erreur qui gardent leur version précédente */
  kept: string[]
}
