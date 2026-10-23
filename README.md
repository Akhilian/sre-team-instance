# sre-team-instance

Application full-stack [Nuxt 4](https://nuxt.com/docs) : front Vue et API dans le même dépôt.

## Structure

- `app/` : front façon Teams (pages dans `app/pages/` : `/` redirige vers le canal d'incident, `/channels/:id` affiche le fil avec rafraîchissement toutes les 3 s ; composants dans `app/components/`, nom d'affichage mémorisé dans le `localStorage`)
- `server/api/` : back-end (routes API Nitro, ex. `GET /api/health`, `GET /api/channels`, `GET|POST /api/channels/:id/messages`, `POST /api/channels/:id/messages/:messageId/reactions`, `POST /api/channels/:id/messages/:messageId/alert-status` (acquitter / résoudre une alerte), `POST /api/presence` (présence et frappe, en mémoire), et pour l'animateur `POST /api/admin/announcements`, `POST /api/admin/alerts`, `POST /api/admin/reset` et les scénarios `GET /api/admin/scenarios`, `POST /api/admin/scenarios/:id/start`, `POST /api/admin/scenarios/stop`)
- `server/utils/` : logique serveur (store en mémoire des canaux et messages, persistance de l'instantané, exécuteur de scénarios)
- `server/plugins/`, `server/middleware/` : branchement de la persistance (réhydratation au démarrage, attente avant les routes `/api/`)
- `server/scenarios/` : scénarios d'incident pré-écrits (un fichier TypeScript par scénario, déclaré dans `index.ts`)
- `shared/types/` : types partagés front / API
- `tests/` : tests unitaires Vitest ; `tests/http/` : tests HTTP contre le build (`npm run test:http`)
- `public/` : fichiers statiques

## Commandes

```bash
npm install         # installer les dépendances
npm run dev         # serveur de dev sur http://localhost:3000
npm run typecheck   # vérification TypeScript
npm run test        # tests unitaires (Vitest, exécution unique)
npm run test:http   # tests HTTP contre le build (lancer npm run build avant)
npm run build       # build de production dans .output/
node .output/server/index.mjs   # démarrer le build (port via PORT)
```

## Déploiement sur Render

Le fichier [`render.yaml`](./render.yaml) décrit un *Web Service* Node (Blueprint) :

- build : `npm ci && npm run build` (Node 24, via `NODE_VERSION`)
- démarrage : `node .output/server/index.mjs` (écoute sur le `PORT` fourni par Render)
- health check : `/api/health`

## Outils d'animateur

La page `/admin` (non liée dans la navigation) permet de publier une annonce ou une carte d'alerte (SEV1 à SEV3) dans un canal et de
réinitialiser les conversations (messages effacés, canaux conservés, scénario en cours arrêté).
Elle permet aussi de lancer un scénario d'incident pré-écrit (`panne-checkout`, ≈ 14 min, ou
`demo-express`, 6 s) : ses alertes et annonces sont publiées par le serveur au fil du temps, un seul
scénario à la fois, et l'exécution est perdue si le serveur redémarre. Les routes `/api/admin/*`
exigent l'en-tête `x-facilitator-code`, comparé au code animateur résolu au démarrage :

- `FACILITATOR_CODE` définie et non vide : sa valeur ;
- sinon, sur le serveur buildé (`node .output/server/index.mjs`, avec ou sans `NODE_ENV=production`) :
  un code aléatoire de 12 caractères, écrit une seule fois dans les logs
  (`Code animateur généré : <code> — définissez FACILITATOR_CODE`) et perdu au redémarrage ;
  `animateur` est alors refusé ;
- sinon (`npm run dev`) : `animateur`.

`GET /api/health` indique la provenance (`facilitatorCode` : `env`, `generated` ou `default`), jamais
le code. Sur Render, `FACILITATOR_CODE` est déclarée dans `render.yaml` avec `sync: false` : saisir sa
valeur dans le tableau de bord du service (**Environment**), sinon lire le code généré dans les logs.

## Limites de l'API

Plafonds fixes, regroupés dans `shared/utils/limits.ts` :

| Limite | Valeur | Au-delà |
| --- | --- | --- |
| corps d'un `POST /api/*` | 16 Ko (`content-length`) ; chunked sans `content-length` refusé | 413 |
| écritures (`POST /api/*` hors `/api/presence` et `/api/admin/*`) | par fenêtre de 10 s : 120 par IP et auteur, 600 par IP (40 participants derrière un même NAT) ; IP = dernière entrée de `x-forwarded-for` | 429 + `Retry-After` |
| messages par canal | 2000 | les plus anciens sont retirés |
| canaux | 30 | 409 |
| participants présents (noms actifs) | 200 | 429 |
| auteurs par réaction | 100 | 409 |

## Persistance des conversations

Canaux et messages (réactions et statut d'alerte compris) sont sauvegardés dans un instantané unique
(clé `chat-snapshot`), au plus 300 ms après chaque modification et à l'arrêt du serveur (SIGTERM),
puis rechargés au démarrage. Le stockage se choisit par variable d'environnement :

| Variable | Stockage | Usage |
| --- | --- | --- |
| `REDIS_URL` (prioritaire) | Redis externe (Render Key Value, Upstash…) | seul moyen de survivre à la mise en veille du plan `free` |
| `CHAT_DATA_DIR` | fichier dans ce dossier | local, ou plan Render avec disque persistant |
| aucune | mémoire (défaut) | tout est perdu au redémarrage |

`REDIS_URL` est déclarée dans `render.yaml` avec `sync: false` : la renseigner dans **Environment**
pour activer Redis. Le disque du plan `free` est éphémère (perdu à la mise en veille et au
redéploiement) : `CHAT_DATA_DIR` n'y protège rien. `GET /api/health` indique le stockage configuré
(`"storage": "memory" | "fs" | "redis"`). La présence, la frappe et les scénarios en cours restent en mémoire.

Pour créer le service : Render Dashboard → **New → Blueprint** → sélectionner ce dépôt GitHub.
Chaque push sur `main` déclenche ensuite un déploiement automatique.

> Le plan `free` met le service en veille après 15 min d'inactivité (réveil ≈ 1 min).
> Passer sur `starter` si l'API doit répondre rapidement à tout moment (ex. webhooks d'alerting).
