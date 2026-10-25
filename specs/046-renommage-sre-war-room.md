# 046 — Renommage du produit en sre-war-room (teams)
## Pourquoi
Le produit (`sre-team-instance`, `sre-teams`, `paging`) devient `sre-war-room` (GOAL transverse « Renommage »). Teams est renommé d'abord ; platform puis docshare suivent dans des boucles ultérieures.
## Périmètre
- Nom produit : `package.json` et `package-lock.json` (`name` → `sre-war-room`, aux 3 endroits), `render.yaml` (`name`), titres README/CLAUDE.md, clés localStorage `sre-team-instance:*` (3 composables) → `sre-war-room:*`.
- Chart `deploy/chart` : `Chart.yaml` `name: war-room`, helper de labels (`_helpers.tpl` : `paging.*` → `war-room.*`) et tous les `include` des templates, `values.yaml`.
- `deploy/local.sh` : `NS=sre-war-room`, `RELEASE=sre-war-room`, image locale `sre-war-room:local`, commentaires ; ressources dérivées (`sre-war-room-redis`, `sre-war-room-personas`, `/etc/sre-war-room/personas`) ; scripts npm `k8s:*` et `scripts/` éventuels.
- Métriques : `server/utils/paging-metrics.ts` → `war-room-metrics.ts` (imports dans chat-store, chat-persistence, npc, anti-repeat, engines/index, plugin), noms `paging_*` → `war_room_*` (plugin, route `/metrics`, `tests/metrics.test.ts`, `tests/http/metrics.test.ts`).
- SLO : `observability/sloth/paging-*.yaml` (6) → `war-room-*.yaml` ; service, noms de SLO, alertes, requêtes PromQL sur `war_room_*` ; `tests/sloth-paging.test.ts` → `tests/sloth-war-room.test.ts`.
- Image : `.github/workflows/image.yml` (`IMAGE: sre-war-room`, publie `akhilian/sre-war-room`) ; README ; `CLAUDE.md` (contrat : namespaces `sre-war-room` et `sre-war-room-*`, chart `war-room`, SLO `war-room-*.yaml`, image ; l'URL du remote `origin` reste inchangée).
- README, docs, textes d'interface : remplacer « paging » désignant le produit/chart/métriques. Vocabulaire métier conservé : « mise en alerte », PNJ « lanceur d'alerte », et tout usage de « paging » au sens générique d'astreinte/page d'alerte (pas le nom du produit) ; chaque occurrence conservée est listée avec sa justification dans la section « Occurrences conservées » ajoutée en fin de cette spec par l'implémenteur.
- Une note « Renommage 2026-10-25 » au plus dans `specs/PROGRESS.md` ; rien d'autre ne change dans l'historique.
## Hors périmètre
- Historique des specs `001`–`045` et des entrées PROGRESS/GOAL existantes.
- Dossier local `workshop-teams`, dépôt GitHub, service Render, dépôt Docker Hub (actions utilisateur / étape finale).
- `workshop-platform` (dashboards, `environments/*/paging.yaml`, variables `PAGING_*`) et `workshop-docshare`.
- Tout déploiement, `kubectl`, workflow lancé ; changement de comportement fonctionnel.
## Critères d'acceptation
- [x] CA1 — `grep -rIi "paging\|sre-teams\|team-instance" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.nuxt --exclude-dir=.output .` ne renvoie, hors `specs/00[0-9]-*.md, specs/0[1-4][0-5]-*.md`, `specs/PROGRESS.md`, `specs/GOAL.md`, `specs/ROADMAP.md` et l'URL `git@github.com:Akhilian/sre-team-instance.git` de `CLAUDE.md`, que les occurrences listées dans « Occurrences conservées » de cette spec. (Écart accepté 2026-10-25 : glob élargi à `specs/006-009` historiques ; 3 occurrences « paging » conservées : README, `deploy/chart/values.yaml`, CLAUDE.md.)
- [x] CA2 — `npm run typecheck`, `npm test`, `npm run test:http` et `npm run build` passent (`npm ci` d'abord) ; `GET /metrics` n'expose aucune série `paging_*` et expose des séries `war_room_*`.
- [x] CA3 — `helm lint deploy/chart` passe et `helm template war-room deploy/chart -f deploy/values-local.yaml` rend sans erreur, sans chaîne `paging` ni `sre-teams`, avec `app.kubernetes.io/name: war-room` et un ServiceMonitor ciblant `war_room_*`.
- [x] CA4 — Les 6 fichiers `observability/sloth/war-room-*.yaml` existent, aucun `paging-*.yaml` ne subsiste, et la validation Sloth par docker (voir Vérification) réussit pour les 6.
- [x] CA5 — `deploy/local.sh`, `render.yaml` et `image.yml` ne contiennent que les noms `sre-war-room` (namespace, release, image locale, `akhilian/sre-war-room`) ; `bash -n deploy/local.sh` passe.
## Vérification
- Sloth : la commande docker déjà utilisée par `tests/sloth-paging.test.ts` (reprise dans `tests/sloth-war-room.test.ts`) ; l'exécuter sur chaque `war-room-*.yaml`.
- `npm run build && PORT=10123 node .output/server/index.mjs` puis `curl -s localhost:10123/metrics | grep -c paging_` (attendu 0) ; arrêter le serveur.
## Notes d'implémentation
- Renommer avec `git mv` ; régénérer `package-lock.json` via `npm install --package-lock-only` si besoin.
- Les métriques changent de nom : les tests existants sont adaptés, pas affaiblis.
- Les clés localStorage changent : acceptable (état d'onboarding réinitialisé), à mentionner dans PROGRESS.
- Pas de redéploiement ; platform devra suivre le nouveau nom d'image, de chart et de métriques.

## Occurrences conservées
- `README.md` (section SLO) : noms de fichiers `paging.json` et `paging-llm-compare.json`, dashboards de `workshop-platform` (hors périmètre, non renommés).
- `deploy/chart/values.yaml` : commentaire citant `environments/eks/paging.yaml`, fichier de `workshop-platform` (hors périmètre).
- `CLAUDE.md` : URL du remote `git@github.com:Akhilian/sre-team-instance.git` (dépôt GitHub inchangé).
