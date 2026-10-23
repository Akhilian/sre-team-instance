# 012 — Scénario d'incident pré-écrit, lancé par l'animateur

## Pourquoi
L'atelier simule un incident déclenché par du paging : aujourd'hui l'animateur doit publier chaque alerte et annonce à la main (011, 007). Un scénario pré-écrit, publié côté serveur au bon moment, rend l'exercice reproductible et laisse l'animateur observer les équipes.

## Périmètre
- Format de scénario dans le dépôt, `server/scenarios/*.ts` (typé, exporté via un index) : `{ id, title, description, steps }`, chaque étape `{ at: secondes depuis le lancement, channelId, kind: 'alert', severity, title, service, text }` ou `{ at, channelId, kind: 'announcement', text }`.
- Deux scénarios fournis : `panne-checkout` (« Panne du checkout », ≥ 4 étapes sur quelques minutes : alerte SEV2 latence checkout-api à `at: 0`, puis SEV1 5xx, annonce « le support remonte des plaintes clients », etc., dans `incident-en-cours` et/ou `general`) et `demo-express` (3 étapes à `at` 0, 3 et 6 s, pour tester rapidement).
- Exécuteur unique en mémoire (`server/utils/scenario-runner.ts`) : un seul scénario en cours à la fois ; planificateur (`schedule`/`cancel`) et horloge `now` injectables ; publie via `addAlert` / `addAnnouncement` du store. Une étape qui échoue (canal disparu…) est marquée `failed` sans arrêter les suivantes.
- État d'exécution : `{ scenarioId, title, status: 'running'|'finished'|'stopped', startedAt, steps: [{ index, at, kind, channelId, label, status: 'pending'|'published'|'failed'|'cancelled', publishedAt? }] }` ; `label` = titre de l'alerte ou début de l'annonce.
- Routes protégées par `x-facilitator-code` (401 sinon, vérifié en premier) :
  - `GET /api/admin/scenarios` → `{ scenarios: [{ id, title, description, stepCount, durationSeconds }], run: <état> | null }` (dernier run, même terminé ou arrêté).
  - `POST /api/admin/scenarios/:id/start` → 201 + état ; 404 scénario inconnu ; 409 si un scénario est déjà `running`.
  - `POST /api/admin/scenarios/stop` → 200 + état `stopped` (étapes restantes `cancelled`) ; 409 si rien n'est en cours.
- `POST /api/admin/reset` arrête aussi le scénario en cours (étapes restantes `cancelled`, rien n'est publié ensuite).
- `/admin` : section « Scénario d'incident » (`data-testid="scenario-panel"`) : liste des scénarios (titre, description, nombre d'étapes, durée) avec bouton « Lancer » ; pendant et après une exécution, liste des étapes avec délai `+MM:SS`, libellé et statut en français (« À venir » / « Publiée » / « Échec » / « Annulée »), bouton « Arrêter » si en cours ; rafraîchissement par polling (≈ 2 s) tant que l'état est `running`.

## Hors périmètre
- Édition ou création de scénarios depuis l'interface, import de fichier, pause/reprise, accélération du temps.
- Persistance de l'exécution au redémarrage du serveur (un redémarrage perd le scénario en cours).
- Réactions automatiques à l'action des participants (ex. résolution automatique quand une alerte est acquittée).

## Critères d'acceptation
- [x] CA1 — Tests Vitest de l'exécuteur avec planificateur/horloge simulés (ou `vi.useFakeTimers`) : au lancement l'étape `at: 0` est publiée, les suivantes seulement après leur délai ; `stop` annule les étapes restantes (`cancelled`, rien publié ensuite) ; un second lancement pendant un run → erreur distincte (409) ; fin naturelle → `finished` ; étape vers un canal inconnu → `failed` et les suivantes passent quand même ; l'arrêt déclenché par la réinitialisation se comporte comme `stop`.
- [x] CA2 — Test Vitest de cohérence : chaque scénario fourni a un `id` unique, des étapes triées par `at` croissant, des `channelId` parmi les canaux pré-créés et des champs d'alerte valides selon `shared/utils/alerts.ts`.
- [x] CA3 — Via HTTP : `GET /api/admin/scenarios` sans code → 401 ; avec code → 200 listant `panne-checkout` et `demo-express`, `run: null` au démarrage ; `start` d'un id inconnu → 404 ; `start` de `demo-express` → 201, et immédiatement la première étape apparaît dans les messages du canal ciblé ; second `start` → 409 ; après ≈ 8 s, les 3 étapes sont publiées et `run.status = "finished"`.
- [x] CA4 — Via HTTP : relancer `demo-express`, `stop` aussitôt → 200 et `status: "stopped"` ; après 8 s, une seule étape publiée (les autres `cancelled`, aucun nouveau message) ; `stop` sans run en cours → 409 ; relancer puis `POST /api/admin/reset` → le run passe `stopped` et aucun message n'apparaît dans les 8 s suivantes.
- [x] CA5 — Vérification dans Chrome (orchestrateur) : dans `/admin`, la section scénario liste les deux scénarios ; « Lancer » sur `demo-express` affiche la progression qui passe d'« À venir » à « Publiée » sans recharger ; dans une autre fenêtre sur `/channels/incident-en-cours` (ou le canal ciblé), les cartes d'alerte / annonces arrivent au fil de l'eau ; « Arrêter » sur un second lancement fige la liste avec des étapes « Annulée » ; aucune erreur console ; pas de défilement horizontal à 375 px.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10132 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; F='x-facilitator-code: animateur'; B=localhost:10132/api
curl -s -o /dev/null -w '%{http_code}\n' $B/admin/scenarios                                               # 401
curl -s $B/admin/scenarios -H "$F"                                                                         # 2 scénarios, "run":null
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/scenarios/inconnu/start -H "$F"                  # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/scenarios/demo-express/start -H "$F"             # 201
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/scenarios/demo-express/start -H "$F"             # 409
curl -s $B/channels/incident-en-cours/messages; curl -s $B/channels/general/messages                      # 1re étape présente
sleep 8; curl -s $B/admin/scenarios -H "$F"                                                                # status finished, 3 published
curl -s -X POST $B/admin/scenarios/demo-express/start -H "$F" >/dev/null; curl -s -X POST $B/admin/scenarios/stop -H "$F"   # stopped
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/scenarios/stop -H "$F"                           # 409
curl -s -X POST $B/admin/scenarios/demo-express/start -H "$F" >/dev/null; curl -s -X POST $B/admin/reset -H "$F"
sleep 8; curl -s $B/admin/scenarios -H "$F"; curl -s $B/channels/incident-en-cours/messages                # stopped, aucun nouveau message
```
Compter les messages avant/après chaque `sleep` pour CA4, puis CA5 dans Chrome.

## Notes d'implémentation
- `server/utils/scenario-runner.ts` : fabrique `createScenarioRunner({ schedule, cancel, now, publish })` testable + instance par défaut (`setTimeout`/`clearTimeout`, `Date.now`, store) ; erreurs `ScenarioNotFoundError` (404), `ScenarioConflictError` (409).
- Types du scénario et de l'état dans `shared/types/` (réutilisés par `/admin`) ; libellés FR des statuts dans `shared/utils/`.
- `reset.post.ts` appelle `stopScenario()` (sans erreur si rien en cours) avant `clearMessages()`.
- Routes : `server/api/admin/scenarios/index.get.ts`, `[id]/start.post.ts`, `stop.post.ts` (attention à la collision `stop` / `[id]`).
- `/admin` : réutiliser le code animateur saisi et le motif `run(action)` ; polling arrêté au démontage et quand le run n'est plus `running`.
