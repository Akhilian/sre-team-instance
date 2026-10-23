# 027 — PNJ : second scénario « Fuite de données clients » avec ses propres PNJ

## Pourquoi
La phase 2 (specs/GOAL.md) veut une information répartie entre PNJ qu'il faut recouper pour décider. Un second scénario d'une autre nature montre que le cadre est générique. Une fuite de données, contrairement à une panne, se joue sur la décision (fermer l'accès sans détruire les preuves, notifier sous 72 h, informer les personnes) et sur la communication. La cause technique compte moins. Une panne DNS ou cloud serait une seconde indisponibilité, trop proche de `panne-checkout`.

## Périmètre
- Scénario `fuite-donnees` (titre « Fuite de données clients ») dans `server/scenarios/fuite-donnees.ts`, ajouté à `SCENARIOS` après `panne-checkout`. Il compte 13 étapes de t=0 à t=840 s, dans `incident-en-cours` et `general` :
  - 0 : PNJ `soc` (incident). Signalement reçu à 9h52 via security.txt : `export-clients-2026-10.csv` est lisible sans authentification sur le bucket `crm-exports-prod`. Le fichier n'a pas encore été ouvert.
  - 30 : alerte SEV2 `storage-posture`, « Bucket de stockage accessible publiquement » (ACL public-read, non conforme).
  - 80 : alerte SEV3 `object-storage`, « 3 lectures anonymes » du fichier sur 7 jours (6,1 Mo).
  - 150 : PNJ `support-clients` (general). Deux clients signalent un SMS de « remboursement » qui les appelle par leur prénom.
  - 220 : PNJ `porte-parole` (general). Un journaliste de « La Gazette du Code » dit avoir reçu un extrait du fichier et veut une réaction avant 17h.
  - 290 : alerte SEV3 `auth-portal`. 1 840 connexions échouées en 20 min, depuis 46 IP, avec des e-mails existants.
  - 360 : PNJ `dpo` (incident). Pour notifier, elle doit connaître l'heure de prise de connaissance, les données touchées, le nombre de personnes et l'existence d'un accès par des tiers.
  - 430 : PNJ `porte-parole`. La direction veut une déclaration d'attente d'ici 30 min.
  - 500 : PNJ `soc`. Il demande qui pilote et rappelle qu'il ne faut rien supprimer.
  - 600 : alerte SEV3 `object-storage`. Le dernier changement de configuration du bucket vient du pipeline Terraform de l'équipe Data ; voir avec elle.
  - 680 : PNJ `support-clients`. 7 signalements de SMS ; les clients demandent si leurs données ont fuité.
  - 760 : PNJ `dpo`. Elle demande un premier état écrit (données, nombre, tiers, mesures).
  - 840 : seule annonce, `[Animateur] Fin des injections…`. Elle demande de décider de la notification, de l'information des personnes et de la déclaration, de préserver les preuves et de noter la chronologie.
- 5 fiches dans `server/npc/personas/fuite-donnees/`, avec `personality`, des ids différents de ceux de `panne-checkout` et des noms fictifs, différents des 6 existants :
  - `soc` (Yanis Belkacem, analyste SOC, lanceur d'alerte). Sur question précise, il connaît les journaux d'accès : un téléchargement lundi à 18h20 depuis 203.0.113.24, puis deux depuis 198.51.100.77, hier à 23h14 et ce matin à 9h31. Les journaux ne sont gardés que 7 jours : il faut les copier avant de toucher au bucket. Il ignore le contenu du fichier et l'auteur du changement.
  - `dev-data` (Hugo Lemaire, développeur de l'équipe Data, gêné et sur la défensive). Lundi à 18h05, il a appliqué la PR #482 (`public-read`) pour débloquer le routeur d'e-mails « Routilo », puis oublié de revenir en arrière. Routilo a récupéré le fichier vers 18h20. Le fichier contient 48 210 clients : e-mail, prénom, nom, téléphone, date de naissance et code postal, sans mot de passe ni carte. Il peut revenir en arrière en 2 min, avec le feu vert du pilote. Il propose de « supprimer le fichier », ce qui est une fausse bonne idée.
  - `dpo` (Élise Marchand, DPO et juridique). Elle sait que la notification à la CNIL doit partir dans les 72 heures après la prise de connaissance, ce qu'elle doit contenir, et que Routilo est un sous-traitant sous contrat. Elle informe les personnes en cas de risque élevé. Elle ignore tous les faits techniques.
  - `porte-parole` (Bastien Roux, directeur de la communication). Il connaît le journaliste et le délai de 17h. Il refuse d'écrire « aucune donnée n'a fuité » sans confirmation, et la déclaration doit être validée par la DPO.
  - `support-clients` (Nadia Fontaine, support). Sur question précise, elle sait que les SMS citent la date de naissance du client et pointent vers un faux site de remboursement.
- Recoupement voulu, écrit en commentaire d'en-tête du scénario :
  - Cause : SOC (heures des téléchargements) + Dev (changement de 18h05, Routilo à 18h20).
  - Décision : Dev (données et volume) + SOC (deux accès inconnus) + DPO (72 h) + Support (exploitation, donc risque élevé). Il faut notifier, informer les personnes, fermer l'accès après avoir copié les journaux et ne rien supprimer.
- Démarrage : avant tout lancement, le scénario courant des PNJ reste `panne-checkout` (le tri par chemin placerait sinon `fuite-donnees` en premier). Lancer un scénario n'active que ses PNJ ; `/api/npcs` et la liste « Conversations » suivent.
- Tests Vitest : `tests/npc-personas-fuite.test.ts` et des compléments dans `tests/scenarios.test.ts` et `tests/npc-dispatcher.test.ts`. Le dossier de `tests/npc-helpers.ts` devient un paramètre, `panne-checkout` par défaut.

## Hors périmètre
- Création d'une fiche depuis `/admin`, choix du scénario par défaut depuis l'interface, nouveaux types d'étape.
- Modification des fiches ou des étapes de `panne-checkout` et `demo-express`.
- Tout nom d'entreprise réelle. L'entreprise victime reste « notre boutique », les IP viennent des plages de documentation RFC 5737.

## Critères d'acceptation
- [x] CA1 — Chargement : les 5 fiches de `fuite-donnees` passent `checkPersonaFile` et ont toutes `personality`. Sur le build, `GET /api/admin/npc-personas` liste 11 fiches (6 + 5). Aucun id de PNJ n'est commun aux deux scénarios, aucun nom non plus (casse ignorée).
- [x] CA2 — Scénario : `fuite-donnees` compte 12 à 14 étapes triées. La première est un `npc-message` de `soc` à t=0 dans `incident-en-cours`. Il y a une seule `announcement`, à t=840, qui commence par `[Animateur]`. Tout `npcId` d'étape existe dans `server/npc/personas/fuite-donnees/`. Aucune étape ne contient `18h05`, `#482`, `48 210`, `Routilo`, `23h14` ni `9h31`.
- [x] CA3 — Répartition, testée par chaîne exacte sur les fiches de `fuite-donnees` :
  - `18h05`, `#482` et `48 210` ne figurent que dans `dev-data` ;
  - `23h14`, `9h31` et `198.51.100.77` ne figurent que dans `soc` ;
  - `72 heures` ne figure que dans `dpo` ;
  - `18h20` figure dans `soc` et `dev-data` exactement : c'est le recoupement ;
  - `date de naissance` figure dans `dev-data` et `support-clients` exactement ;
  - le fait-clé de chacune de ces fiches n'apparaît que dans une puce « Sur question précise » (et non dans « Sait »), sauf pour `dpo` (`72 heures` dans « Sait »).
- [x] CA4 — Cohérence : toute heure au format `\d{1,2}h\d{2}` présente dans les fiches de `fuite-donnees` ou dans les textes du scénario appartient à la chronologie canonique déclarée dans le test (`18h05`, `18h20`, `23h14`, `9h31`, `9h52`, `17h00` ou `17h`, à ajuster en un seul endroit). `9h52` figure à la fois dans l'étape t=0 et dans la fiche `soc`. Les chiffres « 3 lectures » (alerte t=80) et le nombre de téléchargements de la fiche `soc` (1 + 2) concordent.
- [x] CA5 — Activation (test du dispatcher et test HTTP sur le build) :
  - au démarrage, `GET /api/npcs` renvoie `enabled:false` et les 6 PNJ de `panne-checkout` ;
  - après `POST /api/admin/scenarios/fuite-donnees/start`, il renvoie `enabled:true` et exactement les 5 ids `soc`, `dev-data`, `dpo`, `porte-parole`, `support-clients` ;
  - `POST /api/direct` avec `npcId:"support-n1"` répond 404, avec `npcId:"dpo"` 201 ;
  - un message `@Sarah Benali` ne reçoit aucune réponse PNJ, un message `@Yanis Belkacem` en reçoit une (moteur `keywords`) ;
  - relancer `panne-checkout` ramène ses 6 PNJ et refuse `dpo` en 404.
- [x] CA6 — Moteur `keywords` (test unitaire avec les vraies fiches) :
  - « quels téléchargements dans les journaux d'accès, à quelle heure ? » à `soc` donne `23h14` ;
  - « quelles données contient l'export, combien de clients ? » à `dev-data` donne `48 210` ;
  - « quel délai pour notifier la CNIL ? » à `dpo` donne `72 heures` ;
  - « qu'est-ce que le SMS mentionne exactement ? » à `support-clients` donne `date de naissance` ;
  - une question hors sujet donne la `deflection` de chacun.
- [x] CA7 — Chrome (orchestrateur), sur le build, deux onglets :
  - dans `/admin`, lancer « Fuite de données clients » ;
  - dans l'onglet participant, Yanis ouvre l'incident dans « Incident en cours » avec le badge PNJ ;
  - la section « Conversations » liste les 5 PNJ du scénario et aucun de `panne-checkout` ;
  - ouvrir une conversation directe avec Élise Marchand et lui demander le délai de notification : réponse avec « 72 heures » en quelques secondes ;
  - relancer « Panne du checkout » : la liste revient aux 6 PNJ d'origine.

## Vérification
```
npm test
npm run build && npm run test:http
grep -c '' server/npc/personas/fuite-donnees/*.md   # 5 fichiers
git grep -niE 'aws|azure|google|ovh|scaleway|mailchimp|sendinblue|brevo' -- server/npc/personas/fuite-donnees server/scenarios/fuite-donnees.ts   # aucune sortie
NPC_REPLY_DELAY_MS=0 node .output/server/index.mjs &
curl -s localhost:3000/api/npcs
curl -s -XPOST -H 'x-facilitator-code: animateur' localhost:3000/api/admin/scenarios/fuite-donnees/start
curl -s localhost:3000/api/npcs   # 5 ids de fuite-donnees
curl -s -XPOST -H 'content-type: application/json' -d '{"participant":"Alice","npcId":"support-n1"}' localhost:3000/api/direct -o /dev/null -w '%{http_code}\n'   # 404
```
Puis le parcours Chrome du CA7, mené par l'orchestrateur.

## Notes d'implémentation
- `createNpcDispatcher` : ajouter une option `initialScenarioId` (repli sur `personas[0]`), alimentée dans `server/utils/npc.ts` par `SCENARIOS[0].id`. `activateScenario` et `list` filtrent déjà par scénario.
- Les ids de conversation directe (`dm-<slug>--<npcId>`) n'incluent pas le scénario : des ids de PNJ distincts entre scénarios sont obligatoires (CA1).
- Modèle des fiches : `server/npc/personas/panne-checkout/release-manager.md`. Chaque puce précise a `!spécifique` ou au moins 2 déclencheurs, et les accents doivent être tolérés comme en 021.
- Les fiches sont des serverAssets : il faut rebuilder. `tests/npc-personas.test.ts` doit rester limité à `panne-checkout`.
- Le test de répartition ne lit que les fiches. Le scénario n'est testé que par le CA2 (aucun fait-clé dans ses étapes).
