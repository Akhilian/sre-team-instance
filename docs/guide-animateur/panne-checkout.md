# Guide animateur : Panne du checkout

Scénario `panne-checkout`, environ 14 minutes d'injections. Ce guide se lit en séance : les sections sont dans l'ordre où l'on en a besoin. Il est écrit à partir de `server/scenarios/panne-checkout.ts` et des fiches `server/npc/personas/panne-checkout/`. Si l'une ou l'autre change, le test `tests/guides.test.ts` signale les écarts de chronologie et de chiffres.

## Pitch

À lire aux participants avant le lancement.

Vous êtes l'équipe d'astreinte d'une boutique en ligne, un jour de forte activité commerciale. Le canal **Incident en cours** reçoit des alertes automatiques ; les messages de vos collègues du support, de la direction, de la communication et de la finance arrivent dans **Incident en cours** et dans **Général** : surveillez les deux canaux. Chacun n'a qu'une partie de l'information et personne ne vous donnera la réponse toute faite.

Votre rôle : comprendre ce qui se passe en interrogeant vos collègues (mentionnez-les avec `@Prénom` ou ouvrez une conversation directe depuis la section « Conversations »), décider, puis communiquer. Désignez dès le début une personne qui pilote. Notez les heures importantes : elles serviront au débrief.

## Vérité terrain

À ne pas dire aux participants avant le débrief.

**Cause.** La release `checkout-api` v2.41.0 a été mise en production environ 6 minutes avant la première alerte de latence, d'un coup sur tous les pods, sans canary, sans nouveau test de charge. Elle embarque un nouveau client HTTP vers `payment-gateway` : timeout passé de 5 s à 30 s, 3 retries automatiques, pool limité à 10 connexions. Quand les 10 connexions sont prises, les autres paiements attendent leur tour chez nous, avant l'envoi : un paiement peut rester bloqué jusqu'à 1 min 30. Les retries renvoient la même demande au prestataire (2 à 3 fois, sans clé d'idempotence), ce qui, selon Thomas Keller, explique les doubles débits.

**Le prestataire de paiement (Paiemio, fictif) n'est pas en cause.** Latence p95 d'environ 180 ms chez lui, refus au niveau habituel (environ 2 %, cartes refusées par les banques), aucun timeout, aucun incident, page de statut à jour. Il ne voit jamais plus de 10 connexions simultanées depuis nos IP, contre environ 80 d'habitude.

**Remède.** Retour arrière vers v2.40.3, stable depuis trois semaines, sans migration de base : environ 5 minutes, lancé par Julien Moreau une fois que la personne qui pilote lui donne le feu vert.

**Chronologie réelle.**
1. Environ 6 minutes avant la première alerte de latence : v2.41.0 en production.
2. Juste avant cette alerte : premier ticket « paiement impossible » chez Sarah Benali.
3. Ensuite, la dégradation s'étend (voir la chronologie des injections ci-dessous) jusqu'à la panne du parcours d'achat.

**Chiffres clés.** p95 à 2,4 s (SLO : 800 ms) ; 17,8 % de réponses 5xx ; 188/200 connexions sur la base `orders-db`, dont 142 pour `checkout-api` ; 22 % des appels au PSP dépassent 10 s ; commandes validées : -64 % sur 10 min ; 40 tickets et 25 clients en attente sur le chat ; newsletter prévue à 14h30 vers 1,2 million d'abonnés, décalable sans frais jusqu'à 14h15 ; manque à gagner d'environ 18 000 € par tranche de 15 minutes ; Maison Verdier menace de partir avant 15h.

**Fausses pistes.** La base de données (l'alerte la montre presque saturée, principalement par `checkout-api`), le prestataire de paiement (sain), le navigateur ou le mobile (les plaintes viennent de partout). Les paiements par carte cadeau passent ; ceux par carte bancaire échouent.

## Chronologie des injections

L'horloge part du lancement. Toutes ces lignes sont publiées par le serveur. En plus, les PNJ répondent aux questions et peuvent intervenir spontanément (voir la section suivante).

| t | Canal | Auteur | Résumé |
| --- | --- | --- | --- |
| 0:00 | Incident en cours | Sarah Benali | Ouvre l'incident : le bouton « Payer » tourne puis affiche une erreur technique, une dizaine de tickets. |
| 0:20 | Incident en cours | Alerting | SEV2 : latence p95 à 2,4 s sur `POST /api/checkout`, 12 % des requêtes au-delà de 3 s. |
| 0:50 | Incident en cours | Alerting | SEV3 : pool de connexions PostgreSQL proche de la saturation, 188/200. |
| 1:40 | Incident en cours | Alerting | SEV1 : 17,8 % de réponses 5xx, erreurs 503 vers `payment-gateway`, commandes validées en baisse de 64 %. |
| 2:40 | Général | Sarah Benali | 40 tickets, 25 clients en attente sur le chat : elle demande un message et une heure de retour. |
| 3:50 | Incident en cours | Alerting | SEV2 : 22 % des appels au PSP dépassent 10 s, circuit breaker ouvert 3 fois ; page de statut du PSP « tous les systèmes opérationnels ». |
| 5:00 | Incident en cours | Claire Dumont | Newsletter Black Friday à 14h30 vers 1,2 million d'abonnés : la décale-t-on ? Réponse attendue dans 10 minutes. |
| 6:10 | Incident en cours | Alerting | SEV3 : retard de 48 000 messages sur `orders.created`, e-mails de confirmation en retard. |
| 7:10 | Général | Inès Garnier | 120 mentions « impossible de payer » en 15 min, dont un compte à 80 000 abonnés : on publie quoi, et qui valide ? |
| 8:10 | Incident en cours | Alerting | SEV1 : 4 parcours d'achat sur 10 échouent, budget d'erreur consommé à 64 %. |
| 9:10 | Incident en cours | Claire Dumont | Elle attend un point de situation écrit, transférable tel quel : impact, hypothèse, prochaine action, heure du prochain point. |
| 10:20 | Incident en cours | Alerting | SEV3 : un déploiement de `checkout-api` a eu lieu peu avant la première alerte, voir avec l'équipe Release. C'est le premier indice explicite. |
| 11:30 | Général | Sarah Benali | Maison Verdier menace de partir si les commandes ne passent pas avant 15h : il lui faut une heure de retour. |
| 12:40 | Incident en cours | Marc Lefort | Environ 18 000 € perdus par tranche de 15 minutes ; le COMEX demande qui pilote l'incident. |
| 14:00 | Incident en cours | Animateur | Annonce de fin des injections : stabiliser, publier un suivi, noter la chronologie. |

## PNJ

Six personnages. Sarah Benali, Claire Dumont, Inès Garnier et Marc Lefort parlent d'eux-mêmes par les étapes ci-dessus. Julien Moreau ne dit rien tant qu'on ne l'interroge pas, et Thomas Keller seulement quand on parle du prestataire : ce sont eux qui détiennent la cause. Un PNJ répond aux mentions (`@Julien`, `@Julien Moreau`), à son nom écrit en clair et en conversation directe. Un message sans mention ni nom dans un canal d'incident ne reçoit aucune réponse ; mentionner un personnage absent du scénario affiche « X n'est pas dans ce scénario. ». Le rythme de réponse (instantané, réaliste, occupé) se règle dans `/admin`.

| Nom | Rôle | Ce qu'il sait | Bonnes questions | Ne livre que sur question précise | Interventions spontanées |
| --- | --- | --- | --- | --- | --- |
| Sarah Benali | Support client N1 | Les clients bloquent à l'étape paiement ; une dizaine de tickets, puis une quarantaine, 25 clients en attente sur le chat ; e-mails de confirmation en retard ; plaintes sur ordinateur comme mobile ; Maison Verdier menace de partir avant 15h. Ignore la cause, les mises en production et le contrat de Maison Verdier. | « Depuis quand, à quelle heure le premier ticket ? » ; « Des clients débités deux fois ? » ; « Quels moyens de paiement échouent, carte bancaire, carte cadeau ? » ; « Que répondez-vous aux clients ? » | Le premier ticket est arrivé juste avant la première alerte de latence ; trois clients disent avoir été débités deux fois (deux lignes à quelques secondes d'écart) ; les cartes cadeau passent, les cartes bancaires échouent ; elle répond avec une macro générique et veut un message validé et une heure de retour. | Si aucun message ne parle de point ou de statut depuis 7 minutes : demande une idée du retour. |
| Claire Dumont | CEO | Newsletter Black Friday à 14h30 vers 1,2 million d'abonnés ; plus grosse journée de vente de l'année ; le COMEX veut un point écrit toutes les 30 minutes ; veut une seule personne qui pilote ; aucune communication publique sans qu'elle l'ait relue. Ignore la technique et le montant précis des pertes. | « Peut-on décaler la newsletter, jusqu'à quelle heure ? » ; « Avons-nous votre feu vert pour un retour arrière ? » ; « Quand est le prochain point COMEX ? » | Décalage sans frais jusqu'à 14h15, ensuite l'agence facture et le créneau est perdu ; feu vert pour toute action qui rétablit le paiement vite, retour arrière compris, à condition de lui dire ce qu'on risque ; prochain point COMEX dans 30 minutes, sinon elle appelle le CTO. | Si aucun message ne parle de point ou de statut depuis 6 minutes : réclame un point de situation et un pilote. Après 12 minutes : menace de monter d'un cran côté direction. |
| Inès Garnier | Responsable communication, agence externe | La page de statut dit toujours « tous les systèmes opérationnels » et se met à jour en deux minutes avec un message validé ; mentions en forte hausse et compte influent à 80 000 abonnés ; une journaliste veut une réaction avant 15 h ; peut mettre la newsletter en pause mais la décision revient à Claire Dumont. Ignore la cause, les livraisons récentes, le coût. | « Peux-tu proposer un brouillon pour la page de statut ? » ; « Peut-on promettre un remboursement ? » ; « Que répond-on à la journaliste ? » ; « Peux-tu mettre la newsletter en pause ? » | Brouillon de page de statut et de déclaration presse, toujours soumis au feu vert de Claire Dumont ; aucune promesse de remboursement ni geste commercial ; première prise de parole identique partout (statut, réseaux, presse) ; pause de la newsletter en un clic, gratuite si prévenue avant 14h15, avec l'accord écrit de Claire Dumont. | Après 9 minutes : les mentions montent, elle veut un cap. |
| Marc Lefort | CFO, directeur financier | Environ 18 000 € perdus par tranche de 15 minutes (environ 1 200 € par minute) ; environ un client sur trois revient payer plus tard ; Maison Verdier pèse environ 8 % du chiffre d'affaires, avec un SLA à pénalités ; le COMEX demande qui pilote. Ignore la cause technique, les livraisons, la communication. | « Quel est le total des pertes depuis le début ? » ; « Que prévoit le contrat de Maison Verdier, SLA et pénalités ? » ; « Faut-il décaler la newsletter Black Friday ? » | Contrat Maison Verdier : 99,9 % de disponibilité par mois (environ 43 minutes tolérées), pénalité de 5 % de la facture mensuelle (environ 40 000 €), résiliation possible au-delà de 4 heures ; cumul recalculé tous les quarts d'heure ; mieux vaut décaler la newsletter que l'envoyer sur un checkout en panne. | Dès qu'un message parle de paiement, clients, commandes, ventes ou blocage : demande un ordre de grandeur de l'impact et une heure de retour. Après 15 minutes : redemande une heure de retour. |
| Julien Moreau | Release Manager, équipe Paiements | A déployé `checkout-api` v2.41.0 environ 6 minutes avant la première alerte de latence ; validée en recette la veille, tests de charge non rejoués ; mise en production d'un coup sur tous les pods, sans canary ; rien d'autre n'est parti autour du checkout ; peut lancer un retour arrière en 5 minutes avec le feu vert du pilote. Ne fait pas le lien avec l'incident de lui-même. Ignore l'état réel du PSP et les métriques de la base. | « Qu'est-ce qui a été déployé récemment, quelle version ? » ; « Qu'est-ce qui a changé dans le client HTTP ? » ; « Quelle configuration de timeout, de retries et de pool vers le PSP ? » ; « Peut-on faire un rollback, vers quelle version ? » | Détail de la v2.41.0 : nouveau client HTTP vers `payment-gateway`, timeout de 5 s à 30 s, 3 retries, pool de 10 connexions ; un paiement peut rester bloqué jusqu'à 1 min 30 et les autres attendent quand les 10 connexions sont prises ; rollback vers v2.40.3, sans migration de base, environ 5 minutes. | Aucune. |
| Thomas Keller | Responsable technique de compte, Paiemio (prestataire de paiement, fictif) | Sa plateforme fonctionne normalement (p95 d'environ 180 ms) ; aucune maintenance en cours ; aucun incident ouvert ni autre client touché ; page de statut à jour. Ne voit que ce qui arrive chez lui. Ignore vos déploiements et votre infrastructure en amont. | « Combien de connexions simultanées voyez-vous depuis nos IP ? » ; « Recevez-vous des demandes en double ? » ; « Voyez-vous des erreurs ou des timeouts ? » | Jamais plus de 10 connexions simultanées depuis vos IP contre environ 80 d'habitude, requêtes traitées en 180 ms : l'attente est chez vous, avant l'envoi ; la même demande de paiement arrive 2 à 3 fois, sans clé d'idempotence, d'où les doubles débits ; refus au niveau habituel (environ 2 %), aucun timeout de son côté. | Dès qu'un message parle de PSP, Paiemio, prestataire, passerelle ou gateway : propose de regarder ses journaux si on lui dit quoi chercher. |

Aucune heure courante n'est fixée par le scénario. Si l'équipe la demande, choisissez-en une avant 14h15 et tenez-vous-y.

## Recoupement et décisions attendus

**Pour établir la cause, il faut recouper.** Aucune étape ne la livre.
- Julien Moreau : la v2.41.0 est arrivée environ 6 minutes avant la première alerte, avec un nouveau client HTTP (timeout 30 s, 3 retries, pool de 10 connexions).
- Thomas Keller : le prestataire est sain, ne voit jamais plus de 10 connexions simultanées, et reçoit des demandes en double ; l'attente est donc avant l'envoi.
- Sarah Benali : doubles débits et premier ticket juste avant la première alerte.
- L'alerte de 10:20 pointe vers le déploiement : une équipe qui n'a pas encore interrogé Julien Moreau à ce moment est en retard.

**Décisions attendues.**
1. Désigner une personne qui pilote et qui parle à la direction (Claire Dumont et le COMEX le réclament).
2. Décider du retour arrière vers v2.40.3 : Julien Moreau attend le feu vert du pilote ; Claire Dumont l'autorise si on le lui demande, à condition de lui dire ce qu'on risque.
3. Décider de la newsletter avant 14h15 (sans frais), avec l'accord de Claire Dumont ; Inès Garnier exécute la pause.
4. Publier une communication validée par Claire Dumont : page de statut, réseaux, presse, avec une heure de prochain point, sans promesse de remboursement.
5. Donner une heure de retour et un message à Sarah Benali pour le support et pour Maison Verdier.
6. Noter les heures (première alerte, cause, décision, rollback, communications) pour le post-mortem.

**Pièges.** Accuser le prestataire, parce que sa page de statut et la nôtre disent que tout va bien. Promettre un remboursement. Publier sans l'accord de Claire Dumont. Attendre la cause certaine avant de communiquer.

## Relances si l'équipe bloque

Montez d'un niveau seulement après quelques minutes sans progrès. Les PNJ spontanés relancent déjà sur le silence et la pression ; ne les doublez pas.

1. **Léger : rappeler le dispositif.** « Vous avez six collègues, les avez-vous tous interrogés ? Vous pouvez les mentionner avec `@Prénom` ou ouvrir une conversation directe. » Demandez qui pilote.
2. **Orienter.** « Qu'est-ce qui a changé juste avant la première alerte, et qui le sait ? » ; « Le prestataire dit que tout va bien : l'attente se produit-elle chez lui ou chez nous ? ».
3. **Explicite.** Dites-leur de demander à `@Julien Moreau` ce qui a été déployé récemment et quelle configuration du client HTTP, puis à `@Thomas Keller` combien de connexions il voit. Si c'est encore trop tôt dans la séance, vous pouvez aussi publier vous-même l'alerte « Changement récent sur checkout-api » depuis `/admin` (section « Publier une alerte »).

## Débrief

Appuyez-vous sur la chronologie exportée depuis `/admin` (section « Chronologie (post-mortem) » : afficher, ou « Télécharger .md »). Elle fusionne alertes, annonces, messages de PNJ, et réponses, avec l'heure de Paris. Comparez-la à la chronologie des injections ci-dessus.

| Question | Où la lire dans l'export |
| --- | --- |
| Quand la première alerte a-t-elle été vue, et par qui ? | Premier message d'un participant sur l'alerte, après 0:20. |
| Quand la personne qui pilote a-t-elle été désignée ? | Premier message qui l'annonce ; Marc Lefort la demande à 12:40 ; Claire Dumont réclame un point écrit à 9:10 et par ses relances spontanées. |
| Combien de temps avant d'interroger Julien Moreau ? | Premier message qui mentionne `@Julien` ou son nom, comparé à l'alerte de 10:20. |
| Le prestataire a-t-il été soupçonné à tort ? | Messages avant et après la réponse de Thomas Keller. |
| Quand le retour arrière a-t-il été décidé ? | Message de feu vert à Julien Moreau. |
| La newsletter a-t-elle été décidée avant 14h15 ? | Échange avec Claire Dumont et Inès Garnier. |
| Quelle première communication, validée par qui, avec quelle heure de prochain point ? | Messages à Inès Garnier et à Sarah Benali ; recherchez toute promesse de remboursement. |
| Les alertes ont-elles été prises en charge dans le canal ? | Messages et réponses qui suivent la ligne « Alerte ». |

Questions ouvertes : qu'est-ce qui a aidé ou gêné la circulation de l'information ? Quel signal aurait permis d'agir plus tôt (changement récent, déploiement sans canary, tests de charge non rejoués) ? Que mettre dans un runbook ?

## Préparation

**Instance.**
- **Render** : l'URL du service. Le code animateur est la valeur de `FACILITATOR_CODE` saisie dans **Environment** ; sans elle, un code est généré et écrit une fois dans les logs. Sans `REDIS_URL`, les conversations sont perdues si le service redémarre.
- **Colima (Kubernetes local)** : `npm run k8s:up`, ou `npm run k8s:up:ollama` pour un modèle local (jusqu'à 20 minutes la première fois). Accès `http://localhost:8088`. Code `demo-animateur`, ou la valeur de `FACILITATOR_CODE` passée au déploiement.
- **Local** : `npm run dev`, code `animateur`.

**Avant l'arrivée des participants.**
1. Ouvrir `/admin` (non liée dans la navigation), saisir le code, « Valider le code ».
2. Ouvrir le panneau « Architecture » (moteur, modèle, scénario en cours) et vérifier le moteur des PNJ.
3. Entre deux groupes : « Effacer les messages » vide les conversations et garde les canaux et les PNJ actifs ; « Tout réinitialiser » supprime aussi les canaux créés par les participants et la présence, et coupe les PNJ. Les deux arrêtent le scénario en cours.
4. Les participants ouvrent la même URL, saisissent leur nom d'affichage et rejoignent « Incident en cours ». Compter 15 participants au plus.

**Lancement.** Section « Scénario d'incident » de `/admin`, choisir « Panne du checkout » puis lancer. S'il reste des messages, `/admin` propose « Effacer et lancer », « Lancer sans effacer » ou « Annuler ». Le lancement active les PNJ. « Arrêter » coupe aussi les PNJ si la case est cochée ; une annonce d'animateur clôt les injections à 14:00 mais ne coupe rien : pensez à « Arrêter » en fin de séance.

**Choix du moteur des PNJ** (`NPC_ENGINE`) :
- `keywords` (défaut, sans clé ni réseau) : réponse déterministe, la phrase de ton du PNJ suivie de deux extraits de sa fiche. Une section « Sur question précise » ne sort que si la question contient au moins deux de ses mots-clés, ou un mot-clé spécifique. Une question vague reçoit la réponse de repli du PNJ. Limite : ton moins naturel, il faut des questions précises, d'où l'intérêt de la colonne « Bonnes questions ».
- `openai-compatible` (modèle local Ollama avec `k8s:up:ollama`, `qwen2.5:7b` par défaut, ou tout serveur compatible) : réponses naturelles en 1 à 3 phrases. Limites : un petit modèle peut inventer un détail ou le prénom de l'interlocuteur, et la première réponse sur CPU est lente ; en cas d'échec, repli sur `keywords`, signalé dans le panneau « Architecture ».
- `anthropic` (API Claude, clé `ANTHROPIC_API_KEY`) : réponses plus fiables. Limites : clé et accès réseau requis, coût par message ; même repli sur `keywords`.

**Interventions spontanées.** Les PNJ peuvent relancer l'équipe sans être interrogés (colonne de droite du tableau PNJ). L'interrupteur « Interventions spontanées » est dans la section « Personnages (PNJ) » de `/admin`, actif par défaut. Désactivez-le pour une séance calme ou pour juger l'équipe sans pression. Chaque règle part une fois par lancement, et un PNJ attend 4 minutes entre deux interventions.

**Fiches.** Elles sont embarquées au build ; un rechargement ou une modification via `/admin` (ou la ConfigMap sur Colima) ne met pas ce guide à jour : il décrit les fichiers du dépôt.
