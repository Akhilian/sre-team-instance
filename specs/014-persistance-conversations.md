# 014 — Persistance légère des conversations (fichier ou Redis, repli mémoire)

## Pourquoi
Sur le plan free de Render, le service s'endort après ~15 min d'inactivité et redémarre : avec le store en mémoire, une pause pendant l'atelier efface les canaux et les messages. GOAL.md prévoyait un stockage fichier ou clé-valeur « plus tard si utile ». C'est maintenant utile.

Évaluation honnête : le disque du plan free est éphémère. Il est perdu au redéploiement **et** à la mise en veille, donc un fichier JSON ne protège rien en production free. Il sert en local et sur un plan avec disque persistant. Seul un Redis externe (Render Key Value free, Upstash free…) protège réellement contre la mise en veille. Cette boucle livre donc un stockage dont le driver se choisit par variable d'environnement, avec repli mémoire. Le comportement en production ne change pas tant que rien n'est configuré.

## Périmètre
- Sélection du driver au démarrage : `REDIS_URL` défini → driver unstorage `redis` ; sinon `CHAT_DATA_DIR` défini → driver `fs` dans ce dossier ; sinon `memory` (comportement actuel).
- Ce qui est persisté : un instantané unique (clé `chat-snapshot`) qui contient les canaux et les messages, réactions et statut d'alerte compris. La présence, la frappe et les scénarios en cours restent en mémoire.
- Au démarrage : le store est réhydraté depuis l'instantané s'il existe et s'il est valide. Sinon, on garde l'état initial et on journalise un avertissement, sans planter.
- Après chaque mutation (message, annonce, alerte, statut d'alerte, réaction, création de canal, reset) : sauvegarde de l'instantané en différé (debounce ≤ 500 ms). Sauvegarde forcée à l'arrêt du serveur (hook `close` de Nitro / SIGTERM). Une erreur d'écriture est journalisée et ne fait pas échouer la requête.
- Les requêtes API attendent la fin de la réhydratation : aucune réponse n'est servie avec un store vide pendant le chargement.
- `GET /api/health` ajoute `storage: "memory" | "fs" | "redis"`.
- `render.yaml` déclare `REDIS_URL` en `sync: false` (optionnelle, vide par défaut).

## Hors périmètre
- Création du service Redis / Key Value sur Render ou Upstash (décision de l'utilisateur).
- Disque persistant Render (plan payant), base SQL, migrations de schéma au-delà d'un champ `version`.
- Persistance de la présence, des scénarios en cours ou du « dernier vu » (déjà côté client).
- Historique ou journal d'écriture : un seul instantané, le dernier écrit l'emporte.

## Critères d'acceptation
- [x] CA1 — Tests Vitest (`tests/chat-persistence.test.ts`) avec le driver unstorage `memory` : un instantané exporté après ajout d'un canal, de messages, d'une réaction et d'une alerte acquittée, puis réimporté après `resetChatStore()`, redonne les mêmes `listChannels()` et `listMessages()` (deep equal). Un instantané invalide (JSON non conforme, `version` inconnue) laisse l'état initial sans lever d'exception.
- [x] CA2 — Test Vitest de la sélection du driver : fonction pure `resolveStorageConfig(env)` → `{ driver: 'redis', url }` si `REDIS_URL`, `{ driver: 'fs', base }` si `CHAT_DATA_DIR` seul, `{ driver: 'memory' }` sinon (y compris valeurs vides) ; `REDIS_URL` prime sur `CHAT_DATA_DIR`.
- [x] CA3 — Fichier, survie à un redémarrage : avec le serveur buildé et `CHAT_DATA_DIR` défini, un canal créé et un message posté via curl sont toujours renvoyés par `GET /api/channels` et `GET /api/channels/<id>/messages` après arrêt (SIGTERM) puis relance du serveur ; `/api/health` renvoie `"storage":"fs"`.
- [x] CA4 — Repli mémoire : sans `REDIS_URL` ni `CHAT_DATA_DIR`, `/api/health` renvoie `"storage":"memory"`, et après redémarrage le message posté a disparu (comportement actuel inchangé, aucun fichier créé dans `.data/`).
- [x] CA5 — Reset persisté : avec `CHAT_DATA_DIR`, après `POST /api/admin/reset` (code animateur) puis redémarrage, les messages sont vides et les canaux créés par les participants sont toujours là (même sémantique que `clearMessages`).
- [ ] CA6 (non vérifiable : Docker absent ; redis injoignable testé) — Redis (si Docker est disponible) : avec `docker run -d --rm -p 6379:6379 --name chat-redis redis:7-alpine` et `REDIS_URL=redis://localhost:6379`, `/api/health` renvoie `"storage":"redis"` et un message survit au redémarrage du serveur. Si Docker ne tourne pas, le vérificateur le note : CA non vérifiable, pas FAIL.

## Vérification
```sh
npm test
npm run build
D=$(mktemp -d)
PORT=3014 CHAT_DATA_DIR=$D node .output/server/index.mjs & P=$!; sleep 2
curl -s localhost:3014/api/health                     # "storage":"fs"
curl -s -XPOST localhost:3014/api/channels -H 'content-type: application/json' -d '{"name":"Persist test"}'
curl -s -XPOST localhost:3014/api/channels/persist-test/messages -H 'content-type: application/json' -d '{"author":"Alice","text":"survit ?"}'
sleep 1; kill $P; wait $P
PORT=3014 CHAT_DATA_DIR=$D node .output/server/index.mjs & P=$!; sleep 2
curl -s localhost:3014/api/channels/persist-test/messages   # contient "survit ?"
curl -s -XPOST localhost:3014/api/admin/reset -H 'x-facilitator-code: animateur'
sleep 1; kill $P; wait $P
PORT=3014 CHAT_DATA_DIR=$D node .output/server/index.mjs & P=$!; sleep 2
curl -s localhost:3014/api/channels                   # persist-test présent, messageCount 0
kill $P
# CA4 : même scénario sans CHAT_DATA_DIR → "storage":"memory", message perdu après relance
# CA6 : même scénario avec REDIS_URL=redis://localhost:6379 (conteneur redis:7-alpine)
```

## Notes d'implémentation
- `chat-store.ts` reste pur et synchrone. On y ajoute `exportSnapshot()`, `importSnapshot(data): boolean` (validation minimale, `version: 1`) et `onChatChange(listener)`, appelé par chaque mutation, `clearMessages` compris.
- Nouveau module pur `server/utils/chat-persistence.ts` : `resolveStorageConfig`, `createStorage` d'`unstorage` avec les drivers `memory` / `fs` / `redis` (unstorage 1.17 est déjà installé ; ajouter `ioredis` en dépendance explicite, il n'est que transitif), `hydrate()`, `scheduleSave()`, `flush()`.
- Plugin Nitro `server/plugins/chat-persistence.ts` : lance `hydrate()`, branche `onChatChange` → `scheduleSave`, et `flush()` sur le hook `close`. Un middleware `server/middleware/` attend la promesse de réhydratation avant les routes `/api/`.
- `/api/health` doit répondre même si Redis est injoignable (le health check Render ne doit pas boucler) : il expose le driver configuré, pas l'état de la connexion.
