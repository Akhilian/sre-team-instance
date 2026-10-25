# 048 — Publication de l'image après la CI (workflows successifs)
## Pourquoi
Un push sur `main` lance deux workflows en parallèle : « CI » (`ci.yml`, déclencheur `push`) et « Publication » (`image.yml`, qui rappelle `ci.yml` en `workflow_call`). La CI tourne donc deux fois et la publication n'est pas visiblement conditionnée au run de CI du commit. Souhait de l'utilisateur : deux workflows **successifs** (CI puis publication).
## Périmètre
- `ci.yml` : déclencheurs `pull_request`, `push` sur `main`, `workflow_dispatch` ; retirer `workflow_call` s'il n'est plus utilisé ; étapes inchangées (`npm ci`, `typecheck`, `test`, `build`, `test:http`). Nom du workflow stable (« CI »).
- `image.yml` (« Publication de l'image » ; écart accepté 2026-10-25 : la spec disait « Publication ») : déclenché par `workflow_run` du workflow « CI » (`types: [completed]`, `branches: [main]`) ; job de publication conditionné à `github.event.workflow_run.conclusion == 'success'` et à `github.event.workflow_run.event == 'push'` ; plus de job `ci` ni d'`uses: ./.github/workflows/ci.yml` ; garder `workflow_dispatch` pour une publication manuelle (dans ce cas, pas de condition sur le run de CI) ; `actions/checkout` sur `github.event.workflow_run.head_sha` (ou le sha du dispatch) pour publier exactement le commit testé ; tags (sha complet de ce commit, version de `package.json`, `latest`) et secrets inchangés ; `permissions` minimales ; `concurrency` conservée.
- Filtre `paths` : le déclencheur `workflow_run` n'en a pas ; publier à chaque CI verte sur `main` (le cache buildx limite le coût). Le consigner dans le README.
- README et contrat d'agents du `CLAUDE.md` (CI et publication) : décrire l'enchaînement CI → Publication.
## Hors périmètre
Workflow de docshare (structure équivalente, à traiter séparément si souhaité), versions d'actions, déploiement, lancement de workflow depuis la session.
## Critères d'acceptation
- [x] CA1 — `ci.yml` et `image.yml` sont du YAML valide ; `ci.yml` n'a plus de `workflow_call` et conserve l'ordre `npm ci`, `typecheck`, `test`, `build`, `test:http`.
- [x] CA2 — `image.yml` : `on.workflow_run.workflows` vaut `["CI"]` (nom exact du workflow de `ci.yml`), `types: [completed]`, `branches: [main]` ; le job de publication a une condition `conclusion == 'success'` et `event == 'push'` (avec exception explicite pour `workflow_dispatch`), et ne contient plus de job `ci`.
- [x] CA3 — Le checkout du job de publication utilise le sha du run de CI (`github.event.workflow_run.head_sha`) et les tags s'appuient sur ce sha, pas sur `github.sha` du `workflow_run`.
- [x] CA4 — Aucun secret en dur ; `grep -rnE "dckr_|password: [^$]" .github` ne renvoie rien ; le seul secret est `secrets.DOCKERHUB_TOKEN`.
- [x] CA5 — README et CLAUDE.md décrivent l'enchaînement CI → Publication et la publication à chaque CI verte sur `main` ; typecheck, `npm test`, `npm run build`, `npm run test:http` passent.
## Vérification
Parse YAML (ruby ou actionlint si dispo), grep des conditions et du `head_sha`, lecture du diff. Le comportement réel ne se constate qu'au prochain push sur `main` (le noter dans le rapport).
