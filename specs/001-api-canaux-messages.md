# 001 — API de canaux et messages en mémoire, avec tests

## Pourquoi
Le chat en canal (points 3 et 4 de specs/GOAL.md) repose sur un stockage serveur partagé par tous les navigateurs. Cette boucle pose cette brique côté API, avec un canal d'incident pré-créé, et installe l'outillage de test minimal dont les boucles suivantes auront besoin.

## Périmètre
- Mise en place de Vitest : dépendance de dev et script `npm run test` (exécution unique, non interactive).
- Store en mémoire côté serveur (module TypeScript pur, testable sans démarrer Nuxt) : liste de canaux pré-créés (au moins `general` et un canal dont l'id commence par `incident-`) et messages par canal.
- Routes API : `GET /api/channels`, `GET /api/channels/:id/messages`, `POST /api/channels/:id/messages`.
- Message renvoyé : `{ id, channelId, author, text, createdAt }` (`createdAt` en ISO 8601), messages listés par ordre chronologique croissant.
- Validation du POST : `author` (1 à 50 caractères après trim) et `text` (1 à 2000 caractères après trim) obligatoires.
- Tests unitaires du store (ajout, lecture, ordre, validation, canal inconnu).

## Hors périmètre
- Toute interface (la page d'accueil reste telle quelle).
- Temps réel (polling, SSE), paramètre `since`, pagination.
- Création de canal par un participant, fils, mentions, réactions.
- Persistance sur disque, tests end-to-end ou de composants Vue.

## Critères d'acceptation
- [x] CA1 — `npm run test` s'exécute sans mode watch, lance au moins 4 tests sur le store et sort avec le code 0.
- [x] CA2 — `GET /api/channels` répond 200 avec un tableau JSON d'objets `{ id, name }` contenant `general` et au moins un canal dont l'`id` commence par `incident-`.
- [x] CA3 — `POST /api/channels/general/messages` avec `{"author":"Alice","text":"Bonjour"}` répond 200 ou 201 avec le message créé (champs `id`, `channelId`, `author`, `text`, `createdAt`) ; un `GET /api/channels/general/messages` ultérieur le contient, après les messages plus anciens.
- [x] CA4 — `POST` avec `author` ou `text` absent, vide ou composé d'espaces répond 400 ; rien n'est ajouté au canal.
- [x] CA5 — `GET` ou `POST` sur `/api/channels/inconnu/messages` répond 404.
- [x] CA6 — `GET /api/health` répond toujours 200 et la page `/` répond toujours 200 sur le serveur buildé.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10123 node .output/server/index.mjs &   # arrêter à la fin
curl -s localhost:10123/api/channels
curl -s -X POST localhost:10123/api/channels/general/messages -H 'content-type: application/json' -d '{"author":"Alice","text":"Bonjour"}'
curl -s -X POST localhost:10123/api/channels/general/messages -H 'content-type: application/json' -d '{"author":"Bob","text":"Salut"}'
curl -s localhost:10123/api/channels/general/messages          # Alice puis Bob
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10123/api/channels/general/messages -H 'content-type: application/json' -d '{"author":"  ","text":"x"}'   # 400
curl -s -o /dev/null -w '%{http_code}\n' localhost:10123/api/channels/inconnu/messages   # 404
curl -s -o /dev/null -w '%{http_code}\n' localhost:10123/api/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:10123/   # 200
```

## Notes d'implémentation
- Store dans `server/utils/chat-store.ts` (fonctions pures + état module), tests dans `server/utils/chat-store.test.ts` ou `tests/` ; prévoir une fonction de réinitialisation pour isoler les tests.
- Routes : `server/api/channels/index.get.ts`, `server/api/channels/[id]/messages.get.ts`, `server/api/channels/[id]/messages.post.ts` ; erreurs via `createError({ statusCode })`.
- Vitest seul suffit (pas besoin de `@nuxt/test-utils`) : `"test": "vitest run"` ; exclure `.output/` et `.nuxt/` si nécessaire.
- Types partagés (`Channel`, `Message`) dans `shared/types/` pour que le front les réutilise à la boucle suivante.
- Une seule instance Render : l'état en mémoire est acceptable (cf. GOAL.md) ; `render.yaml` reste inchangé.
