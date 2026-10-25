# 045 — Publication de l'image sur Docker Hub
## Pourquoi
La plateforme consomme `akhilian/sre-teams` (`workshop-platform/environments/eks/paging.yaml`) mais teams n'a aucune CI ni publication. Voir GOAL « publication de l'image sur Docker Hub (akhilian) ».
## Périmètre
- `.github/workflows/ci.yml` : déclencheurs `pull_request`, `push` sur `main`, `workflow_call`, `workflow_dispatch` ; Node 24 (`actions/setup-node@v4`, cache npm) ; `npm ci` puis `npm run typecheck`, `npm test`, `npm run test:http`, `npm run build`.
- `.github/workflows/image.yml` calqué sur `workshop-docshare/.github/workflows/image.yml` : déclencheurs `push` sur `main` (paths : `app/**`, `server/**`, `shared/**`, `public/**`, `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `nuxt.config.*`, workflows ; ajuster à la structure réelle du dépôt) et `workflow_dispatch` ; job `ci` (`uses: ./.github/workflows/ci.yml`) puis job `publish` (`needs: ci`) : QEMU, Buildx, login Docker Hub (utilisateur `akhilian`, mot de passe `secrets.DOCKERHUB_TOKEN`), `docker/metadata-action` pour `docker.io/akhilian/sre-teams`, `build-push-action` `linux/amd64,linux/arm64`, cache gha.
- Tags : sha complet du commit (`type=sha,format=long,prefix=`), version lue dans `package.json` (ex. `0.1.0`, via une étape qui l'exporte, sans `v`), `latest`.
- README : section « Publication de l'image » (workflows, tags, secret `DOCKERHUB_TOKEN` jeton Docker Hub en écriture à créer dans Settings > Secrets du dépôt GitHub, déclenchement manuel). Contrat d'agents du `CLAUDE.md` : ligne sur la CI/publication (le push sur `main` publie aussi l'image ; ne pas lancer le workflow depuis une session).
- Vérifier sans modifier : le `Dockerfile` builde depuis le seul contexte du dépôt (pas de fichier ignoré requis par `.dockerignore`) ; consigner le résultat dans le rapport.
## Hors périmètre
- `render.yaml`, déploiement Render, `Dockerfile` et `.dockerignore` (sauf blocage avéré, à signaler plutôt que corriger).
- `deploy/chart` : `image.repository` y vaut `sre-teams` (et non `akhilian/sre-teams`) ; écart à signaler dans le rapport, sans changement (la plateforme le surcharge dans `environments/eks/paging.yaml`).
- Scan de vulnérabilités, signature d'image, création du secret, exécution du workflow, tout `kubectl`/déploiement.
## Critères d'acceptation
- [x] CA1 — `ci.yml` et `image.yml` sont du YAML valide (actionlint si installé, sinon parse YAML sans erreur) ; `ci.yml` contient `workflow_call` et exécute dans cet ordre `npm ci`, `typecheck`, `test`, `test:http`, `build`.
- [x] CA2 — `image.yml` : le job `publish` a `needs: ci`, cible `docker.io/akhilian/sre-teams`, `platforms: linux/amd64,linux/arm64`, et produit exactement les tags sha complet, version de `package.json` et `latest`.
- [x] CA3 — `grep -rnE "dckr_|password: [^$]" .github` ne renvoie rien : le seul secret référencé est `secrets.DOCKERHUB_TOKEN`.
- [x] CA4 — Le README contient la section de publication (mentions de `akhilian/sre-teams`, des trois tags et de `DOCKERHUB_TOKEN`) et le contrat d'agents du `CLAUDE.md` mentionne la CI et la publication.
- [x] CA5 — Si Docker est disponible : `docker build -t sre-teams:spec045 .` réussit depuis un clone propre (`git clone` local dans le scratchpad) ; sinon constat écrit dans le rapport. `git diff` ne touche ni `render.yaml`, ni `Dockerfile`, ni `deploy/`.
- [x] CA6 — `npm run typecheck`, `npm test`, `npm run test:http`, `npm run build` passent comme avant.
## Vérification
`python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` (si actionlint absent) ; `grep -n "akhilian/sre-teams" deploy/chart/values.yaml ../workshop-platform/environments/eks/paging.yaml` pour l'écart de chart.
## Notes d'implémentation
Ne pas pousser ni lancer le workflow. Le premier run réel exige que l'utilisateur crée `DOCKERHUB_TOKEN`. Le job `ci` de docshare est réutilisable via `workflow_call` : reproduire ce schéma.

Écart accepté 2026-10-25 : `docs/**` ajouté aux `paths` de `image.yml` (les guides animateur sont embarqués au build).
