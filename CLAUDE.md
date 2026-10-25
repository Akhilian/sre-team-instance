# sre-team-instance

Application full-stack Nuxt 4 (front `app/`, API `server/api/`), déployée sur Render comme Web Service Node via `render.yaml`. Le push sur `main` déclenche le déploiement.

## Commandes
- `npm run dev` : serveur de dev
- `npm run typecheck` : vérification TypeScript (TypeScript fixé en ~6.0, la 7 casse `vue-tsc`)
- `npm run build` puis `node .output/server/index.mjs` : build et démarrage comme sur Render

## Boucle de développement à trois agents

Pour toute tâche longue confiée par l'utilisateur, l'agent principal **orchestre** et délègue le travail aux sous-agents de `.claude/agents/`. Il n'implémente pas lui-même.

### Mise en route (une fois par tâche)
Écrire l'objectif de l'utilisateur dans `specs/GOAL.md` : son texte, puis les contraintes et la définition de « terminé ».

### Choisir le circuit
- **Circuit complet** (étapes 1 à 4 ci-dessous) : nouvelle feature.
- **Circuit court** : ajustement d'une feature existante ou petit bug (quelques fichiers). Pas d'agent `feature-spec` : l'orchestrateur amende lui-même la spec d'origine (section « Évolution AAAA-MM-JJ », nouveaux critères non cochés) ou écrit une spec de bug de quelques lignes, puis enchaîne implémentation → vérification → clôture.
- Regrouper les petits retours de l'utilisateur dans une même boucle plutôt qu'une boucle par point.

### Une boucle
1. **Spec** : agent `feature-spec` (circuit complet seulement). Le prompt liste les fichiers utiles à lire, plutôt que tout le dépôt. Il produit `specs/NNN-<slug>.md`. S'il remonte une question bloquante, la poser à l'utilisateur avant de continuer.
2. **Implémentation** : agent `feature-implementer`, avec le chemin de la spec.
3. **Vérification** : agent `spec-verifier`, avec le chemin de la spec.
   - Les critères Chrome sont délégués à l'agent `chrome-checker` (spec, critères, URL de l'instance), après le redéploiement de l'instance si besoin. L'orchestrateur ne fait pas lui-même de contrôles Chrome ni de captures d'écran. Un FAIL compte comme un FAIL du vérificateur.
   - **FAIL** : relancer `feature-implementer` avec le rapport, puis `spec-verifier`. Au bout de 3 FAIL sur la même spec, arrêter et demander à l'utilisateur.
   - **PASS** : passer à l'étape 4.
4. **Clôture** : agent `loop-closer`, avec le numéro, le titre, les specs (et la section d'évolution), les éléments clés des rapports (livré, décisions, dette), le pied de commit et la consigne de redéploiement. Il coche les critères, ajoute et compacte l'entrée de `specs/PROGRESS.md` (format ci-dessous), commite, pousse sur `main` (deploy key via `core.sshCommand`) et renseigne le sha.
   - L'orchestrateur résume ensuite la boucle à l'utilisateur en 3 lignes, puis enchaîne la boucle suivante, sauf si l'objectif est atteint.

Après la clôture, `specs/` doit suffire pour reprendre le travail : objectif, état, décisions, prochaine étape. La conversation est compactée automatiquement tôt (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` dans `.claude/settings.json`) : après une compaction, repartir de `specs/GOAL.md`, `specs/PROGRESS.md` et de la prochaine étape notée dans PROGRESS. Pas besoin de demander `/clear` à l'utilisateur.

### Économie de tokens
- L'orchestrateur ne fait que router : spec, implémentation, vérification, Chrome et clôture sont délégués. Il ne lit pas le code ni les fichiers produits ; il peut tourner en Sonnet (`/model sonnet`) ; Opus pour les échanges de conception avec l'utilisateur.
- Prompts aux sous-agents courts et ciblés (spec, fichiers concernés, contraintes) ; ne pas recopier le contexte de la conversation.
- Ne pas relire un fichier que l'on vient de faire écrire par un sous-agent : son rapport suffit, le vérificateur fait le contrôle.

### Format d'une entrée de `specs/PROGRESS.md`
```markdown
## NNN — <titre> (YYYY-MM-DD, commit <sha court>)
- Livré : <1 à 2 lignes>
- Décisions : <choix techniques à respecter ensuite>
- Dette / suite : <ce qui reste, prochaine feature pressentie>
```

## Contrat d'agents
Lu par les agents partagés de `SRE/.claude/agents/` (lancés depuis `/Users/adrien/Desktop/projets/SRE`). Le circuit de la boucle est décrit dans `SRE/CLAUDE.md` ; les agents locaux de `.claude/agents/` restent en place jusqu'à la bascule.

- **Contrôles** (depuis la racine du dépôt) : `npm run typecheck`, `npm test`, `npm run test:http`, `npm run build` ; `npm ci` si `package.json` ou `package-lock.json` a changé. Build et démarrage doivent rester compatibles Render.
- **Démarrage pour le vérificateur** : `PORT=10123 node .output/server/index.mjs` (après `npm run build`), en arrière-plan ; l'arrêter à la fin.
- **Instance (Chrome)** : Colima `http://localhost:8088`, code animateur `demo-animateur` (`deploy/values-local.yaml`). Redéploiement, seulement sur demande : `npm run -s k8s:up:ollama 2>&1 | tail -1` (timeout long ; garder `:ollama`, sinon le PVC d'Ollama est supprimé).
- **Specs** : objectif `specs/GOAL.md`, avancement `specs/PROGRESS.md` (format ci-dessus, 3 dernières boucles détaillées), specs `specs/NNN-<slug>.md` (NNN sur 3 chiffres, propre à ce dépôt).
- **Git** : remote `origin` (`git@github.com:Akhilian/sre-team-instance.git`), branche `main`, `git add -A` dans ce dépôt, commit `git -c commit.gpgsign=false`, `git push origin main` ; la deploy key est déjà dans `core.sshCommand` local. Ne jamais réécrire l'historique ni forcer un push. Le push sur `main` déclenche le déploiement Render.
- **Contraintes** : `kubectl` limité aux namespaces `sre-teams` et `sre-teams-*` ; aucun déploiement sans demande ; secrets via variables d'environnement (README et `render.yaml` avec `sync: false`), jamais en dur ; TypeScript fixé en ~6.0.
- **Dépendances** : `workshop-platform` consomme l'image et les fiches de cette application ; faire la boucle de teams avant celle de platform.
