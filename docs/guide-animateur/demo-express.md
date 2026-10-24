# Guide animateur : Démo express

Scénario `demo-express`, 6 secondes. Il sert à vérifier avant l'atelier que le lancement et la publication automatique fonctionnent. Ce n'est pas un exercice pour les participants.

## But

Contrôler en quelques secondes que l'instance publie bien les étapes d'un scénario : un message de PNJ, puis deux alertes. Les PNJ restent coupés pendant la démo, et le message de Sarah Benali vient de la fiche du scénario `panne-checkout`.

## Trois étapes en 6 secondes

1. À 0:00, Sarah Benali signale des lenteurs au paiement dans « Incident en cours ».
2. À 0:03, une alerte SEV2 de démonstration (latence p95).
3. À 0:06, une alerte SEV1 de démonstration (taux d'erreur 5xx).

Les PNJ ne sont pas activés : mentionner un PNJ affiche l'avis « Les PNJ ne sont pas actifs ». Pensez à « Effacer les messages » avant l'atelier : les messages de démonstration y restent sinon.

## Chronologie des injections

| t | Canal | Auteur | Résumé |
| --- | --- | --- | --- |
| 0:00 | Incident en cours | Sarah Benali | Message de démonstration du lanceur d'alerte : quelques clients signalent des lenteurs au paiement. |
| 0:03 | Incident en cours | Alerting | SEV2 de démonstration : latence p95 à 1,3 s depuis 2 min. |
| 0:06 | Incident en cours | Alerting | SEV1 de démonstration : 12 % de réponses 5xx sur les 5 dernières minutes. |
