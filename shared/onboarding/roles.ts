// Rôles d'incident proposés aux participants : libellé de badge et fiche (mission, réflexes, à qui parler).
// Texte brut, sans rien du scénario : plusieurs personnes peuvent tenir le même rôle.

export const ROLE_IDS = ['incident-commander', 'investigation', 'communication', 'scribe', 'equipier'] as const
export type RoleId = typeof ROLE_IDS[number]

/** Rôle attribué tant que le participant n'en a pas choisi un autre */
export const DEFAULT_ROLE_ID: RoleId = 'equipier'

export interface RoleSheet {
  id: RoleId
  /** Libellé complet, utilisé dans les listes et les infobulles */
  label: string
  /** Libellé court du badge */
  badge: string
  /** Mission en une ou deux phrases */
  mission: string
  /** Trois ou quatre réflexes à avoir pendant l'incident */
  reflexes: string[]
  /** À qui s'adresser, par fonction générique */
  whoToTalkTo: string
}

export const ROLES: readonly RoleSheet[] = [
  {
    id: 'incident-commander',
    label: 'Responsable d\'incident',
    badge: 'Responsable',
    mission: 'Vous pilotez la réponse à l\'incident : vous gardez la vue d\'ensemble, répartissez le travail et décidez quand il faut trancher. Vous ne cherchez pas la cause vous-même.',
    reflexes: [
      'Annoncez dans le canal que vous prenez la coordination, pour que chacun sache qui décide.',
      'Confiez des tâches nommées à des personnes précises, par exemple « @Alice, tu vérifies ce point et tu me dis ce que tu trouves ».',
      'Faites un point de situation à intervalles réguliers : ce que l\'on sait, ce que l\'on ignore, ce qui est en cours.',
      'Tranchez quand les avis divergent et écrivez la décision dans le canal.',
    ],
    whoToTalkTo: 'Toute l\'équipe, dans le canal : c\'est là que vous distribuez les tâches. Auprès des collègues des autres services, posez des questions courtes et utiles à la décision.',
  },
  {
    id: 'investigation',
    label: 'Investigation technique',
    badge: 'Investigation',
    mission: 'Vous cherchez ce qui se passe et pourquoi, en rassemblant des faits auprès des bonnes personnes. Vous remontez des constats, pas des suppositions.',
    reflexes: [
      'Posez des questions précises (quoi, depuis quand, sur quoi) plutôt que des questions générales.',
      'Recoupez les réponses : une information confirmée par deux sources vaut plus qu\'une seule.',
      'Partagez chaque constat dans le canal dès que vous l\'avez, sans attendre d\'avoir tout compris.',
      'Distinguez ce qui est établi de ce qui n\'est qu\'une hypothèse, et dites-le.',
    ],
    whoToTalkTo: 'Les collègues des autres services, en conversation directe ou en les mentionnant dans le canal, selon ce que vous cherchez. Rapportez ensuite vos constats au responsable et à l\'équipe.',
  },
  {
    id: 'communication',
    label: 'Communication',
    badge: 'Communication',
    mission: 'Vous informez ceux qui ne sont pas dans la gestion technique de l\'incident, avec des messages clairs, factuels et mesurés. Vous évitez de promettre ce que vous ne savez pas.',
    reflexes: [
      'Demandez au responsable ce qui peut être dit et ce qui doit rester interne.',
      'Rédigez des messages courts : ce qui se passe, qui est touché, ce qui est fait, quand aura lieu la prochaine information.',
      'N\'annoncez ni cause ni heure de retour à la normale tant qu\'elles ne sont pas confirmées.',
      'Relisez-vous : pas de jargon, pas de blâme, pas de détail inutile.',
    ],
    whoToTalkTo: 'Le responsable, pour valider chaque message, puis les collègues des autres services concernés par l\'information. Relayez à l\'équipe ce que ces collègues vous demandent.',
  },
  {
    id: 'scribe',
    label: 'Scribe',
    badge: 'Scribe',
    mission: 'Vous gardez la trace de ce qui se passe : les faits, les décisions et les heures. Cette trace servira à comprendre l\'incident après coup et à alimenter le retour d\'expérience.',
    reflexes: [
      'Notez dans le canal les décisions prises, qui les a prises et à quelle heure.',
      'Consignez les actions lancées et leur résultat, même quand elles n\'ont rien donné.',
      'Faites préciser ce qui est ambigu : « on fait quoi, et qui s\'en occupe ? ».',
      'Récapitulez de temps en temps pour que quelqu\'un qui arrive en cours de route comprenne la situation.',
    ],
    whoToTalkTo: 'L\'équipe, dans le canal, pour confirmer ce que vous notez. Le responsable, s\'il faut arbitrer un point que vous ne comprenez pas.',
  },
  {
    id: 'equipier',
    label: 'Équipier',
    badge: 'Équipier',
    mission: 'Vous renforcez l\'équipe là où l\'on a besoin de vous : vous prenez les tâches qu\'on vous confie et vous aidez à voir ce qui échappe aux autres.',
    reflexes: [
      'Lisez le canal avant d\'écrire pour ne pas répéter ce qui a déjà été dit.',
      'Proposez votre aide ou une piste au lieu d\'attendre : « je peux regarder ça ».',
      'Dites quand vous avez terminé une tâche et ce que vous en concluez.',
      'Signalez ce qui vous semble incohérent, même si vous n\'êtes pas sûr.',
    ],
    whoToTalkTo: 'Le responsable, pour recevoir une tâche ou en proposer une. L\'équipe pour partager vos constats, et les collègues des autres services pour obtenir une information précise.',
  },
]

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value)
}

export function roleSheet(id: RoleId): RoleSheet {
  return ROLES.find(role => role.id === id)!
}

/** Libellé complet d'un rôle (« Responsable d'incident »), ou l'identifiant si inconnu */
export function roleLabel(id: string): string {
  return isRoleId(id) ? roleSheet(id).label : id
}

/** Libellé court du badge, ou chaîne vide si le rôle est inconnu */
export function roleBadge(id: string | undefined): string {
  return isRoleId(id) ? roleSheet(id).badge : ''
}
