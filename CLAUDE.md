# sre-war-room

Application full-stack Nuxt 4 (front `app/`, API `server/api/`), déployée sur Render comme Web Service Node via `render.yaml`. Le push sur `main` déclenche le déploiement.

## Commandes
- `npm run dev` : serveur de dev
- `npm run typecheck` : vérification TypeScript (TypeScript fixé en ~6.0, la 7 casse `vue-tsc`)
- `npm run build` puis `node .output/server/index.mjs` : build et démarrage comme sur Render

## Orchestration
L'orchestration et les agents (feature-spec, feature-implementer, spec-verifier, chrome-checker, loop-closer) vivent dans `/Users/adrien/Desktop/projets/SRE` : lancer `claude` depuis `SRE/` ; `SRE/CLAUDE.md` décrit le circuit. Lancé depuis `workshop-teams`, les agents ne sont pas disponibles.

## Format d'une entrée de `specs/PROGRESS.md`
```markdown
## NNN — <titre> (YYYY-MM-DD, commit <sha court>)
- Livré : <1 à 2 lignes>
- Décisions : <choix techniques à respecter ensuite>
- Dette / suite : <ce qui reste, prochaine feature pressentie>
```

## Contrat d'agents
Lu par les agents partagés de `SRE/.claude/agents/` (lancés depuis `/Users/adrien/Desktop/projets/SRE`). Le circuit de la boucle est décrit dans `SRE/CLAUDE.md`.

- **Contrôles** (depuis la racine du dépôt) : `npm run typecheck`, `npm test`, `npm run build`, `npm run test:http` (`test:http` exige `npm run build` préalable, dans cet ordre en CI) ; `npm ci` si `package.json` ou `package-lock.json` a changé. Build et démarrage doivent rester compatibles Render.
- **Démarrage pour le vérificateur** : `PORT=10123 node .output/server/index.mjs` (après `npm run build`), en arrière-plan ; l'arrêter à la fin.
- **Instance (Chrome)** : Colima `http://localhost:8088`, code animateur `demo-animateur` (`deploy/values-local.yaml`). Redéploiement, seulement sur demande : `npm run -s k8s:up 2>&1 | tail -1` (timeout long). Le LLM des PNJ vient du chart `llm` de `workshop-platform` via `llm.baseUrl` ; `deploy/chart` est la source de vérité du chart `war-room`.
- **Specs** : objectif `specs/GOAL.md`, avancement `specs/PROGRESS.md` (format ci-dessus, 3 dernières boucles détaillées), specs `specs/NNN-<slug>.md` (NNN sur 3 chiffres, propre à ce dépôt).
- **Git** : remote `origin` (`git@github.com:Akhilian/sre-war-room.git`), branche `main`, `git add -A` dans ce dépôt, commit `git -c commit.gpgsign=false`, `git push origin main` ; la deploy key est déjà dans `core.sshCommand` local. Ne jamais réécrire l'historique ni forcer un push. Le push sur `main` déclenche le déploiement Render.
- **Contraintes** : `kubectl` limité aux namespaces `sre-war-room` et `sre-war-room-*` ; aucun déploiement sans demande ; secrets via variables d'environnement (README et `render.yaml` avec `sync: false`), jamais en dur ; TypeScript fixé en ~6.0.
- **Reset d'instance** : `POST /api/admin/reset` (corps `{"scope":"messages"|"all"}`, en-tête `x-facilitator-code`) efface messages et état de test et arrête le scénario ; à lancer après tout test.
- **Réglages modifiables en test** : rythme des PNJ `NPC_PACE` (ou `/admin`), à remettre à sa valeur initiale.
- **SLO** : les 6 SLO Sloth de war-room vivent dans `observability/sloth/war-room-*.yaml` (validés par `tests/sloth-war-room.test.ts`) ; les dashboards du produit restent dans `workshop-platform`.
- **CI et publication** : `.github/workflows/ci.yml` (typecheck, tests, build, puis test:http qui exige le build) et `image.yml` (publie `akhilian/sre-war-room` sur Docker Hub avec le secret `DOCKERHUB_TOKEN`). `image.yml` s'enchaîne après la CI (`workflow_run` du workflow « CI », `main`) et publie à chaque CI verte sur `main` (commit `head_sha`, sans filtre de chemins) ; ne pas lancer le workflow depuis une session.
- **Dépendances** : `workshop-platform` consomme l'image et les fiches de cette application ; faire la boucle de teams avant celle de platform.
