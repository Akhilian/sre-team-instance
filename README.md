# sre-team-instance

Application full-stack [Nuxt 4](https://nuxt.com/docs) : front Vue et API dans le même dépôt.

## Structure

- `app/` : front façon Teams (pages dans `app/pages/` : `/` redirige vers le canal d'incident, `/channels/:id` affiche le fil avec rafraîchissement toutes les 3 s ; composants dans `app/components/`, nom d'affichage mémorisé dans le `localStorage`)
- `server/api/` : back-end (routes API Nitro, ex. `GET /api/health`, `GET /api/channels`, `GET|POST /api/channels/:id/messages`, `POST /api/channels/:id/messages/:messageId/reactions`, `POST /api/channels/:id/messages/:messageId/alert-status` (acquitter / résoudre une alerte), `POST /api/presence` (présence et frappe, en mémoire), `GET /api/npcs`, et pour l'animateur `GET|POST /api/admin/npcs`, `POST /api/admin/announcements`, `POST /api/admin/alerts`, `POST /api/admin/reset` et les scénarios `GET /api/admin/scenarios`, `POST /api/admin/scenarios/:id/start`, `POST /api/admin/scenarios/stop`)
- `server/utils/` : logique serveur (store en mémoire des canaux et messages, persistance de l'instantané, exécuteur de scénarios)
- `server/plugins/`, `server/middleware/` : branchement de la persistance (réhydratation au démarrage, attente avant les routes `/api/`)
- `server/scenarios/` : scénarios d'incident pré-écrits (un fichier TypeScript par scénario, déclaré dans `index.ts`)
- `server/npc/` : personnages non joueurs (fiches Markdown dans `personas/<scénario>/`, retriever, moteurs de réponse, orchestrateur)
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
| réponse d'un PNJ | 600 caractères | tronquée |
| PNJ qui répondent à un même message | 3 | mentions suivantes ignorées |
| réponses de PNJ par minute glissante | par canal : 6 par PNJ, 20 tous PNJ confondus ; 60 au total (appels au modèle) | le PNJ se tait, sans erreur |

## Personnages non joueurs (PNJ)

Le scénario `panne-checkout` est accompagné de 4 PNJ, qui détiennent chacun une part de l'information :
Sarah Benali (support client N1), Claire Dumont (CEO), Marc Lefort (CFO) et Julien Moreau (Release
Manager de l'équipe Paiements, seul à connaître le déploiement récent). Un participant les interroge
en les mentionnant (`@Julien Moreau quel déploiement récent ?`) : chaque PNJ mentionné répond dans le
fil du message après 1 à 2 s, avec le badge « PNJ ». Leurs noms sont réservés (un message signé d'un
nom de PNJ est refusé en 400), et ils ne répondent jamais à un autre PNJ, à une annonce ni à une alerte.

- **Activation** : lancer `panne-checkout` depuis `/admin` active ses PNJ ; l'interrupteur « PNJ actifs »
  de `/admin` (`POST /api/admin/npcs {enabled}`, code animateur) les coupe ou les rallume ; « Tout
  réinitialiser » les coupe. L'état est en mémoire seulement (PNJ coupés au redémarrage).
  `GET /api/npcs` (public) renvoie `{ enabled, npcs: [{ id, name, role }] }`.
- **Fiches** : un fichier Markdown par PNJ dans `server/npc/personas/<scénario>/<id>.md`, modifiable dans
  n'importe quel éditeur ; front-matter `clé: valeur` (`id`, `name`, `role`, `scenario`, `tone` = phrase
  d'ouverture du moteur `keywords`, `personality` = une phrase sur son caractère et son style, utilisée
  par les moteurs à modèle et obligatoire, `deflection` = réponse quand il n'a rien d'utile), puis les sections `## Sait`, `## Ignore`
  et `## Sur question précise` (puces `- [mots: rollback, v2.40.3] texte`, livrées seulement si la
  question contient l'un de ces mots). Les fiches sont embarquées au build : relancer `npm run build`
  après une modification. Une fiche invalide est écartée avec une erreur dans les logs.
- **Moteur** (`NPC_ENGINE`, défaut `keywords`) : `keywords` répond sans modèle, de façon déterministe, par
  la phrase de ton suivie des 2 extraits de la fiche les plus proches de la question (recouvrement de
  mots). `openai-compatible` interroge un modèle (voir « Brancher un modèle »). Une valeur inconnue
  retombe sur `keywords` avec un avertissement. Un autre fournisseur s'ajoute par un fichier d'adaptateur
  dans `server/npc/engines/` et une ligne dans `NPC_ENGINES`. `GET /api/health` indique le moteur
  effectivement en service (`npcEngine`), sans URL, modèle ni clé.
- **Délai** : `NPC_REPLY_DELAY_MS` fixe le délai avant réponse en millisecondes (défaut : tiré entre 1 et 2 s).
- **Reset** : « Effacer les messages » (`reset {scope:"messages"}`) annule les réponses de PNJ en attente, sans couper les PNJ.

### Brancher un modèle

Le moteur `openai-compatible` appelle `POST {NPC_LLM_BASE_URL}/chat/completions` depuis le serveur
(jamais depuis le navigateur), avec un prompt construit à partir de la fiche du PNJ, des extraits retenus
et de l'historique du fil. Réponses courtes (2 à 4 phrases, tronquées à 600 caractères).

| Variable | Rôle |
| --- | --- |
| `NPC_ENGINE` | `openai-compatible` |
| `NPC_LLM_BASE_URL` | URL de base de l'API, `/v1` compris (slash final toléré) |
| `NPC_LLM_MODEL` | nom du modèle tel que le serveur le connaît |
| `NPC_LLM_API_KEY` | facultative : envoyée en `Authorization: Bearer …` si elle est définie |
| `NPC_LLM_TIMEOUT_MS` | délai maximal d'un appel (défaut 8000, plafonné à 14000) |

- **Ollama** : `ollama pull <modèle>` (un petit modèle instruct qui parle français suffit), puis
  `NPC_LLM_BASE_URL=http://localhost:11434/v1` et `NPC_LLM_MODEL=<modèle>` ; pas de clé.
- **LM Studio** : charger un modèle et activer le serveur local (onglet Developer), puis
  `NPC_LLM_BASE_URL=http://localhost:1234/v1` et `NPC_LLM_MODEL=<identifiant du modèle>`.
- **Sans modèle sous la main** : `node scripts/fake-openai.mjs` lance un faux serveur sur
  `http://127.0.0.1:11999/v1` (port en argument ou `PORT`), qui répond « [faux modèle] … ».

Sans `NPC_LLM_BASE_URL` ou sans `NPC_LLM_MODEL`, le moteur `keywords` est utilisé, avec un avertissement.
Si le modèle fait défaut (réseau, statut d'erreur, délai, JSON invalide, réponse vide), le PNJ répond
avec `keywords` et les journaux contiennent une ligne `[npc] openai-compatible indisponible (…) : repli
keywords`, sans URL ni clé : l'atelier continue.

Sur Render, un modèle lancé sur votre poste (`localhost`) n'est pas joignable : il faut une URL publique
ou auto-hébergée (serveur Ollama/vLLM exposé, fournisseur compatible), saisie avec `NPC_LLM_MODEL` et
`NPC_LLM_API_KEY` dans **Environment** (déclarées en `sync: false` dans `render.yaml`).

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
