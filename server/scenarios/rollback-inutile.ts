// Scénario « Le rollback qui ne sert à rien » (≈ 90 min) sur DocShare réel : deux causes indépendantes.
// B (silencieuse, portée par la release de 14h05) : l'index de recherche n'est plus mis à jour, les documents
// déposés restent introuvables, sans aucune alerte. A (bruyante, sans lien avec la release) : la latence d'upload
// monte à 6 minutes, avec une alerte toutes les 5 minutes. Revenir à la version précédente règle B ; couper A
// demande de redémarrer la base. Tout est en donnée : les conditions `when` (en ET) choisissent les messages
// selon l'état réel des pannes. Aucun texte ne nomme la cause.
import type { Scenario, ScenarioStep } from '../../shared/types/scenario'

const INCIDENT = 'incident-en-cours'

const A_ACTIVE = { fault: 'upload_latency', active: true }
const A_INACTIVE = { fault: 'upload_latency', active: false }
const B_ACTIVE = { fault: 'stale_index', active: true }
const B_INACTIVE = { fault: 'stale_index', active: false }

/** Alertes SEV2 sur A : une toutes les 5 minutes de 390 s à 2 790 s inclus, tant que A est active */
const uploadAlerts: ScenarioStep[] = Array.from({ length: 9 }, (_, index): ScenarioStep => {
  const minutes = 1 + index * 5
  return {
    at: 390 + index * 300,
    channelId: INCIDENT,
    kind: 'alert',
    severity: 'SEV2',
    title: 'Latence d\'upload élevée',
    service: 'docshare-upload',
    text: `p95 à ${(3.8 + index * 0.1).toFixed(1).replace('.', ',')} s sur POST /upload depuis ${minutes} min (SLO : 1 s). `
      + `Environ ${30 + index} % des dépôts dépassent 3 s. Runbook : wiki/runbooks/upload-latence.`,
    when: A_ACTIVE,
  }
})

const steps: ScenarioStep[] = [
  { at: 0, kind: 'fault', name: 'stale_index', value: 1 },
  {
    at: 120,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'support-docshare',
    text: 'Bonjour, Léa du support. Un client m\'écrit qu\'il ne retrouve pas un document qu\'il vient de déposer. '
      + 'Un seul ticket pour l\'instant, ça doit être un cas isolé, mais je préfère vous le signaler.',
  },
  { at: 360, kind: 'fault', name: 'upload_latency', value: 2.0 },
  ...uploadAlerts,
  {
    at: 600,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'direction-docshare',
    text: 'Hugo Perrin, direction. J\'ai une démonstration client dans l\'heure et DocShare doit être irréprochable. '
      + 'Je vois passer des alertes : dites-moi simplement si on est bons pour la démo.',
  },
  {
    at: 900,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'direction-docshare',
    text: 'Je n\'ai pas eu de nouvelles depuis un moment. Où en êtes-vous ? Un point court, s\'il vous plaît : '
      + 'ce qui ne va pas, ce que vous faites, et quand ça revient.',
  },
  {
    at: 1080,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'communication-docshare',
    text: 'Nadia, communication. Des clients nous écrivent et demandent si DocShare a un problème. '
      + 'On met quelque chose sur la page de statut, oui ou non ? Et si oui, on écrit quoi ?',
  },
  {
    at: 1200,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'support-docshare',
    text: 'Ça se multiplie : plusieurs clients disent que les documents déposés ce matin sont introuvables '
      + 'quand ils les cherchent. Ce n\'est plus un cas isolé, j\'ai un groupe de tickets sur le sujet.',
  },
  {
    at: 1200,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'communication-docshare',
    text: 'Je viens de voir passer l\'info : le rollback n\'a pas réglé la latence. Les clients se plaignent toujours '
      + 'de dépôts lents. C\'est bien l\'état actuel côté technique ?',
    when: [B_INACTIVE, A_ACTIVE],
  },
  {
    at: 1500,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'direction-docshare',
    text: 'Les alertes se sont arrêtées, c\'est réglé ? Alors on peut clore l\'incident et passer à la démo. '
      + 'Je veux une confirmation de clôture de votre part.',
    when: [A_INACTIVE, B_ACTIVE],
  },
  {
    at: 1800,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'support-docshare',
    text: 'Le rollback n\'a pas réglé la latence : les clients disent que déposer un fichier reste très long, '
      + 'même depuis le retour en arrière. Qu\'est-ce que je leur réponds ?',
    when: [B_INACTIVE, A_ACTIVE],
  },
  {
    at: 2100,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'direction-docshare',
    text: 'Ça fait un moment que les alertes ont cessé. Je redemande de clore l\'incident : '
      + 'on ne peut pas garder l\'équipe mobilisée pour rien. Vous clôturez ?',
    when: [A_INACTIVE, B_ACTIVE],
  },
  {
    at: 2400,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'communication-docshare',
    text: 'Le rollback n\'a pas réglé la latence et les clients nous le disent sur les réseaux. '
      + 'Je dois adapter le message de la page de statut : qu\'est-ce qui est vrai maintenant ?',
    when: [B_INACTIVE, A_ACTIVE],
  },
  {
    at: 2700,
    channelId: INCIDENT,
    kind: 'npc-message',
    npcId: 'direction-docshare',
    text: 'Dernière demande avant la démo : je clos l\'incident de mon côté, sauf objection de votre part. '
      + 'Confirmez-moi que tout est rentré dans l\'ordre.',
    when: [A_INACTIVE, B_ACTIVE],
  },
  {
    at: 5400,
    channelId: INCIDENT,
    kind: 'announcement',
    text: '[Animateur] Fin de séance : stabilisez, notez la chronologie de vos décisions et préparez le débrief.',
  },
]

export const rollbackInutile: Scenario = {
  id: 'rollback-inutile',
  title: 'Le rollback qui ne sert à rien',
  description: 'DocShare réel : une mise en production, des alertes de latence bruyantes et des clients qui ne retrouvent '
    + 'pas leurs documents. La direction veut clore vite. Environ 90 minutes.',
  steps: steps.slice().sort((a, b) => a.at - b.at),
  actions: [
    {
      id: 'revenir-version',
      label: 'Revenir à la version précédente',
      type: 'simulated',
      delaySeconds: 20,
      startText: 'Retour à la version précédente lancé.',
      doneText: 'Retour à la version précédente terminé.',
      faults: [{ name: 'stale_index', value: 0 }],
    },
    {
      id: 'redemarrer-base',
      label: 'Redémarrer la base',
      type: 'simulated',
      delaySeconds: 45,
      startText: 'Redémarrage de la base lancé.',
      doneText: 'Redémarrage de la base terminé.',
      faults: [{ name: 'upload_latency', value: 0 }],
    },
    { id: 'controler-index', label: 'Contrôler l\'index', type: 'index-check' },
    { id: 'reindexer', label: 'Réindexer', type: 'reindex' },
    {
      id: 'changelog',
      label: 'Voir le changelog',
      type: 'changelog',
      text: 'Release de 14h05, deux changements : optimisation de l\'indexation ; nouveau chemin d\'upload.',
    },
  ],
}
