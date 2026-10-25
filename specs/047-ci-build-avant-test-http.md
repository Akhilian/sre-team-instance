# 047 — CI : build avant test:http (bug)
## Pourquoi
Sur GitHub Actions, `npm run test:http` échoue : `.output/server/index.mjs introuvable : lancez npm run build avant npm run test:http` (tests/http/server.ts:49), car `.github/workflows/ci.yml` lance `test:http` avant `build` (ordre repris de la liste des contrôles du contrat, qui n'impose pas d'ordre). Le `TypeError … reading 'stop'` de `tests/http/health.test.ts:14` n'est qu'une conséquence : l'`afterAll` appelle `stop` sur un serveur jamais démarré.
## Périmètre
- `.github/workflows/ci.yml` : exécuter `npm run build` avant `npm run test:http` (ordre : `npm ci`, `typecheck`, `test`, `build`, `test:http`).
- Contrat d'agents du `CLAUDE.md` et README (section CI/publication) : indiquer que `test:http` exige le build préalable.
- Tests HTTP : dans les `afterAll`/teardown qui appellent `stop`, ne rien faire si le serveur n'a pas démarré (au moins `tests/http/health.test.ts` ; généraliser si le motif est répété), pour qu'un échec de démarrage ne produise que l'erreur d'origine.
- Si un test de `test:http` s'est avéré instable (2 échecs vus puis passés en local pendant la spec 046), le signaler dans le rapport avec nom du test et message, sans le corriger ici.
## Hors périmètre
Mise à jour des versions d'actions (avertissements Node 20), image.yml, tout déploiement, lancement de workflow.
## Critères d'acceptation
- [x] CA1 — `ci.yml` est du YAML valide et ses étapes `run` sont dans l'ordre `npm ci`, `typecheck`, `test`, `build`, `test:http`.
- [x] CA2 — Depuis un clone propre du dépôt sans `.output`, la séquence exacte de `ci.yml` (`npm ci`, `typecheck`, `test`, `build`, `test:http`) passe en local.
- [x] CA3 — Un démarrage de serveur en échec (ex. `.output` absent) ne produit plus de `TypeError … 'stop'` : seule l'erreur d'origine remonte (vérifié en supprimant `.output` puis en lançant `npx vitest run --config vitest.http.config.ts tests/http/health.test.ts`, qui doit échouer sur « introuvable » seulement ; restaurer avec `npm run build`).
- [x] CA4 — CLAUDE.md et README mentionnent que `test:http` exige `npm run build` ; `npm run typecheck`, `npm test`, `npm run build`, `npm run test:http` passent.
## Vérification
Cloner le dépôt local dans un dossier temporaire et dérouler les commandes de `ci.yml` ; `grep -n "run:" .github/workflows/ci.yml`.
