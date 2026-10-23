# 016 — Durcissement de l'API (limites, débit, code animateur, instantané)

## Pourquoi
Lot « 016 » du rapport `specs/015-revue-phase1.md` (H1, H2, H3, M3), à corriger avant la phase 2 : les PNJ vont écrire automatiquement dans le store, qui doit donc être borné. Aujourd'hui, une poignée de requêtes peut saturer l'instance free de 512 Mo, et le code animateur par défaut reste valable en production.

## Périmètre
- Module partagé `shared/utils/limits.ts`, qui regroupe tous les plafonds : corps 16 Ko, 2000 messages par canal, 30 canaux, 200 entrées de présence, 100 auteurs par réaction, débit d'écriture de 120 requêtes par 10 s et par IP. `TEXT_MAX_LENGTH`, `AUTHOR_MAX_LENGTH` et `CHANNEL_NAME_MAX_LENGTH` y sont déplacés, et le serveur les importe depuis ce module.
- H1 : middleware serveur pour tous les `POST /api/*`. Il renvoie **413** si `content-length` dépasse 16 384, ou si le corps arrive en `transfer-encoding: chunked` sans `content-length`. Le refus a lieu avant toute lecture du corps.
- H2, plafonds dans les stores :
  - au-delà de 2000 messages dans un canal, les plus anciens sont retirés (FIFO) ;
  - le 31e canal est refusé en 409 ;
  - `recordPresence` purge les entrées expirées, puis refuse un nouveau nom au-delà de 200 entrées (erreur traduite en 429) ;
  - au-delà de 100 auteurs, `toggleReaction` refuse un nouvel auteur (409).
- H2, limiteur de débit en mémoire, avec une fenêtre fixe par IP (`getRequestIP(event, { xForwardedFor: true })`, puisque Render passe par un proxy). Il s'applique aux `POST /api/*` sauf `/api/presence` (battement toutes les 3 s, borné par la purge) et `/api/admin/*`. Il répond **429** avec un en-tête `Retry-After`. Les compteurs expirés sont purgés.
- H3, résolution du code animateur au démarrage :
  - `FACILITATOR_CODE` défini et non vide : source `env` ;
  - sinon, en production : un code aléatoire lisible (10 caractères alphanumériques au minimum) est généré une fois par processus et écrit **une seule fois** dans les logs, sous la forme `Code animateur généré : <code> — définissez FACILITATOR_CODE`. Le code `animateur` est alors refusé (source `generated`) ;
  - hors production : `animateur` (source `default`).

  `/api/health` ajoute `facilitatorCode: "env" | "generated" | "default"` et n'expose jamais le code.
- M3 : `importSnapshot` valide les réactions (`emoji` présent dans `shared/utils/reactions.ts`, `authors` est un tableau de chaînes) et les alertes (sévérité et statut connus). Tout l'import est entouré d'un `try` qui renvoie `false`. Un instantané corrompu ne coupe plus la persistance.
- Premiers tests HTTP : `tests/http/*.test.ts`, lancés par un nouveau script `npm run test:http` (config Vitest dédiée). Chaque fichier lance `node .output/server/index.mjs` sur un port libre (`PORT`, `NITRO_PORT`), avec les variables d'environnement voulues, attend `/api/health`, puis interroge le serveur avec le `fetch` natif de Node. **Aucune dépendance ajoutée** : `@nuxt/test-utils` n'est pas installé, et Vitest suffit. `npm test` exclut `tests/http/`.

## Hors périmètre
- M1 (polling incrémental), M2 (reset des canaux et de la présence) et les points B1 à B11 : la reprise des limites côté front (B1) attend 018.
- Limiter le débit des routes admin, du scénario serveur ou des GET.
- Rendre les plafonds configurables par variable d'environnement.

## Critères d'acceptation
- [x] CA1 — Sur le build, `POST /api/channels/incident-en-cours/messages` avec un corps de 20 Ko renvoie 413, et le même message de taille normale renvoie 201. Test HTTP, et curl ci-dessous.
- [x] CA2 — Sur le build, 130 `POST /api/channels/<id>/messages` d'affilée depuis la même IP donnent des 201, puis au moins un 429 avec `Retry-After`. Pendant la rafale, `POST /api/presence` et `GET /api/channels` répondent toujours 2xx. Test HTTP.
- [x] CA3 — Tests unitaires du store :
  - après 2005 `addMessage` dans un canal, `listMessages` en renvoie 2000, et le plus ancien encore présent est le 6e ajouté ;
  - la création du 31e canal lève l'erreur traduite en 409 ;
  - après expiration des TTL, `recordPresence` purge les anciens noms, et le 201e nom distinct encore actif est refusé ;
  - le 101e auteur d'une réaction est refusé.
- [x] CA4 — Sur le build lancé avec `NODE_ENV=production` sans `FACILITATOR_CODE` :
  - `/api/health` renvoie `facilitatorCode: "generated"` et ne contient pas le code ;
  - stdout contient exactement une fois `Code animateur généré : <code>` ;
  - `POST /api/admin/reset` avec `x-facilitator-code: animateur` renvoie 401, et avec `<code>` lu dans les logs renvoie 200.

  Avec `FACILITATOR_CODE=secret`, health renvoie `"env"` et `secret` donne 200. Test HTTP.
- [x] CA5 — Le build lancé **sans** `NODE_ENV` (comme `startCommand` sur Render, qui ne définit pas forcément la variable) et sans `FACILITATOR_CODE` renvoie aussi `"generated"`. Les tests unitaires de `server/utils/facilitator.ts` (env injecté) couvrent les trois sources, et vérifient que `default` n'accepte `animateur` qu'hors production.
- [x] CA6 — Test unitaire : `importSnapshot` renvoie `false` sans lever d'exception, et sans modifier le store, pour une réaction sans `authors`, un emoji inconnu, une alerte de sévérité ou de statut inconnu. Après un tel rejet, une mutation déclenche toujours une sauvegarde (test sur `chat-persistence`).

## Vérification
```bash
npm test
npm run build && npm run test:http
# Contrôle manuel complémentaire
PORT=3999 NODE_ENV=production node .output/server/index.mjs > /tmp/srv.log 2>&1 &
sleep 2
curl -s localhost:3999/api/health
grep -c "Code animateur généré" /tmp/srv.log
head -c 20000 /dev/zero | tr '\0' 'a' | sed 's/.*/{"author":"x","text":"&"}/' \
  | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- \
    localhost:3999/api/channels/incident-en-cours/messages   # 413
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'x-facilitator-code: animateur' localhost:3999/api/admin/reset   # 401
kill %1
```

## Notes d'implémentation
- Production = `NODE_ENV === 'production'` **ou** serveur buildé (`!import.meta.dev`). Garder l'env et l'indicateur injectables pour les tests. N'ajoute pas `NODE_ENV` dans `render.yaml`, parce que `npm ci` ignorerait alors les devDependencies au build.
- Code généré : `crypto.getRandomValues` sur un alphabet sans caractères ambigus. Résolution mémorisée au premier appel, ou dans un plugin Nitro au démarrage pour journaliser une seule fois.
- Middlewares dans `server/middleware/` : la limite de corps et le débit passent **avant** `chat-hydration.ts`, en jouant sur l'ordre alphabétique des noms ou des préfixes numériques. Faire passer l'erreur de présence et celle de plafond des canaux par le mécanisme existant classe d'erreur → code HTTP.
- FIFO : vérifier que `app/utils/threads.ts` tolère une réponse dont le parent a été évincé (elle ne doit pas planter ; l'afficher en racine ou la masquer, au choix).
