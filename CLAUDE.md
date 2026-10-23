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

### Une boucle
1. **Spec** : agent `feature-spec`. Il produit `specs/NNN-<slug>.md`. S'il remonte une question bloquante, la poser à l'utilisateur avant de continuer.
2. **Implémentation** : agent `feature-implementer`, avec le chemin de la spec.
3. **Vérification** : agent `spec-verifier`, avec le chemin de la spec.
   - **FAIL** : relancer `feature-implementer` avec le rapport, puis `spec-verifier`. Au bout de 3 FAIL sur la même spec, arrêter et demander à l'utilisateur.
   - **PASS** : passer à l'étape 4.
4. **Clôture** :
   - Cocher les critères dans la spec et ajouter une entrée à `specs/PROGRESS.md` (format ci-dessous).
   - Compacter `specs/PROGRESS.md` : garder les 3 dernières boucles en détail, résumer les plus anciennes en une ligne chacune.
   - `git add -A && git commit -m "NNN — <titre>"` puis `git push origin main`. Le push passe par la deploy key, configurée dans `core.sshCommand`.
   - Résumer la boucle à l'utilisateur en 3 lignes, puis enchaîner la boucle suivante, sauf si l'objectif est atteint.

Après la clôture, `specs/` doit suffire pour reprendre le travail : objectif, état, décisions, prochaine étape. Le contexte de la conversation peut alors être compacté (`/compact`) sans rien perdre.

### Format d'une entrée de `specs/PROGRESS.md`
```markdown
## NNN — <titre> (YYYY-MM-DD, commit <sha court>)
- Livré : <1 à 2 lignes>
- Décisions : <choix techniques à respecter ensuite>
- Dette / suite : <ce qui reste, prochaine feature pressentie>
```
