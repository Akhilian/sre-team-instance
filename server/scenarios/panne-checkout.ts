// Scénario principal de l'atelier (≈ 14 min) : dégradation puis panne du tunnel de paiement après
// une mise en production. Sarah Benali (support, PNJ) ouvre l'incident, puis les alertes arrivent dans
// « Incident en cours » ; la pression métier vient des PNJ (support, CEO, communication, CFO). Une seule
// annonce, celle de l'animateur, clôt les injections (consigne de jeu hors fiction). Aucune étape ne
// livre la cause : il faut interroger et recouper les PNJ.
import type { Scenario } from '../../shared/types/scenario'

const INCIDENT = 'incident-en-cours'
const GENERAL = 'general'

export const panneCheckout: Scenario = {
  id: 'panne-checkout',
  title: 'Panne du checkout',
  description: 'Le support ouvre l\'incident, puis latence et erreurs 5xx sur le paiement après une mise en production, '
    + 'sous la pression de la direction, de la communication et de la finance. Environ 14 minutes.',
  steps: [
    {
      at: 0,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'support-n1',
      text: 'Bonjour, ici Sarah du support. Depuis quelques minutes, des clients nous appellent : '
        + 'au moment de payer, le bouton « Payer » tourne longtemps puis affiche « erreur technique, '
        + 'réessayez plus tard ». Une dizaine de tickets déjà, tous sur l\'étape de paiement. '
        + 'Quelqu\'un peut regarder ? Je vous donne le détail de ce qu\'ils voient si besoin.',
    },
    {
      at: 20,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV2',
      title: 'Latence p95 > 2 s sur POST /api/checkout',
      service: 'checkout-api',
      text: 'p95 à 2,4 s depuis 5 min (SLO : 800 ms). 12 % des requêtes dépassent 3 s. '
        + 'Runbook : wiki/runbooks/checkout-latence.',
    },
    {
      at: 50,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: 'Pool de connexions PostgreSQL proche de la saturation',
      service: 'orders-db',
      text: 'orders-db-primary : 188/200 connexions actives, attente moyenne sur le pool 900 ms. '
        + 'Principal consommateur : checkout-api (142 connexions).',
    },
    {
      at: 100,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV1',
      title: 'Taux d\'erreur 5xx > 15 % sur le checkout',
      service: 'checkout-api',
      text: '17,8 % de réponses 5xx sur POST /api/checkout (seuil : 5 %). Erreurs majoritaires : '
        + '503 « upstream timeout » vers payment-gateway. Commandes validées : -64 % sur 10 min.',
    },
    {
      at: 160,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'support-n1',
      text: 'Ça s\'accélère : 40 tickets en 10 min, paniers bloqués à l\'étape paiement, et 25 clients '
        + 'en attente sur le chat. Qu\'est-ce qu\'on leur répond ? Il me faut un message et une heure de retour.',
    },
    {
      at: 230,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV2',
      title: 'Timeouts vers le prestataire de paiement',
      service: 'payment-gateway',
      text: '22 % des appels au PSP dépassent 10 s. Circuit breaker ouvert 3 fois en 5 min. '
        + 'Page de statut du PSP : « tous les systèmes opérationnels ».',
    },
    {
      at: 300,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'ceo',
      text: 'La newsletter « Black Friday » doit partir à 14h30 vers 1,2 million d\'abonnés. '
        + 'On la décale ou pas ? Il me faut une réponse dans 10 minutes, avec une heure de retour crédible.',
    },
    {
      at: 370,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: 'Retard de consommation sur orders.created',
      service: 'order-events-consumer',
      text: 'Lag de 48 000 messages sur le topic Kafka orders.created, en hausse continue. '
        + 'Les confirmations de commande par e-mail partent avec 12 min de retard.',
    },
    {
      at: 430,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'communication',
      text: 'Ici Inès, de l\'agence. Ça chauffe sur les réseaux : 120 mentions « impossible de payer » en 15 min, '
        + 'dont un compte à 80 000 abonnés. La page de statut dit toujours que tout est opérationnel. '
        + 'On publie quoi, et qui valide ?',
    },
    {
      at: 490,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV1',
      title: 'Disponibilité du parcours d\'achat < 90 %',
      service: 'checkout-frontend',
      text: 'Sondes synthétiques : 4 parcours d\'achat sur 10 échouent depuis Paris, Francfort et Londres. '
        + 'Budget d\'erreur mensuel du checkout consommé à 64 %.',
    },
    {
      at: 550,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'ceo',
      text: 'Je sors du COMEX. J\'attends ici un point de situation écrit, que je puisse transférer tel quel : '
        + 'impact, hypothèse en cours, prochaine action et heure du prochain point.',
    },
    {
      at: 620,
      channelId: INCIDENT,
      kind: 'alert',
      severity: 'SEV3',
      title: 'Changement récent sur checkout-api',
      service: 'checkout-api',
      text: 'Un déploiement de checkout-api a eu lieu peu avant la première alerte. '
        + 'Voir avec l\'équipe Release pour le détail.',
    },
    {
      at: 690,
      channelId: GENERAL,
      kind: 'npc-message',
      npcId: 'support-n1',
      text: 'Le service grands comptes me relaie ceci : Maison Verdier menace de basculer chez un concurrent '
        + 'si les commandes ne passent pas avant 15h. Il leur faut une heure de retour à communiquer.',
    },
    {
      at: 760,
      channelId: INCIDENT,
      kind: 'npc-message',
      npcId: 'cfo',
      text: 'Marc Lefort, finance. Estimation du manque à gagner : environ 18 000 € par tranche de 15 minutes. '
        + 'Le COMEX est informé et demande qui pilote l\'incident.',
    },
    {
      at: 840,
      channelId: INCIDENT,
      kind: 'announcement',
      text: '[Animateur] Fin des injections. Stabilisez la situation, publiez une communication de suivi '
        + 'et notez les éléments de chronologie pour le post-mortem.',
    },
  ],
}
