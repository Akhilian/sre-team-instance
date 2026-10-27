# Guide animateur : Le rollback qui ne sert à rien

Scénario `rollback-inutile`, environ 90 minutes d'injections, sur un DocShare réel (les pannes sont vraies, pas simulées dans le chat). Ce guide se lit en séance. Il est écrit à partir de `server/scenarios/rollback-inutile.ts` et des fiches `server/npc/personas/rollback-inutile/`. Le test `tests/guides.test.ts` signale les écarts de chronologie et de chiffres.

## Pitch

À lire aux participants avant le lancement.

Vous êtes l'équipe d'astreinte de DocShare, un service de dépôt et de partage de documents pour des entreprises. Une mise à jour est partie en production en début d'après-midi. Le canal **Incident en cours** reçoit les alertes automatiques et les messages de vos collègues du support, de la direction et de la communication. Une démonstration client importante a lieu dans l'heure : la direction compte sur vous.

Vous disposez d'un panneau d'actions (retour à la version précédente, redémarrage de la base, vérifications et réparations du service, journal des changements) et d'un lien vers l'état de santé du service. Interrogez vos collègues avec `@Prénom`, décidez, communiquez. Désignez une personne qui pilote et notez vos heures : elles serviront au débrief.

## Vérité terrain

À ne pas dire aux participants avant le débrief.

**Deux causes indépendantes.**
- **Cause B, silencieuse, portée par la release.** Dès le lancement, la mise à jour de 14h05 empêche l'indexation de suivre : les documents déposés restent introuvables dans la recherche. Aucune alerte ne la signale. Seuls le support et les clients la voient. Le retour à la version précédente (action rapide) la supprime ; la réindexation reconstruit ensuite l'index des documents déjà déposés.
- **Cause A, bruyante, sans lien avec la release.** À 6 minutes, une dégradation de la base fait monter la latence des dépôts. Dès la première alerte, environ 30 % des dépôts dépassent 3 s. Elle déclenche une alerte SEV2 « Latence d'upload élevée » toutes les 5 minutes tant qu'elle dure. Seul le redémarrage de la base (un peu plus long) la supprime ; le retour à la version précédente ne change rien.

**La release de 14h05** contient deux changements : une optimisation de l'indexation (la cause B) et un nouveau chemin d'upload. Le second est une fausse piste : il est visible dans le changelog et ressemble à la cause de la latence, mais A n'en dépend pas. Le changelog est un piège de corrélation, pas une explication.

**Conséquence.** Une équipe qui revient en arrière règle B mais pas A ; une équipe qui redémarre la base règle A mais pas B. Les alertes s'arrêtent dès que A est coupée : si B reste active, la direction réclame la clôture alors que les clients ne retrouvent toujours pas leurs documents. Si B est coupée avant A, les messages « le rollback n'a pas réglé la latence » arrivent. Si les deux sont coupées, rien de tout cela n'est envoyé.

## Chronologie des injections

L'horloge part du lancement. Les lignes « Système » sont des pannes réelles posées sur DocShare, invisibles des participants. Les lignes marquées (si …) ne partent que si la condition est vraie à l'instant prévu ; sinon l'étape est annulée.

| t | Canal | Auteur | Résumé |
| --- | --- | --- | --- |
| 0:00 | (aucun) | Système | Pose la cause B (indexation figée). Invisible. |
| 2:00 | Incident en cours | Léa Marchand | Ticket isolé : un client ne retrouve pas un document qu'il vient de déposer. Facile à écarter. |
| 6:00 | (aucun) | Système | Pose la cause A (latence d'upload). Invisible. |
| 6:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 3,8 s, 30 % des dépôts au-delà de 3 s (si A active). |
| 10:00 | Incident en cours | Hugo Perrin | Démonstration client dans l'heure : sommes-nous bons pour la démo ? |
| 11:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 3,9 s (si A active). |
| 15:00 | Incident en cours | Hugo Perrin | Demande un point court : ce qui ne va pas, ce que vous faites, quand ça revient. |
| 16:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,0 s (si A active). |
| 18:00 | Incident en cours | Nadia Cohen | Page de statut : oui ou non, et on écrit quoi ? |
| 20:00 | Incident en cours | Léa Marchand | Groupe de tickets : les documents déposés ce matin sont introuvables. |
| 20:00 | Incident en cours | Nadia Cohen | « Le rollback n'a pas réglé la latence » (si B coupée et A active). |
| 21:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,1 s (si A active). |
| 25:00 | Incident en cours | Hugo Perrin | Demande de clore l'incident (si A coupée et B active). |
| 26:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,2 s (si A active). |
| 30:00 | Incident en cours | Léa Marchand | « Le rollback n'a pas réglé la latence » côté clients (si B coupée et A active). |
| 31:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,3 s (si A active). |
| 35:00 | Incident en cours | Hugo Perrin | Redemande de clore l'incident (si A coupée et B active). |
| 36:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,4 s (si A active). |
| 40:00 | Incident en cours | Nadia Cohen | « Le rollback n'a pas réglé la latence », message de statut à adapter (si B coupée et A active). |
| 41:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,5 s (si A active). |
| 45:00 | Incident en cours | Hugo Perrin | Dernière demande de clore avant la démo (si A coupée et B active). |
| 46:30 | Incident en cours | Alerting | SEV2 : latence d'upload élevée, p95 à 4,6 s (si A active). |
| 90:00 | Incident en cours | Animateur | Annonce de fin de séance. |

Le scénario reste en cours jusqu'à 90:00 pour que le panneau d'actions reste disponible : arrêtez-le à la main à la fin du débrief.

### Vérité terrain minute par minute

- **Minute 0.** B est posée. Rien ne se voit côté alertes. Les premiers documents déposés ne sont plus indexés.
- **Minute 2.** Premier ticket isolé de Léa Marchand. C'est le premier signal de B, noyé : la plupart des équipes l'écartent.
- **Minute 6.** A est posée. La première alerte arrive à 6:30 et déclenche l'ancrage de l'équipe.
- **De la minute 6 à la minute 47.** Une alerte toutes les 5 minutes tant que A est active.
- **Minute 10.** Hugo Perrin met la pression (démo dans l'heure) : début de la pression d'autorité.
- **Minute 18.** Nadia Cohen demande ce qu'on dit aux clients : la communication prématurée est possible.
- **Minute 20.** Le groupe de tickets rend B visible pour qui lit le support. Si le retour à la version précédente a eu lieu, le message « le rollback n'a pas réglé la latence » arrive en parallèle.
- **Minutes 25, 35 et 45.** Demandes de clore, seulement si A est coupée et B toujours active : c'est le moment de la clôture prématurée.
- **Minute 90.** Annonce de fin de séance.

Actions et délais : « Revenir à la version précédente » (20 secondes, coupe B), « Redémarrer la base » (45 secondes, coupe A), « Contrôler l'index » (révèle l'index en retard), « Réindexer » (environ 90 secondes côté DocShare), « Voir le changelog » (release de 14h05, deux changements).

## PNJ

Trois personnages, qui parlent d'eux-mêmes par les étapes ci-dessus. Aucun ne connaît la cause : ils ne détiennent que des symptômes (documents introuvables, lenteur des dépôts) et la date de la mise à jour. Un PNJ répond aux mentions (`@Léa`), à son nom écrit en clair et en conversation directe. Le release manager et les fiches complètes viennent avec la spec 057.

| Nom | Rôle | Ce qu'il sait | Bonnes questions | Ne livre que sur question précise | Interventions spontanées |
| --- | --- | --- | --- | --- | --- |
| Léa Marchand | Support client N1 | Documents déposés ce matin introuvables à la recherche mais bien présents dans les dépôts récents ; lenteur des dépôts signalée par des clients ; mise à jour annoncée à 14h05. Ignore la cause et le contenu de la mise à jour. | « Depuis quand ? » ; « Les documents existent-ils quand même ? » ; « Qu'a-t-on annoncé comme mise à jour ? » | Les tickets « introuvable » précèdent les plaintes de lenteur ; les clients n'ont pas de message d'erreur, juste une attente. | Aucune. |
| Hugo Perrin | Directeur général | Démonstration client dans l'heure ; voit les alertes ; veut un point court et clôturer vite. Ignore la technique et les tickets. | « Pouvez-vous décaler la démo ? » ; « Sur quoi vous fondez-vous pour clore ? » | Peut décaler d'une heure au plus ; clôt dès que les alertes s'arrêtent. | Aucune. |
| Nadia Cohen | Responsable communication | Page de statut à « opérationnel » ; clients qui demandent si DocShare a un problème. Ignore la cause et les tickets. | « Que peut-on publier sur la page de statut ? » | Propose un message court sur la lenteur, après confirmation de l'équipe. | Aucune. |

## Recoupement et décisions attendus

**Biais visés et étape où chacun se déclenche.**
- **Ancrage sur l'alerte.** Les alertes de latence arrivent dès 6:30 et reviennent toutes les 5 minutes : l'équipe se focalise sur elles et oublie le signal discret du support à 2:00.
- **Fausse corrélation « la release ».** Le changelog (deux changements, dont un nouveau chemin d'upload) pousse à lier la latence à la mise à jour de 14h05, et à revenir en arrière.
- **Cause unique.** Après le retour à la version précédente, les messages de 20:00, 30:00 et 40:00 montrent que la latence persiste : l'équipe doit admettre qu'il y a deux causes.
- **Clôture prématurée.** Dès que A est coupée, les alertes s'arrêtent et la direction demande de clore à 25:00, 35:00 et 45:00, alors que B continue.
- **Pression d'autorité.** La démonstration client (10:00) et la demande de point (15:00) poussent à céder à la direction plutôt qu'à vérifier l'index et les tickets.

**Décisions attendues.**
1. Désigner une personne qui pilote.
2. Ne pas écarter le ticket de 2:00 ni le groupe de tickets de 20:00 : contrôler l'index, constater qu'il est en retard.
3. Traiter les deux problèmes : retour à la version précédente (B) et redémarrage de la base (A), puis réindexer.
4. Refuser de clore tant que les documents sont introuvables, quitte à contredire la direction.
5. Communiquer une première version honnête sur la page de statut, sans promettre.

## Relances si l'équipe bloque

Montez d'un niveau seulement après quelques minutes sans progrès.

1. **Léger.** « Avez-vous regardé autre chose que les alertes ? Qu'est-ce que le support vous dit ? »
2. **Orienter.** « Les documents introuvables et la latence ont-ils forcément la même cause ? »
3. **Explicite.** Demandez de lancer « Contrôler l'index » depuis le panneau d'actions, puis de relire le changelog avec les deux changements.

## Débrief

Appuyez-vous sur la chronologie exportée depuis `/admin` (section « Chronologie (post-mortem) »). Comparez-la à la chronologie ci-dessus.

Questions :
- Quand la première alerte a-t-elle été vue, et qui a regardé le ticket de 2:00 ?
- Pourquoi avoir lié la latence à la release ? Qu'est-ce qui l'a rendu plausible ?
- Qu'a-t-on appris du retour à la version précédente, et quand a-t-on compris qu'il y avait deux causes ?
- Quand la direction a demandé de clore, sur quoi s'est-on appuyé pour accepter ou refuser ?
- La pression de la démonstration a-t-elle changé une décision ?
- Quelle information le support détenait-il que les alertes ne montraient pas ? Quel signal aurait permis d'agir plus tôt ?
- Que mettre dans un runbook : alerte sur l'indexation, contrôle de l'index après toute release ?

## Préparation

**Avant l'arrivée des participants.**
1. Ouvrir `/admin`, saisir le code animateur, vérifier le moteur des PNJ dans « Architecture ».
2. Vérifier que DocShare répond (`DOCSHARE_BASE_URL`, `DOCSHARE_OPS_TOKEN` configurés) et que les deux pannes sont à 0.
3. Choisir « Le rollback qui ne sert à rien » dans « Scénario d'incident » puis lancer.

### Remise à l'état sain de DocShare

À faire après chaque séance, même si le scénario a été arrêté :
1. Remettre les deux pannes à 0 dans DocShare via `/admin/faults` (`stale_index` et `upload_latency`) ; l'arrêt du scénario tente de les couper, mais vérifiez.
2. Lancer « Réindexer » (environ 90 secondes) ou la réindexation de DocShare, puis vérifier avec « Contrôler l'index » que l'index est à jour.
3. Dans war-room, `POST /api/admin/reset` (corps `{"scope":"all"}`, en-tête `x-facilitator-code`) efface les messages et arrête le scénario.
