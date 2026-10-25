# 043 — Chart paging : teams source de vérité
## Pourquoi
`deploy/chart` doit devenir l'unique version du chart `paging` (GOAL « Évolution 2026-10-25 »). Il reprend les évolutions de `workshop-platform/charts/paging` (version, métriques, chart `llm`, sans Ollama) pour que la plateforme puisse retirer sa copie.
## Périmètre
- Aligner `deploy/chart/` sur `../workshop-platform/charts/paging` : `Chart.yaml`, `_helpers.tpl` (label `app.kubernetes.io/version` sur les ressources, absent des sélecteurs), `values.yaml` (`appVersion`, bloc `llm` avec `baseUrl`/`model`/`timeoutMs`, bloc `metrics`), `configmap.yaml` (moteur `openai-compatible` vers `llm.baseUrl` si `llm.enabled`), `templates/servicemonitor.yaml`, `networkpolicy.yaml` (Redis seulement).
- Retirer `templates/ollama.yaml`, le bloc `ollama` des values et la règle NetworkPolicy Ollama.
- Garder les défauts propres à teams (ex. `redis.storageClass: local-path` seulement si absent de `values-local.yaml` ne casse pas la compatibilité ; sinon l'aligner sur la plateforme, défaut `""`, et le porter dans `deploy/values-local.yaml`).
- Fiches PNJ : source unique `server/npc/personas` ; `deploy/chart/files/personas/` reste une copie gitignorée (non versionnée) produite par un script `npm run k8s:personas` (copie fraîche), appelé par `local.sh up`.
- `deploy/local.sh` : suppression de `--ollama` (usage `up|down`, timeout 3m, plus d'appel de chauffe) ; build de l'image, `rollout restart`, attente de `/api/health` conservés. `package.json` : retrait de `k8s:up:ollama`, ajout de `k8s:personas`.
- README (section Kubernetes local) et `## Contrat d'agents` du `CLAUDE.md` (commande de redéploiement `npm run -s k8s:up 2>&1 | tail -1`, plus de `:ollama`) mis à jour ; mention que le LLM vient du chart `llm` de la plateforme.
## Hors périmètre
- Toute modification de `workshop-platform` (retrait de sa copie, ses values) et de `workshop-docshare`.
- Déploiement, `kubectl`, `helm install` ; code applicatif ; `render.yaml`.
- Versionner une copie des fiches PNJ dans le chart ; sous-chart ou dépendance Helm vers `llm`.
## Critères d'acceptation
- [x] CA1 — `diff -r deploy/chart ../workshop-platform/charts/paging` ne montre aucune différence de fond hors `files/personas/` et hors défauts explicitement conservés (listés dans le rapport) ; `deploy/chart/templates/ollama.yaml` n'existe plus et `grep -ri ollama deploy/ package.json` ne renvoie rien (hors historique de specs).
- [x] CA2 — `helm lint deploy/chart -f ../workshop-platform/environments/local/paging.yaml -f ../workshop-platform/values/local.yaml --set-string facilitatorCode=x --set-string redis.password=x` réussit, ainsi que `helm template` avec ces mêmes arguments (et avec `deploy/values-local.yaml` seul) ; les namespaces rendus sont absents ou `sre-teams*`.
- [x] CA3 — Dans le rendu `helm template … --set metrics.enabled=true --set llm.enabled=true` : toutes les ressources portent `app.kubernetes.io/version` égal à `appVersion` ; aucun `matchLabels`/`selector`/`podSelector` ne contient `version` ; un ServiceMonitor cible le chemin `/metrics` ; la ConfigMap contient `NPC_ENGINE: openai-compatible` et l'URL `llm.baseUrl`.
- [x] CA4 — `appVersion` du chart égale le champ `version` de `package.json`.
- [x] CA5 — `bash deploy/local.sh bogus` et `bash deploy/local.sh up --ollama` affichent l'usage `up|down` et sortent en code non nul (le second sans lancer `docker build`) ; `npm run k8s:personas` produit `deploy/chart/files/personas/` identique (`diff -r`) à `server/npc/personas`, et ce dossier reste ignoré par git.
- [x] CA6 — README et contrat d'agents ne mentionnent plus `k8s:up:ollama` ni `--ollama`, et décrivent la commande de redéploiement et le LLM via `llm.baseUrl`.
## Vérification
`helm template` avec `--set metrics.enabled=true --set llm.enabled=true` puis grep des labels/sélecteurs ; `git -C . status --short --ignored deploy/chart/files`.
## Notes d'implémentation
Copier les templates de la plateforme (source de comparaison) puis réappliquer seulement les défauts teams voulus. Adapter `local.sh` : `--set llm.enabled` n'est pas requis (le chart `llm` est installé séparément par la plateforme). Aucune commande `kubectl`/`helm install`.

## Écarts acceptés 2026-10-25
- `redis.storageClass` vaut "" par défaut ; `local-path` est fixé dans `deploy/values-local.yaml`.
- Chart renommé `sre-teams` → `paging`.
- En local, `local.sh up` sans `llm.enabled` : PNJ en moteur keywords.
