# 042 — Version dans /api/health
## Pourquoi
Pouvoir identifier la version déployée d'une instance depuis son health check (évolution 2026-10-25 de GOAL), sans toucher aux champs existants.
## Périmètre
- `GET /api/health` ajoute `version` : chaîne égale au champ `version` de `package.json`.
- `package.json` n'a aujourd'hui pas de champ `version` : l'ajouter à `"0.1.0"` (et la même valeur sur la racine de `package-lock.json`).
- Un test dans `tests/http/` (nouveau fichier `health.test.ts`).
## Hors périmètre
- Chrome, redéploiement, modification de `render.yaml` ou du chart Helm.
- Version dans `/metrics`, SHA git, date de build, mécanisme de bump automatique.
- Modification de `status`, `timestamp`, `storage`, `facilitatorCode`, `npcEngine`.
## Critères d'acceptation
- [ ] CA1 — `GET /api/health` sur le build renvoie 200 avec un champ `version` de type chaîne valant exactement `"0.1.0"`.
- [ ] CA2 — Les cinq champs existants (`status`, `timestamp`, `storage`, `facilitatorCode`, `npcEngine`) sont toujours présents avec les mêmes types et sémantique ; les tests HTTP existants sur `/api/health` passent sans modification.
- [ ] CA3 — `tests/http/health.test.ts` compare `version` à la valeur lue dans `package.json` (pas une constante recopiée) et vérifie les cinq champs existants.
- [ ] CA4 — La version est lue depuis `package.json` au build (pas de lecture de fichier à l'exécution) : `node .output/server/index.mjs` lancé depuis un autre répertoire renvoie la même `version`.
## Vérification
`npm run build && npm run test:http -- tests/http/health.test.ts` ; CA4 : `cd /tmp && PORT=10124 node <dépôt>/.output/server/index.mjs &` puis `curl -s localhost:10124/api/health`, arrêter le processus.
## Notes d'implémentation
- `server/api/health.get.ts` : `import pkg from '../../package.json'` (Nitro l'inline au build) ; vérifier `npm run typecheck` (resolveJsonModule).
- Compléter le commentaire d'en-tête du handler (version : celle de package.json).
