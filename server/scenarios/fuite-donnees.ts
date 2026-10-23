// Second scénario de l'atelier (≈ 14 min) : un export de données clients est resté lisible publiquement
// sur un bucket de stockage. Yanis Belkacem (SOC, PNJ) ouvre l'incident ; la pression vient du support,
// de la communication et de la DPO. L'enjeu est la décision et la communication plus que la cause
// technique. Une seule annonce, celle de l'animateur, clôt les injections. Aucune étape ne livre les
// faits-clés : il faut interroger et recouper les PNJ (server/npc/personas/fuite-donnees/).
//
// Recoupement voulu :
// - Cause : le SOC (heures des 3 téléchargements, dans les journaux d'accès) + l'équipe Data (changement
//   d'ACL de lundi 18h05, PR #482, pour le routeur d'e-mails Routilo, qui a lu le fichier vers 18h20).
//   Le téléchargement de 18h20 est donc celui du sous-traitant ; les deux autres, depuis une IP inconnue,
//   sont des accès par un tiers.
// - Décision : Data (données touchées et volume : 48 210 clients) + SOC (deux accès inconnus) + DPO
//   (notification sous 72 heures, information des personnes si risque élevé) + Support (SMS frauduleux
//   citant la date de naissance : données exploitées, donc risque élevé). Il faut notifier, informer les
//   personnes, fermer l'accès après avoir copié les journaux (conservés 7 jours) et ne rien supprimer.
import type { Scenario } from '../../shared/types/scenario'

const INCIDENT = 'incident-en-cours'
const GENERAL = 'general'

export const fuiteDonnees: Scenario = {
  id: 'fuite-donnees',
  title: 'Fuite de données clients',
  description: 'Le SOC signale un export clients lisible publiquement, puis SMS frauduleux, journaliste et '
    + 'obligations de notification : décider, communiquer et préserver les preuves. Environ 14 minutes.',
  steps: [
    {
      at: 0,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'soc',
      text: 'Bonjour, ici Yanis, du SOC. Signalement reçu ce matin à 9h52 via notre security.txt : le fichier '
        + 'export-clients-2026-10.csv est lisible sans authentification sur le bucket crm-exports-prod. '
        + 'J\'ai confirmé que le bucket est public. Personne n\'a encore ouvert le fichier de notre côté et '
        + 'je n\'ai rien modifié. J\'ouvre l\'incident ici.',
    },
    {
      at: 30,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV2',
      title: 'Bucket de stockage accessible publiquement',
      service: 'storage-posture',
      text: 'crm-exports-prod : ACL public-read détectée, non conforme à la règle « aucun bucket public en production ». '
        + 'Objet exposé : export-clients-2026-10.csv.',
    },
    {
      at: 80,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: '3 lectures anonymes de export-clients-2026-10.csv',
      service: 'object-storage',
      text: '3 lectures sans authentification sur 7 jours, fichier complet à chaque fois (6,1 Mo). '
        + 'Le détail des accès est dans les journaux du bucket, consultables par le SOC.',
    },
    {
      at: 150,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'support-clients',
      text: 'Ici Nadia, du support. Deux clients nous signalent un SMS de « remboursement » qui les appelle par '
        + 'leur prénom, avec un lien à suivre. Ils demandent si c\'est bien nous. Ce n\'est pas nous, si ? '
        + 'Qu\'est-ce que je leur réponds ?',
    },
    {
      at: 220,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'porte-parole',
      text: 'Bastien, à la communication. Un journaliste de « La Gazette du Code » m\'écrit : il dit avoir reçu '
        + 'un extrait de notre fichier clients et veut notre réaction avant 17h. Qui peut me dire ce qui se passe ?',
    },
    {
      at: 290,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: 'Pic de connexions échouées sur le portail client',
      service: 'auth-portal',
      text: '1 840 connexions échouées en 20 min, depuis 46 IP différentes. '
        + 'Les tentatives portent sur des adresses e-mail de comptes clients existants.',
    },
    {
      at: 360,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'dpo',
      text: 'Élise Marchand, DPO. S\'il s\'agit d\'une violation de données, nous avons des obligations. Pour '
        + 'notifier, il me faut : l\'heure à laquelle nous en avons eu connaissance, les données touchées, le '
        + 'nombre de personnes concernées et si des tiers y ont eu accès. Qui me répond ?',
    },
    {
      at: 430,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'porte-parole',
      text: 'La direction veut une déclaration d\'attente d\'ici 30 minutes. Je ne publie rien sans faits '
        + 'confirmés ni sans la validation d\'Élise. Qui me donne les éléments ?',
    },
    {
      at: 500,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'soc',
      text: 'Qui pilote l\'incident ? J\'ai besoin d\'un interlocuteur pour les décisions. Et je le rappelle : '
        + 'on ne supprime rien, ni le fichier ni les journaux. Ce sont nos preuves.',
    },
    {
      at: 600,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: 'Dernier changement de configuration de crm-exports-prod',
      service: 'object-storage',
      text: 'Le dernier changement de configuration du bucket vient du pipeline Terraform de l\'équipe Data. '
        + 'Voir avec l\'équipe Data pour le détail.',
    },
    {
      at: 680,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'support-clients',
      text: 'On en est à 7 signalements de ce SMS. Les clients demandent maintenant si leurs données ont fuité. '
        + 'La réponse « nous vérifions » ne tient plus : il me faut un message validé.',
    },
    {
      at: 760,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'dpo',
      text: 'Il me faut maintenant un premier état écrit, même partiel : données concernées, nombre de personnes, '
        + 'accès par des tiers et mesures prises. C\'est sur cette base que je décide de la notification.',
    },
    {
      at: 840,
      channelId: INCIDENT,
      kind: 'announcement',
      text: '[Animateur] Fin des injections. Décidez de la notification à l\'autorité, de l\'information des '
        + 'personnes et de la déclaration à la presse, préservez les preuves et notez les éléments de '
        + 'chronologie pour le post-mortem.',
    },
  ],
}
