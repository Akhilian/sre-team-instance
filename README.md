# sre-team-instance

Application full-stack [Nuxt 4](https://nuxt.com/docs) : front Vue et API dans le même dépôt.

## Structure

- `app/` : front façon Teams (pages dans `app/pages/` : `/` redirige vers le canal d'incident, `/channels/:id` affiche le fil avec rafraîchissement toutes les 3 s ; composants dans `app/components/`, nom d'affichage mémorisé dans le `localStorage`)
- `server/api/` : back-end (routes API Nitro, ex. `GET /api/health`, `GET /api/channels`, `GET|POST /api/channels/:id/messages`, `POST /api/channels/:id/messages/:messageId/reactions`, `POST /api/channels/:id/messages/:messageId/alert-status` (acquitter / résoudre une alerte), `POST /api/presence` (présence et frappe, en mémoire), `GET /api/npcs`, `POST /api/direct` (conversation directe avec un PNJ), et pour l'animateur `GET|POST /api/admin/npcs`, `POST /api/admin/announcements`, `POST /api/admin/alerts`, `POST /api/admin/reset` et les scénarios `GET /api/admin/scenarios`, `POST /api/admin/scenarios/:id/start`, `POST /api/admin/scenarios/stop`)
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
`demo-express`, 6 s) : ses alertes, annonces et messages de PNJ (étapes `npc-message`, publiées même si
les PNJ sont coupés) sont publiés par le serveur au fil du temps, un seul
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
| canaux d'équipe (conversations directes exclues) | 30 | 409 |
| conversations directes participant ↔ PNJ | 300 | 409 |
| participants présents (noms actifs) | 200 | 429 |
| auteurs par réaction | 100 | 409 |
| réponse d'un PNJ | 600 caractères | tronquée |
| PNJ qui répondent à un même message | 3 | mentions suivantes ignorées |
| réponses de PNJ par minute glissante | par canal ou conversation : 6 par PNJ, 20 tous PNJ confondus ; 60 au total dans les canaux d'équipe, et un budget séparé de 120 pour les conversations directes (au plus 180 appels au modèle par minute) | le PNJ se tait, sans erreur |

## Personnages non joueurs (PNJ)

Le scénario `panne-checkout` est accompagné de 6 PNJ, qui détiennent chacun une part de l'information :
Sarah Benali (support client N1, lanceuse d'alerte : elle ouvre l'incident au lancement du scénario),
Claire Dumont (CEO), Marc Lefort (CFO), Inès Garnier (communication, agence externe), Thomas Keller
(prestataire de paiement fictif Paiemio) et Julien Moreau (Release Manager de l'équipe Paiements, seul
à connaître le déploiement récent). Aucune étape du scénario ne donne la cause : il faut recouper. Un participant les interroge
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
  et `## Sur question précise` (puces `- [mots: rollback, revenir, !v2.40.3] texte`, livrées seulement si
  la question contient au moins 2 de ces déclencheurs, ou un déclencheur spécifique préfixé de `!` ; une
  puce sans déclencheur spécifique et avec un seul déclencheur est refusée). Par défaut, les fiches sont embarquées au build : relancer `npm run build`
  après une modification. Une fiche invalide est écartée avec une erreur dans les logs. Pour les retoucher
  sans rebuild, voir « Fiches dans un dossier ».
- **Moteur** (`NPC_ENGINE`, défaut `keywords`) : `keywords` répond sans modèle, de façon déterministe, par
  la phrase de ton suivie des 2 extraits de la fiche les plus proches de la question (recouvrement de
  mots). `openai-compatible` interroge un modèle (voir « Brancher un modèle »), `anthropic` l'API Claude
  (voir « Moteur Anthropic »). Une valeur inconnue
  retombe sur `keywords` avec un avertissement. Un autre fournisseur s'ajoute par un fichier d'adaptateur
  dans `server/npc/engines/` et une ligne dans `NPC_ENGINES`. `GET /api/health` indique le moteur
  effectivement en service (`npcEngine`), sans URL, modèle ni clé.
- **Conversations directes** : la section « Conversations » de la barre latérale liste les PNJ actifs ;
  un clic ouvre une conversation 1:1 (`POST /api/direct {participant, npcId}` : 201 à la création, 200 si
  elle existe ; 400 nom invalide ou réservé, 404 PNJ hors du scénario courant, 409 PNJ coupés ou plafond).
  Id `dm-<slug du participant>--<npcId>` ; « Zoé » et « zoe » partagent la conversation. Le PNJ y répond à
  chaque message, sans mention. Pendant qu'un PNJ prépare une réponse (canal ou conversation), il apparaît
  « en train d'écrire » (`typing` de `POST /api/presence`). `GET /api/channels` ne liste que les canaux
  d'équipe ; `?participant=<nom>` y ajoute les conversations de ce participant. **Pas d'authentification
  réelle** : « privé » signifie seulement « non listé pour les autres » ; quiconque connaît l'URL peut lire
  la conversation. Seule l'écriture est gardée : un message, une réaction ou un acquittement d'alerte
  signé d'un autre nom que son propriétaire est refusé en 403 (nom vide ou invalide : 400). La chronologie de l'animateur les inclut ; « Tout réinitialiser » les supprime,
  « Effacer les messages » les vide. Le budget de réponses des conversations directes est séparé de celui
  des canaux d'équipe : une salle (une quinzaine de participants) qui interroge les PNJ en direct n'empêche
  pas les réponses dans `#incident-en-cours`.
- **PNJ coupés** : un message qui mentionne un PNJ, ou envoyé dans une conversation directe, affiche
  sous le fil un avis local « Les PNJ ne sont pas actifs pour le moment : … » (calculé dans le navigateur,
  ni envoyé ni stocké) ; une conversation directe affiche un bandeau « <nom> n'est pas disponible », et
  la barre latérale grise les conversations existantes. Tout disparaît dès que les PNJ sont réactivés.
- **Délai** : `NPC_REPLY_DELAY_MS` fixe le délai avant réponse en millisecondes (défaut : tiré entre 1 et 2 s).
- **Reset** : « Effacer les messages » (`reset {scope:"messages"}`) annule les réponses de PNJ en attente, sans couper les PNJ.

### Fiches dans un dossier (`NPC_PERSONAS_DIR`)

`NPC_PERSONAS_DIR` (facultative) désigne un dossier du serveur lu au démarrage à la place des fiches
embarquées, avec la même organisation : `<dossier>/<scénario>/<id>.md`, un seul niveau de sous-dossier
(par exemple une copie de `server/npc/personas`). Garde-fous : le chemin vient seulement de la variable
d'environnement ; noms de dossier et de fichier en `^[a-z0-9-]+$` (plus `.md`) ; un lien symbolique qui
sort du dossier est refusé ; 32 Ko au plus par fiche, 50 fiches au plus. Mêmes validations que les fiches
embarquées (parseur, id et scénario égaux au chemin, nom unique). Si le dossier est absent, illisible ou
sans fiche valide au démarrage, les fiches embarquées sont utilisées, avec un avertissement d'une ligne.

Dans `/admin`, la section « Personnages (PNJ) » indique la source et affiche chaque fiche en lecture
seule ; « Recharger les fiches » (`POST /api/admin/npc-personas/reload`, code animateur) relit la source
en service sans redémarrer : les fiches valides remplacent les fiches en cours, une fiche en erreur garde
sa version précédente (listée dans `kept`), une fiche supprimée disparaît ; sans aucune fiche valide, rien
n'est remplacé (422). L'état activé ou coupé des PNJ et le scénario courant sont conservés. `GET
/api/admin/npc-personas` renvoie la source et les fiches chargées avec leur texte.

Sur Render, le système de fichiers du service est effacé à chaque déploiement ou redémarrage : il faut un
**disque persistant** (Render Disk, offre payante) monté par exemple sur `/var/data`, avec
`NPC_PERSONAS_DIR=/var/data/personas`, saisie dans **Environment** (déclarée en `sync: false` dans
`render.yaml`). Sans disque, laisser la variable vide : les fiches embarquées sont utilisées.

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

### Moteur Anthropic

Le moteur `anthropic` appelle l'API Messages de Claude (`POST {NPC_ANTHROPIC_BASE_URL}/v1/messages`)
depuis le serveur, avec le `fetch` natif (sans SDK) et le même prompt que `openai-compatible` (fiche,
extraits retenus, historique du fil), converti au format Anthropic : consigne dans `system`, messages
alternés `user` / `assistant`. Réponses courtes (`max_tokens` 300, tronquées à 600 caractères).

| Variable | Rôle |
| --- | --- |
| `NPC_ENGINE` | `anthropic` |
| `ANTHROPIC_API_KEY` | clé d'API (secret, envoyée en `x-api-key`) ; absente ou vide : moteur `keywords` avec un avertissement |
| `NPC_ANTHROPIC_MODEL` | facultatif : modèle, `claude-haiku-5-5` par défaut |
| `NPC_ANTHROPIC_BASE_URL` | facultatif : `https://api.anthropic.com` par défaut, à surcharger seulement pour les tests (slash final toléré) |
| `NPC_LLM_TIMEOUT_MS` | délai maximal d'un appel, partagé avec `openai-compatible` (défaut 8000, plafonné à 14000) |

Si l'API fait défaut (réseau, statut d'erreur dont 401 ou 529, délai, JSON invalide, texte vide), le PNJ
répond avec `keywords` et les journaux contiennent une ligne `[npc] anthropic indisponible (…) : repli
keywords`, sans la clé ni le corps de l'erreur. Sur Render, saisir `ANTHROPIC_API_KEY` (et éventuellement
`NPC_ANTHROPIC_MODEL`) dans **Environment** (déclarées en `sync: false` dans `render.yaml`), puis
`NPC_ENGINE=anthropic`. Sans clé sous la main : `node scripts/fake-anthropic.mjs` lance un faux serveur
sur `http://127.0.0.1:11998` (port en argument ou `PORT`), à indiquer dans `NPC_ANTHROPIC_BASE_URL`.

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
