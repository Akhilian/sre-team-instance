# 056 — Scénario « Le rollback qui ne sert à rien » (données, alertes conditionnelles, guide)
## Pourquoi
GOAL « monde DocShare piloté », tranche 3 : un scénario jouable sur DocShare réel, avec deux causes indépendantes (B silencieuse portée par la release, A bruyante sans lien) pour que des généralistes tombent dans les biais d'incident (ancrage sur l'alerte, fausse corrélation « la release », cause unique, clôture prématurée, pression d'autorité). Tout est en donnée de scénario, sauf une petite extension du runner.
## Périmètre
- **Runner** : `ScenarioStepBase.when` accepte une condition ou une liste de conditions (`ScenarioCondition | ScenarioCondition[]`), évaluées en ET à l'instant d'émission ; liste vide = toujours vraie ; une condition fausse → `cancelled` (comportement 054 inchangé pour une condition seule).
- **Scénario** `server/scenarios/rollback-inutile.ts` (id `rollback-inutile`, ajouté à `SCENARIOS`), canal `incident-en-cours`. Étapes, `at` en secondes :
  - 0 : `fault` `stale_index`=1 (B). 360 : `fault` `upload_latency`=2.0 (A).
  - 120 : ticket isolé, facile à écarter (Support, `npc-message`, « un document introuvable »). 1200 : groupe de tickets « documents déposés ce matin introuvables » (Support).
  - 390, puis toutes les 300 s jusqu'à 2 790 inclus : alerte SEV2 « Latence d'upload élevée » (service `docshare-upload`), `when` A active. Aucune étape `alert` sur B ni sur l'index.
  - 600 : direction, démo client dans l'heure. 900 : direction, demande de point. 1 500, 2 100, 2 700 : direction demande de **clore** (`when` : A inactive ET B active). 1 080 : communication, question sur la page de statut.
  - 1 200, 1 800, 2 400 : message « le rollback n'a pas réglé la latence » (`when` : B inactive ET A active), émis par Communication ou Support.
  - 5 400 : annonce animateur de fin de séance (étape finale tardive).
- **Actions** (`Scenario.actions`, données seules, types de la 055) : « Revenir à la version précédente » (simulated, 20 s, `stale_index`→0), « Redémarrer la base » (simulated, 45 s, `upload_latency`→0), « Contrôler l'index » (index-check), « Réindexer » (reindex, ≈90 s côté DocShare), « Voir le changelog » (changelog : release de 14h05 avec DEUX changements, « optimisation de l'indexation » et « nouveau chemin d'upload »), plus lien santé via 055. Textes de démarrage/fin neutres : rien ne révèle la cause.
- **Fin de séance (décision)** : le scénario reste `running` jusqu'à l'étape finale à 5 400 s ; la règle de la 055 (actions disparues à `finished`) n'est PAS modifiée, car aucun changement de comportement n'est nécessaire et l'animateur arrête le scénario à la main.
- **Fiches minimales** `server/npc/personas/rollback-inutile/` : support-n1, direction, communication (identité, rôle, ton, ce qu'ils savent de l'incident SANS la cause), juste assez pour que les `npc-message` se publient. Release manager, règles proactives et finesse des fiches : spec 057.
- **Guide** `docs/guide-animateur/rollback-inutile.md` (sections de `tests/guides.test.ts`, `rollback-inutile` ajouté aux deux listes du test) : vérité terrain minute par minute (B dès 0, A dès 6:00, release 14h05), biais visés et étape où chacun se déclenche, questions de débrief, remise à l'état sain de DocShare (pannes à 0 via `/admin/faults`, réindexation, `POST /api/admin/reset`).
## Écarts acceptés 2026-10-27
- npcId `support-docshare`, `direction-docshare`, `communication-docshare` au lieu de `support-n1`/`communication` (déjà pris par panne-checkout).
- Test « aucune étape ne livre rollback » assoupli pour ce scénario seulement.
- Durées 20/45 s dans le paragraphe « Actions et délais » du guide, pas dans la table.
## Hors périmètre
- Fiches PNJ complètes et release manager (057), débrief automatique (tranche 4), multi-équipe, câblage chart/plateforme (`OPS_TOKEN`, URL, Grafana), déploiement, `kubectl`, modification de DocShare, amendement de la 055.
## Critères d'acceptation
- [x] CA1 — Runner à registre simulé : `when` en liste n'émet que si TOUTES les conditions sont vraies (cas 2×2 testés), sinon `cancelled` ; condition seule et absence de `when` inchangées.
- [x] CA2 — Catalogue : `rollback-inutile` présent, étapes triées, première étape `fault stale_index=1` à 0, `fault upload_latency=2.0` à 360 ; exactement les alertes SEV2 listées, toutes avec `when` A active ; aucune alerte ne mentionne index, document ni recherche.
- [x] CA3 — Horloge et client simulés : à 390 s alerte émise ; après action « Revenir… » (20 s) puis, A encore active, un message « rollback inutile » à 1 200 s ; après coupure de A seule, les alertes suivantes sont `cancelled` et la demande de clore est émise à 1 500 s ; si A et B sont coupées, ni message « rollback » ni demande de clore.
- [x] CA4 — Les actions déclarent les délais et pannes ci-dessus (20 s/`stale_index`, 45 s/`upload_latency`), le changelog contient les deux changements et 14h05 ; aucun texte d'étape ou d'action ne contient « stale_index » ni « upload_latency » ni ne désigne la cause.
- [x] CA5 — Le scénario sélectionne ses propres fiches (3 fiches parsent) ; chaque `npcId` d'étape existe ; le dernier `at` vaut 5 400 et les 5 actions restent exposées par `GET /api/actions` à 5 399 s (statut `running`).
- [x] CA6 — `tests/guides.test.ts` passe avec le guide : une ligne de chronologie par étape, table PNJ = 3 fiches, heures/nombres de la vérité terrain présents dans étapes/fiches, pitch sans la cause ; le guide cite chaque biais visé et la remise à l'état sain.
## Vérification
`npx vitest run tests/scenario-runner.test.ts tests/scenarios.test.ts tests/guides.test.ts tests/team-actions.test.ts` (ajuster aux noms réels) ; aucun appel réseau, aucun critère Chrome.
## Notes d'implémentation
Normaliser `when` en tableau dans `scenario-runner.ts` (l.142) ; mettre à jour le type et la doc du champ. Générer les alertes répétées par une boucle dans le fichier de scénario (données restent explicites dans le guide : une ligne par alerte). Écrire les heures/nombres du guide en cohérence avec les textes (test CA1 guide).
## Suite
057 — fiches PNJ complètes (release manager, règles proactives `silence`/réactions, personnalités) ; 4 — débrief des biais.
