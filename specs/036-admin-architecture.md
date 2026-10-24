# 036 — Panneau « Architecture » dans /admin

## Pourquoi
L'animateur (et l'équipe SRE) doit voir d'un coup d'œil comment l'instance est montée et ce qui tourne réellement : hébergement, stockage, moteur des PNJ, scénario. Demande de l'utilisateur, complément de la console animateur (phases 2 et 3 de `specs/GOAL.md`).

## Périmètre
- Fonction pure `buildArchitecture(env, state)` (`server/utils/architecture.ts`, types dans `shared/types/architecture.ts`) : à partir de l'environnement et d'un instantané (`npcAdminState()`, `getScenarioRun()`, source et nombre de fiches) renvoie un modèle sans secret :
  - `hosting` : `kubernetes` si `KUBERNETES_SERVICE_HOST`, sinon `render` si `RENDER`, sinon `local` ;
  - `storage` : `{ driver: memory|fs|redis, host? }` (Redis : hôte et port seuls, ni utilisateur ni mot de passe ; fs : pas de chemin requis) ;
  - `npcEngine` : `{ name, model?, host? }` (openai-compatible : `NPC_LLM_MODEL` et hôte de `NPC_LLM_BASE_URL` ; anthropic : `NPC_ANTHROPIC_MODEL` ou défaut, hôte de l'API ; keywords : ni modèle ni hôte) ; `lastModelCall` ;
  - `npcs` : activés ou non, noms des PNJ actifs, `scenarioId` des PNJ, `spontaneous` ;
  - `scenario` : `null` ou `{ id, title, status, step, totalSteps }` (étape = nombre d'étapes publiées) ;
  - `personas` : `{ source: embedded|directory, count }` ;
  - `components` : liste `{ id, label, legend, active }` (légende française d'une ligne) couvrant au moins : `participants`, `facilitator`, `nuxt-pages`, `api`, `scenario-runner`, `npc-dispatcher`, `spontaneous`, `persistence`, `storage-memory`, `storage-fs`, `storage-redis`, `engine-keywords`, `engine-openai`, `engine-anthropic`, `personas-embedded`, `personas-directory`, `hosting-render`, `hosting-kubernetes`, `hosting-local` ; et `links` : `{ from, to, label }` (ex. navigateurs → api « polling HTTP »).
- Route `GET /api/admin/architecture` protégée par `x-facilitator-code` (401 sinon), qui renvoie ce modèle.
- Composant `app/components/AdminArchitecture.vue`, inséré dans `admin.vue` comme section repliable `<details data-testid="architecture-panel">` fermée par défaut ; données chargées à l'ouverture, bouton « Actualiser ». Schéma en HTML/CSS (grille par couches : navigateurs → application Nuxt → stockage / moteur PNJ / fiches, cadre d'hébergement englobant), actif mis en évidence, inactif grisé (`data-active="true|false"` sur chaque bloc `data-component="<id>"`), libellé d'état (modèle, hôte, étape, nombre de fiches, dernier appel au modèle).

## Hors périmètre
- Rafraîchissement automatique, métriques (latence, mémoire, nombre de pods), test de connectivité réel vers Redis ou le modèle.
- Bibliothèque de diagrammes, script externe, `v-html`, modification de la CSP.
- Toute modification de `/api/health`.

## Critères d'acceptation
- [x] CA1 — Test unitaire `tests/architecture.test.ts` de `buildArchitecture` : hébergement (`KUBERNETES_SERVICE_HOST` → kubernetes, prioritaire sur `RENDER` ; `RENDER` → render ; rien → local) ; `REDIS_URL=redis://:s3cret@redis:6379` → `storage = { driver: 'redis', host: 'redis:6379' }`, `storage-redis` actif et `storage-memory`/`storage-fs` inactifs ; openai-compatible avec `NPC_LLM_BASE_URL=http://user:pw@ollama:11434/v1` → `host: 'ollama:11434'`, `engine-openai` actif ; keywords → ni `model` ni `host` ; scénario en cours → `step`/`totalSteps` corrects, `null` sans scénario ; chaque composant a une `legend` non vide.
- [x] CA2 — Même test : avec `ANTHROPIC_API_KEY=sk-ant-SECRET`, `NPC_LLM_API_KEY=llm-SECRET`, `FACILITATOR_CODE=code-SECRET`, les mots de passe ci-dessus, `JSON.stringify(buildArchitecture(...))` ne contient ni `SECRET`, ni `s3cret`, ni `pw@`, ni `user:`.
- [x] CA3 — Test HTTP `tests/http/architecture.test.ts` (serveur buildé, `REDIS_URL` non requis : `ANTHROPIC_API_KEY=sk-ant-SECRET`, `FACILITATOR_CODE` défini) : `GET /api/admin/architecture` sans code ou avec un mauvais code → 401 ; avec le code → 200, `hosting: 'local'`, `storage.driver: 'memory'`, `npcEngine.name: 'keywords'`, `personas.count` > 0, `components` contient les ids listés au périmètre ; le corps ne contient ni `SECRET` ni la valeur du code animateur.
- [x] CA4 — `tests/http/security-headers.test.ts` reste vert et `/admin` (SSR) contient `data-testid="architecture-panel"` ; aucun `v-html` dans `app/` (`grep -rn "v-html" app/` vide).
- [x] CA5 — (orchestrateur, Chrome) Sur l'instance Colima `http://localhost:8088/admin`, code `demo-animateur`, instance déployée avec `npm run k8s:up:ollama` : en ouvrant « Architecture », les blocs Kubernetes, Redis et openai-compatible (modèle `qwen2.5:1.5b`, hôte du service Ollama) sont mis en évidence, Render, mémoire, fichier, keywords et anthropic sont grisés, la source des fiches est « dossier » avec leur nombre ; après lancement d'un scénario puis « Actualiser », le scénario et son étape apparaissent ; aucune erreur CSP dans la console ; à 375 px de large, le schéma reste lisible sans défilement horizontal.

## Vérification
```
npm test -- tests/architecture.test.ts
npm run build && npm run test:http -- tests/http/architecture.test.ts tests/http/security-headers.test.ts
grep -rn "v-html" app/ ; echo "exit=$?"   # attendu : aucune ligne, exit=1
# CA5 (orchestrateur) : npm run k8s:up:ollama, puis Chrome sur http://localhost:8088/admin (code demo-animateur)
```

## Notes d'implémentation
- Réutiliser `resolveStorageConfig`, `npcEngineName()`, `npcAdminState()`, `npcPersonaFiles()` (source ; nombre = `personas.length`, sans renvoyer le Markdown), `getScenarioRun()` ; `processEnv()` dans la route, env injecté dans les tests.
- Réduire les URL avec `new URL(...).host` (try/catch → `undefined`) : jamais `href`, `username`, `password`, chemin ni requête.
- `admin.vue` fait 1 233 lignes : tout le rendu dans `AdminArchitecture.vue`, `admin.vue` ne fait que l'inclure et passer le code animateur.
- CSS dans le composant (`<style scoped>`, autorisé par `style-src 'unsafe-inline'`), palette existante, grille qui passe en une colonne sous 600 px ; inactif = opacité réduite + mention « inactif » (pas la couleur seule).
- Mettre à jour le README (section /admin) en une ou deux lignes.
