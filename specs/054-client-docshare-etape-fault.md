# 054 — Client DocShare et étape de scénario `fault`
## Pourquoi
GOAL « monde DocShare piloté », tranche 1 : le scénario doit pouvoir activer/couper des pannes sur un vrai DocShare et conditionner ses messages à l'état de ces pannes. Brique de base des actions d'équipe et du scénario « rollback » à venir.
## Périmètre
- `server/utils/docshare-client.ts` : client serveur, `fetch` injectable ; config par env `DOCSHARE_BASE_URL`, `DOCSHARE_OPS_TOKEN` (envoyé en `X-Ops-Token` sur `/ops/*` seulement, non utilisé par `/admin/faults`, aujourd'hui sans authentification). Fonctions : `setFault(name, value)` = `POST /admin/faults` `{name, value}` ; `getFaults()` = `GET /admin/faults` (optionnel). Sans `DOCSHARE_BASE_URL` : client désactivé, toute opération échoue proprement. Jetons jamais renvoyés au navigateur (ni routes, ni logs, ni messages d'erreur). Documenter les variables dans README et `render.yaml` (`sync: false` pour le jeton).
- `server/utils/fault-state.ts` : registre mutable `name -> value` des pannes connues (`set`, `get`, `isActive(name)` = valeur > 0, `activeNames()`, `clear()`), module singleton utilisable plus tard par les actions d'équipe.
- Type d'étape `fault` (`shared/types/scenario.ts`) : `{at, kind:'fault', name, value}` (`channelId` non pertinent pour ce type) ; le runner l'exécute à `at` via le client, met à jour le registre seulement si l'appel réussit, étape `published` si OK, `failed` sinon (erreur réseau/HTTP/timeout capturée, le scénario continue). Libellé d'étape : `Panne name=value`. Runner étendu, non réécrit (dépendance injectée, ex. `applyFault`).
- Condition d'étape optionnelle `when?: { fault: string, active: boolean }` sur tout type d'étape, évaluée à l'instant d'émission (`at`) sur le registre : condition fausse → étape `cancelled`, rien publié.
- Arrêt (`stop`) et reset (`POST /api/admin/reset` déjà branché sur stop) : coupent (`value: 0`) toutes les pannes activées par le scénario (valeur > 0 appliquée avec succès), puis vident le registre ; échec de coupure journalisé, sans exception.
## Hors périmètre
- Actions ChatOps, console, PNJ, scénario réel ou de démonstration (les tests suffisent), débrief, chart/plateforme (injection des variables), déploiement, `kubectl`, authentification de `/admin/faults`, appels `/ops/*` (le jeton est prévu dans la config mais aucune route `/ops` n'est appelée ici).
- Lecture de `GET /admin/faults` pour resynchroniser le registre (fonction `getFaults` fournie et testée, non appelée par le runner).
## Critères d'acceptation
- [x] CA1 — Client à fetch simulé : `setFault('upload_latency', 3)` envoie `POST {base}/admin/faults` avec corps JSON `{"name":"upload_latency","value":3}` ; `getFaults()` envoie `GET /admin/faults` ; sans `DOCSHARE_BASE_URL` ou sur réponse HTTP non 2xx / rejet réseau, l'appel rejette avec une erreur dont le message ne contient ni le jeton ni l'URL complète.
- [x] CA2 — Horloge simulée : une étape `fault` à `at: 60` n'appelle pas le client à t = 59 s, l'appelle exactement une fois à t = 60 s ; registre `isActive('upload_latency')` vrai ensuite, étape `published`.
- [x] CA3 — Client qui rejette : étape `failed`, registre inchangé, l'étape suivante (annonce à `at` ultérieur) est publiée et le scénario atteint `finished`.
- [x] CA4 — Avec `when:{fault:'upload_latency',active:true}` : étape publiée si la panne est active à `at`, `cancelled` sinon ; avec `active:false` le résultat est inversé (tests des deux cas, panne activée par une étape `fault` antérieure puis coupée par une étape `value:0`).
- [x] CA5 — `stop()` après deux pannes activées (une à 0 ignorée) : le client simulé reçoit un `value:0` pour chaque panne activée avec succès (et aucune autre), le registre est vide ensuite ; un échec de coupure sur l'une n'empêche pas la coupure des autres.
- [x] CA6 — Test de non-fuite : la valeur de `DOCSHARE_OPS_TOKEN` n'apparaît dans aucun corps de réponse des routes `/api/admin/scenarios*` ni dans l'état d'exécution renvoyé (`ScenarioRun`).
## Vérification
`npx vitest run tests/docshare-client.test.ts tests/fault-state.test.ts tests/scenario-runner.test.ts` (ajuster aux noms réels) ; aucun appel réseau réel, client et horloge injectés.
## Notes d'implémentation
Le `publish` du runner est synchrone : traiter `fault` dans le runner via une dépendance asynchrone injectée (`applyFault`), l'étape passant à `published`/`failed` à la résolution. Timeout fetch court (ex. 3 s, `AbortSignal.timeout`). Valeurs de pannes : entiers/flottants tels qu'acceptés par DocShare (`value: 0` = coupée). `onStop` existant sert au retour à l'état sain.

## Évolution 2026-10-27 — variables d'environnement posées par le chart
Contexte : câblage du scénario « biais cognitifs » ; la spec n'avait documenté les variables que dans le README et `render.yaml`.
### Périmètre
- Chart `deploy/chart` : valeurs `docshare.baseUrl` (vide), `docshare.opsToken` (vide), `grafana.dashboardUrl` (vide). `DOCSHARE_BASE_URL` et `GRAFANA_DASHBOARD_URL` dans le ConfigMap, **seulement si non vides** ; `DOCSHARE_OPS_TOKEN` dans le Secret, seulement si non vide (le checksum existant redéploie le pod au changement). Valeurs vides = comportement actuel inchangé. Documenter dans le README du dépôt et dans le contrat de compatibilité de la plateforme (valeurs d'environnement consommées : `docshare.*`, `grafana.dashboardUrl`).
### Critères d'acceptation
- [x] CA7 — `helm template` du chart avec les valeurs par défaut : aucune des trois variables ; avec les trois valeurs posées : `DOCSHARE_BASE_URL` et `GRAFANA_DASHBOARD_URL` dans le ConfigMap, `DOCSHARE_OPS_TOKEN` dans le Secret et nulle part ailleurs ; `helm lint` passe (valeurs locales et eks de la plateforme comprises).
- [x] CA8 — Le README du dépôt décrit ces trois valeurs ; les contrôles du contrat (typecheck, tests, build, test:http) passent, les fiches PNJ étant générées si le lint du chart l'exige.
### Vérification
`helm lint` / `helm template` (défauts et valeurs posées) ; contrôles du contrat.
