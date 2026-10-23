// Scénario court (6 s) pour vérifier rapidement le lancement et la publication des étapes : message du
// lanceur d'alerte (PNJ Sarah Benali), puis deux alertes
import type { Scenario } from '../../shared/types/scenario'

export const demoExpress: Scenario = {
  id: 'demo-express',
  title: 'Démo express',
  // Pas de fiches propres : la démo publie un message de Sarah Benali, PNJ de panne-checkout
  npcScenarioId: 'panne-checkout',
  description: 'Trois étapes en 6 secondes pour tester la publication automatique avant l\'atelier : '
    + 'message du support (PNJ), puis deux alertes.',
  steps: [
    {
      at: 0,
      channelId: 'incident-en-cours',
      kind: 'npc-message',
      npcId: 'support-n1',
      text: '[Démo] Ici Sarah, du support : quelques clients signalent des lenteurs au paiement. '
        + 'Message de démonstration du lanceur d\'alerte.',
    },
    {
      at: 3,
      channelId: 'incident-en-cours',
      kind: 'alert',
      severity: 'SEV2',
      title: '[Démo] Latence p95 > 1 s',
      service: 'demo-api',
      text: 'Alerte de démonstration : latence p95 à 1,3 s depuis 2 min.',
    },
    {
      at: 6,
      channelId: 'incident-en-cours',
      kind: 'alert',
      severity: 'SEV1',
      title: '[Démo] Taux d\'erreur 5xx > 10 %',
      service: 'demo-api',
      text: 'Alerte de démonstration : 12 % de réponses 5xx sur les 5 dernières minutes.',
    },
  ],
}
