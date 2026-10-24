# Guide animateur : Fuite de données clients

Scénario `fuite-donnees`, environ 14 minutes d'injections. Ce guide se lit en séance. Il est écrit à partir de `server/scenarios/fuite-donnees.ts` (dont l'en-tête décrit les recoupements voulus) et des fiches `server/npc/personas/fuite-donnees/`. Si l'une ou l'autre change, le test `tests/guides.test.ts` signale les écarts de chronologie et de chiffres. L'enjeu est la décision et la communication plus que la cause technique.

## Pitch

À lire aux participants avant le lancement.

Vous êtes l'équipe chargée de répondre à un incident de sécurité dans une boutique en ligne. Le canal **Incident en cours** reçoit les alertes automatiques et les signalements ; les messages du support et de la communication arrivent dans **Incident en cours** et dans **Général** : surveillez les deux canaux. Vos collègues de la sécurité, des données, du juridique, de la communication et du support détiennent chacun une partie des faits, et aucun ne vous donnera la réponse toute faite.

Votre rôle : établir ce qui s'est passé en interrogeant vos collègues (mentionnez-les avec `@Prénom` ou ouvrez une conversation directe depuis la section « Conversations »), décider ce qu'il faut faire et ce qu'il faut dire, à qui et quand. Désignez dès le début une personne qui pilote. Notez les heures importantes : elles serviront au débrief.

## Vérité terrain

À ne pas dire aux participants avant le débrief.

**Cause.** Lundi à 18h05, Hugo Lemaire (équipe Data) a appliqué la pull request #482 sur le bucket `crm-exports-prod` : ACL `public-read`, pour débloquer Routilo, le routeur d'e-mails de l'entreprise (un prestataire, sous-traitant sous contrat), qui n'arrivait pas à lire l'export mensuel. C'était censé être temporaire ; il a oublié de revenir en arrière. Le changement est parti par le pipeline Terraform de l'équipe Data.

**Le fichier.** `export-clients-2026-10.csv`, 6,1 Mo, 48 210 clients : e-mail, prénom, nom, téléphone, date de naissance et code postal. Pas de mot de passe, pas de numéro de carte, pas d'adresse complète.

**Les accès.** Trois téléchargements anonymes du fichier complet sur 7 jours, dans les journaux du bucket : lundi à 18h20 depuis 203.0.113.24 (c'est Routilo, qui a récupéré le fichier juste après le changement : accès prévu, d'un sous-traitant) ; puis deux depuis 198.51.100.77, hier à 23h14 et ce matin à 9h31. Ces deux-là sont des accès par un tiers non autorisé, dont on ne connaît pas l'identité. Aucune des deux adresses n'appartient aux plages de l'entreprise.

**Le signalement.** Ce matin à 9h52, par l'adresse de contact du fichier `security.txt` : une personne se présentant comme chercheuse en sécurité. C'est l'heure de prise de connaissance. Elle n'a pas joint le fichier et attend un accusé de réception.

**Les conséquences déjà visibles.** Des SMS frauduleux de « remboursement » citent le prénom et la date de naissance des clients, avec un lien vers un faux site : les données sont déjà exploitées. Un journaliste (Rémi Vasseur, « La Gazette du Code ») dit avoir reçu un extrait d'une dizaine de lignes et veut une réaction avant 17h. Le portail client subit 1 840 connexions échouées en 20 minutes depuis 46 IP, sur des adresses e-mail de comptes existants : les fiches ne l'expliquent pas, ne tranchez pas.

**Les règles qui s'appliquent.** Notification à la CNIL dans les 72 heures après la prise de connaissance, même incomplète, à compléter ensuite. Information directe des personnes si le risque est élevé, ce qui est le cas ici puisque les données sont exploitées. Journaux conservés 7 jours seulement : les copier avant de fermer l'accès, et ne rien supprimer.

**Chronologie réelle.**
1. Lundi à 18h05 : PR #482, bucket public.
2. Lundi à 18h20 : Routilo télécharge le fichier.
3. Hier à 23h14 : premier téléchargement par un tiers.
4. Ce matin à 9h31 : second téléchargement par le même tiers.
5. Ce matin à 9h52 : signalement reçu par le SOC, qui ouvre l'incident (0:00).

Les fiches ne disent pas quel jour on est (« hier » et « lundi » y sont distincts) : si on vous le demande, ne l'inventez pas.

**Chiffres clés.** 48 210 clients ; 3 téléchargements, dont 2 par un tiers ; 6,1 Mo ; 72 heures ; journaux conservés 7 jours ; 7 signalements de SMS ; 1 840 connexions échouées depuis 46 IP ; journaliste avant 17h ; déclaration d'attente demandée sous 30 minutes ; fermeture de l'accès en 2 minutes par le pipeline, copie des journaux en une dizaine de minutes.

**Pièges.** Supprimer le fichier ou les journaux (Hugo Lemaire le propose, Yanis Belkacem l'interdit). Fermer le bucket avant d'avoir copié les journaux. Affirmer « aucune donnée n'a fuité ». Traiter l'accès de Routilo comme un accès de tiers non autorisé, ou ne pas lui demander de confirmer par écrit ce qu'il a fait du fichier. Publier sans la validation d'Élise Marchand.

## Chronologie des injections

L'horloge part du lancement. Toutes ces lignes sont publiées par le serveur. En plus, les PNJ répondent aux questions et peuvent intervenir spontanément (voir la section suivante).

| t | Canal | Auteur | Résumé |
| --- | --- | --- | --- |
| 0:00 | Incident en cours | Yanis Belkacem | Ouvre l'incident : signalement à 9h52 via `security.txt`, le fichier `export-clients-2026-10.csv` est lisible sans authentification sur `crm-exports-prod` ; il n'a rien ouvert ni modifié. |
| 0:30 | Incident en cours | Alerting | SEV2 : ACL `public-read` détectée sur `crm-exports-prod`, contraire à la règle « aucun bucket public en production ». |
| 1:20 | Incident en cours | Alerting | SEV3 : 3 lectures anonymes du fichier sur 7 jours, 6,1 Mo à chaque fois ; détail dans les journaux du bucket, consultables par le SOC. |
| 2:30 | Général | Nadia Fontaine | Deux clients signalent un SMS de « remboursement » qui les appelle par leur prénom, avec un lien : est-ce bien nous ? Que répondre ? |
| 3:40 | Général | Bastien Roux | Un journaliste de « La Gazette du Code » dit avoir reçu un extrait du fichier clients et veut une réaction avant 17h. |
| 4:50 | Incident en cours | Alerting | SEV3 : 1 840 connexions échouées en 20 min depuis 46 IP, sur des adresses e-mail de comptes existants. |
| 6:00 | Incident en cours | Élise Marchand | La DPO rappelle les obligations et ce qu'il lui faut pour notifier : heure de connaissance, données touchées, nombre de personnes, accès de tiers. |
| 7:10 | Incident en cours | Bastien Roux | La direction veut une déclaration d'attente d'ici 30 minutes ; rien ne sera publié sans faits confirmés ni validation d'Élise Marchand. |
| 8:20 | Incident en cours | Yanis Belkacem | Qui pilote l'incident ? Et on ne supprime rien, ni le fichier ni les journaux. |
| 10:00 | Incident en cours | Alerting | SEV3 : le dernier changement de configuration du bucket vient du pipeline Terraform de l'équipe Data, voir avec elle. C'est le premier indice vers Hugo Lemaire. |
| 11:20 | Général | Nadia Fontaine | 7 signalements du SMS ; « nous vérifions » ne tient plus, il lui faut un message validé. |
| 12:40 | Incident en cours | Élise Marchand | Elle veut un premier état écrit, même partiel : données, nombre de personnes, accès de tiers, mesures prises. |
| 14:00 | Incident en cours | Animateur | Annonce de fin des injections : décider de la notification, de l'information des personnes et de la presse, préserver les preuves, noter la chronologie. |

## PNJ

Cinq personnages. Yanis Belkacem, Nadia Fontaine, Bastien Roux et Élise Marchand parlent d'eux-mêmes par les étapes ci-dessus. Hugo Lemaire ne dit rien tant qu'on ne l'interroge pas, et il ne livre ses aveux que sur des questions précises, posées sans l'accabler. Un PNJ répond aux mentions (`@Hugo`, `@Hugo Lemaire`), à son nom écrit en clair et en conversation directe. Un message sans mention ni nom dans un canal d'incident ne reçoit aucune réponse ; mentionner un personnage absent du scénario affiche « X n'est pas dans ce scénario. ». Le rythme de réponse (instantané, réaliste, occupé) se règle dans `/admin`.

| Nom | Rôle | Ce qu'il sait | Bonnes questions | Ne livre que sur question précise | Interventions spontanées |
| --- | --- | --- | --- | --- | --- |
| Yanis Belkacem | Analyste SOC, équipe Sécurité | Signalement à 9h52 par `security.txt` d'une chercheuse en sécurité ; bucket confirmé en lecture publique ; il n'a pas ouvert le fichier, ne sait pas ce qu'il contient ; rien n'est modifié, le fichier est toujours en ligne ; il faut préserver les preuves avant de toucher au bucket ; 1 840 connexions échouées en 20 minutes depuis 46 IP. Ignore le contenu du fichier, qui a ouvert le bucket, les obligations légales, la communication. | « Qui a téléchargé le fichier, à quelles heures ? » (journaux d'accès) ; « D'où viennent les adresses IP, sont-elles à nous ? » ; « Peut-on supprimer ou fermer le bucket tout de suite, que faut-il conserver ? » ; « Qu'a dit la personne qui a fait le signalement ? » | 3 téléchargements anonymes de 6,1 Mo : lundi à 18h20 depuis 203.0.113.24, puis deux depuis 198.51.100.77, hier à 23h14 et ce matin à 9h31 ; aucune de ces adresses n'est à nous ; il ignore à qui est 203.0.113.24 (à demander aux équipes qui travaillent avec des prestataires) et qui est derrière 198.51.100.77 ; journaux conservés 7 jours seulement, à copier dans le coffre de preuves (une dizaine de minutes) avant de fermer l'accès, sans rien supprimer ; la chercheuse n'a pas joint le fichier, attend un accusé de réception et n'a pas de réponse tant qu'on ne sait pas qui pilote. | Aucune. |
| Hugo Lemaire | Développeur, équipe Data | L'équipe Data produit chaque mois l'export des clients dans `crm-exports-prod` pour les outils marketing ; le bucket est décrit en Terraform, chaque changement passe par une pull request ; cette semaine, un outil marketing n'arrivait pas à lire l'export et il a réglé les droits ; peut remettre le bucket en privé en 2 minutes avec le feu vert du pilote ; pense que le plus simple est de supprimer le fichier. Ignore qui a téléchargé le fichier, les obligations légales, les SMS. | « Qu'est-ce qui a changé sur la configuration du bucket, pourquoi est-il public ? » ; « Qui est Routilo, qu'a-t-il récupéré et quand ? » ; « Que contient l'export, combien de clients ? » ; « Peut-on remettre le bucket en privé ? » | Lundi à 18h05, PR #482, ACL `public-read` pour débloquer Routilo, censée être temporaire, oubliée ; Routilo, prestataire, a récupéré le fichier vers 18h20 lundi ; l'export contient 48 210 clients : e-mail, prénom, nom, téléphone, date de naissance, code postal, sans mot de passe, carte ni adresse complète ; il peut annuler la PR (bucket privé en 2 minutes) ou supprimer le fichier, et attend le feu vert du pilote. | Aucune. |
| Élise Marchand | Déléguée à la protection des données (DPO), juridique | Notification à la CNIL dans les 72 heures après la prise de connaissance, même enquête inachevée ; quatre éléments nécessaires (heure de connaissance, catégories de données, nombre de personnes, accès de tiers non autorisés) ; information directe des personnes si risque élevé ; toute déclaration publique passe par elle ; tout documenter, ne rien détruire. Ignore tous les faits techniques, le contenu du fichier et le nombre de clients. | « Dans quel délai notifier, et qu'est-ce qu'il vous faut pour notifier ? » ; « Quand faut-il informer les clients, qu'est-ce qu'un risque élevé ? » ; « Routilo, notre sous-traitant, est-il un tiers non autorisé ? » ; « Pouvez-vous valider une déclaration pour la presse ? » | Risque élevé si les données sont déjà exploitées contre les personnes (messages frauduleux personnalisés) : informer chaque client sans tarder, en plus de la notification ; Routilo est un sous-traitant sous contrat, son accès n'est pas un accès de tiers non autorisé, mais il doit confirmer par écrit ce qu'il a fait du fichier ; contenu de la notification, à compléter ensuite si un élément manque ; pour la presse, un texte qui reconnaît un incident de sécurité en cours d'analyse, sans minimiser ni avancer de chiffre non confirmé. | Après 8 minutes : rappelle qu'un délai légal court depuis la connaissance de l'incident. |
| Bastien Roux | Directeur de la communication | Un journaliste de « La Gazette du Code » a reçu un extrait et publie avant 17h sinon ; la direction veut une déclaration d'attente dans la demi-heure ; il refuse d'écrire « aucune donnée n'a fuité » sans confirmation ; rien ne part sans la validation d'Élise Marchand. Ignore le contenu du fichier, le nombre de clients, la technique, les obligations légales. | « Qui est le journaliste, qu'a-t-il reçu ? » ; « Avez-vous un brouillon de déclaration ? » ; « Que veut la direction ? » | Rémi Vasseur, sérieux, vérifie ses sources ; l'extrait compte une dizaine de lignes avec noms, e-mails et téléphones, il refuse de l'envoyer et publiera avec ou sans réaction ; brouillon d'attente évoquant un incident de sécurité, à valider ; la direction veut savoir si l'accès est fermé, si des clients sont concernés, s'il faut les prévenir, et qui pilote. | Si aucun message ne parle de point ou de statut depuis 6 minutes : n'a rien de solide à dire à la presse. Après 12 minutes : veut savoir ce qu'on peut affirmer. |
| Nadia Fontaine | Responsable du support client | Des clients signalent depuis ce matin un SMS de « remboursement » qui les appelle par leur prénom avec un lien, et leur nombre augmente ; la boutique n'envoie jamais ce SMS ; les clients demandent si leurs données ont fuité ; on répond « nous vérifions » ; il lui faut un message validé. Ignore l'origine des SMS, la technique, ce qu'on a le droit de dire sur les données. | « Que dit exactement le SMS, quelles informations cite-t-il ? » ; « Que répondez-vous aux clients aujourd'hui ? » ; « Combien de signalements, de quels clients ? » | Le SMS cite le prénom et la date de naissance, avec un lien vers un faux site de remboursement aux couleurs de la boutique ; aucun client ne dit y avoir saisi sa carte ; réponse actuelle : « nous vérifions, ne cliquez pas sur le lien » ; signalements par le chat et le téléphone, de toute la France, clients récents comme anciens. | Après 5 minutes : son équipe attend une consigne claire. |

## Recoupement et décisions attendus

**Pour établir les faits, il faut recouper.** Aucune étape ne les livre.
- Cause : Hugo Lemaire (PR #482, lundi à 18h05, ACL `public-read` pour Routilo, Routilo a récupéré le fichier vers 18h20) et Yanis Belkacem (heures des 3 téléchargements). Le téléchargement de lundi à 18h20 est donc celui du sous-traitant ; les deux autres, depuis une IP inconnue, sont des accès par un tiers.
- Ampleur : Hugo Lemaire (48 210 clients, e-mail, prénom, nom, téléphone, date de naissance, code postal) et Yanis Belkacem (deux accès inconnus).
- Gravité : Nadia Fontaine (le SMS cite la date de naissance : données exploitées) et Élise Marchand (données exploitées par des messages frauduleux personnalisés : risque élevé).

**Décisions attendues.**
1. Désigner une personne qui pilote (Yanis Belkacem le demande à 8:20, la direction aussi).
2. Préserver les preuves : copier les journaux d'accès (conservés 7 jours) avant de fermer l'accès, ne rien supprimer. Refuser la suppression du fichier proposée par Hugo Lemaire.
3. Fermer l'accès : feu vert à Hugo Lemaire pour annuler la PR #482, une fois les journaux copiés.
4. Notifier la CNIL dans les 72 heures après 9h52, avec ce qu'on sait, et compléter ensuite.
5. Informer les personnes concernées, puisque le risque est élevé.
6. Faire confirmer par écrit à Routilo ce qu'il a fait du fichier.
7. Répondre à la chercheuse (accusé de réception), que Yanis Belkacem n'a pas encore contactée.
8. Donner à Nadia Fontaine un message validé pour les clients (SMS frauduleux, ne pas cliquer, ce qui s'est passé).
9. Publier une déclaration d'attente validée par Élise Marchand : incident de sécurité en cours d'analyse, sans chiffre non confirmé, sans « aucune donnée n'a fuité ».

## Relances si l'équipe bloque

Montez d'un niveau seulement après quelques minutes sans progrès. Les PNJ spontanés relancent déjà sur le silence ; ne les doublez pas.

1. **Léger : rappeler le dispositif.** « Vous avez cinq collègues, les avez-vous tous interrogés ? Vous pouvez les mentionner avec `@Prénom` ou ouvrir une conversation directe. » Demandez qui pilote.
2. **Orienter.** « Que sait-on exactement : quel fichier, depuis quand, qui l'a lu, que contient-il ? » ; « Quelles sont nos obligations légales, et qui les connaît ? » ; « Qui a modifié ce bucket en dernier ? ».
3. **Explicite.** Dites-leur de demander à `@Yanis` les journaux d'accès et ce qu'il faut conserver, à `@Hugo` ce qui a changé sur le bucket et ce que contient l'export, et à `@Élise` ce qu'il faut pour notifier. Si c'est encore trop tôt dans la séance, vous pouvez aussi publier vous-même l'alerte « Dernier changement de configuration de crm-exports-prod » depuis `/admin` (section « Publier une alerte »).

## Débrief

Appuyez-vous sur la chronologie exportée depuis `/admin` (section « Chronologie (post-mortem) » : afficher, ou « Télécharger .md »). Elle fusionne alertes, annonces, messages de PNJ, réponses et acquittements, avec l'heure de Paris. Comparez-la à la chronologie des injections ci-dessus.

| Question | Où la lire dans l'export |
| --- | --- |
| Quand la personne qui pilote a-t-elle été désignée ? | Premier message qui l'annonce ; Yanis Belkacem la demande à 8:20. |
| Quand a-t-on interrogé Yanis Belkacem sur les accès, et Hugo Lemaire sur le changement ? | Premiers messages qui les mentionnent, comparés à l'alerte de 10:00. |
| Les journaux ont-ils été copiés avant la fermeture du bucket ? | Messages à Yanis Belkacem et à Hugo Lemaire, dans cet ordre. |
| Quelqu'un a-t-il proposé ou accepté de supprimer le fichier ? | Réponses de Hugo Lemaire et décisions qui suivent. |
| L'accès de Routilo a-t-il été distingué de celui du tiers inconnu ? | Échanges avec Hugo Lemaire, Yanis Belkacem et Élise Marchand. |
| La notification, l'information des personnes et la réponse à la chercheuse ont-elles été décidées, par qui, à quelle heure ? | Messages à Élise Marchand et à Yanis Belkacem. |
| Qui a validé la déclaration à la presse ? A-t-on écrit « aucune donnée n'a fuité » ? | Messages à Bastien Roux et à Élise Marchand. |
| Quel message a reçu le support, et quand ? | Messages à Nadia Fontaine, comparés à ses relances de 2:30 et 11:20. |

Questions ouvertes : qu'est-ce qui a aidé ou gêné la circulation de l'information ? Quel contrôle aurait évité un bucket public (revue de la PR, retour arrière automatique, alerte de posture plus tôt) ? Qu'a-t-on décidé sans les faits ?

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

**Lancement.** Section « Scénario d'incident » de `/admin`, choisir « Fuite de données clients » puis lancer. S'il reste des messages, `/admin` propose « Effacer et lancer », « Lancer sans effacer » ou « Annuler ». Le lancement active les PNJ, et les fiches de ce scénario remplacent celles du précédent. « Arrêter » coupe aussi les PNJ si la case est cochée ; l'annonce d'animateur à 14:00 clôt les injections mais ne coupe rien : pensez à « Arrêter » en fin de séance.

**Choix du moteur des PNJ** (`NPC_ENGINE`) :
- `keywords` (défaut, sans clé ni réseau) : réponse déterministe, la phrase de ton du PNJ suivie de deux extraits de sa fiche. Une section « Sur question précise » ne sort que si la question contient au moins deux de ses mots-clés, ou un mot-clé spécifique. Une question vague reçoit la réponse de repli du PNJ. Limite : ton moins naturel, il faut des questions précises, d'où l'intérêt de la colonne « Bonnes questions ».
- `openai-compatible` (modèle local Ollama avec `k8s:up:ollama`, `qwen2.5:7b` par défaut, ou tout serveur compatible) : réponses naturelles en 1 à 3 phrases. Limites : un petit modèle peut inventer un détail ou le prénom de l'interlocuteur, et la première réponse sur CPU est lente ; en cas d'échec, repli sur `keywords`, signalé dans le panneau « Architecture ».
- `anthropic` (API Claude, clé `ANTHROPIC_API_KEY`) : réponses plus fiables. Limites : clé et accès réseau requis, coût par message ; même repli sur `keywords`.

**Interventions spontanées.** Les PNJ peuvent relancer l'équipe sans être interrogés (colonne de droite du tableau PNJ). L'interrupteur « Interventions spontanées » est dans la section « Personnages (PNJ) » de `/admin`, actif par défaut. Désactivez-le pour une séance calme ou pour juger l'équipe sans pression. Chaque règle part une fois par lancement, et un PNJ attend 4 minutes entre deux interventions.

**Fiches.** Elles sont embarquées au build ; un rechargement ou une modification via `/admin` (ou la ConfigMap sur Colima) ne met pas ce guide à jour : il décrit les fichiers du dépôt.
