# 020 — PNJ : moteur `openai-compatible` avec repli `keywords`

## Pourquoi
La phase 2 (GOAL.md) demande des PNJ qui répondent avec leur personnalité, via un moteur interchangeable branché sur un modèle local ou auto-hébergé (Ollama, LM Studio…), sans jamais casser l'atelier si le modèle fait défaut. La boucle solde aussi la dette laissée par 019 (plafond global, trace de pile au reset).

## Périmètre
- `server/npc/engines/openai-compatible.ts` et une ligne dans `NPC_ENGINES`. L'adaptateur appelle `POST {NPC_LLM_BASE_URL}/chat/completions` avec `fetch` natif (pas de SDK), avec le modèle `NPC_LLM_MODEL`. L'en-tête `Authorization: Bearer <NPC_LLM_API_KEY>` n'est envoyé que si la clé est définie. Corps : `stream: false`, une température basse et un `max_tokens` court. Un slash final dans l'URL de base est toléré.
- Une fonction pure `buildNpcPrompt(request) → { role, content }[]` (dans `server/npc/prompt.ts`) construit :
  - **le message `system`**, à partir de la fiche : nom, rôle, ton, puces `Sait`, puces `Ignore`, puis les extraits du retriever. Viennent ensuite les règles : ne livrer une information précise que si la question la vise ; rester dans son rôle ; répondre en français, en 2 à 4 phrases ; ne jamais inventer de fait technique absent de la fiche ; si le PNJ ne sait pas, le dire ou orienter vers quelqu'un d'autre.
  - **l'historique** : les messages du PNJ deviennent des messages `assistant`, les autres des messages `user` préfixés de leur auteur (`Alice : …`).
  - **la question**, en dernier message `user`.
  - Les entrées `Sur question précise` **non retenues** par le retriever ne figurent jamais dans le prompt.
- Repli : erreur réseau, statut HTTP différent de 2xx, dépassement du délai `NPC_LLM_TIMEOUT_MS` (défaut 8000, sous le délai de 15 s du dispatcher), JSON invalide, ou `choices[0].message.content` absent ou vide après nettoyage. Dans tous ces cas, l'adaptateur renvoie la réponse du moteur `keywords` pour la même requête et journalise **une seule ligne**, `[npc] openai-compatible indisponible (<raison courte>) : repli keywords`, sans URL ni clé.
- Configuration :
  - `NPC_ENGINE=openai-compatible` sans `NPC_LLM_BASE_URL` ou sans `NPC_LLM_MODEL` : le moteur `keywords` est utilisé, avec un avertissement d'une ligne.
  - `render.yaml` déclare `NPC_LLM_BASE_URL`, `NPC_LLM_MODEL` et `NPC_LLM_API_KEY` en `sync: false`.
  - `/api/health.npcEngine` donne le moteur effectivement actif, sans URL, modèle ni clé.
  - Le README contient une section « Brancher un modèle » : Ollama (`http://localhost:11434/v1`, `ollama pull …`) et LM Studio (`http://localhost:1234/v1`, serveur local activé), avec les variables à définir et une remarque sur Render (un modèle local n'est pas joignable depuis Render : il faut une URL publique ou auto-hébergée).
- Dette 019 :
  - les plafonds de réponses deviennent **par canal** : 20/min tous PNJ confondus et 6/min par PNJ dans un même canal. Un plafond global de sécurité de 60 appels/min reste en place, pour borner les appels au modèle ;
  - `reset {scope:"messages"}` annule les réponses en attente, comme la coupure (méthode du dispatcher appelée par `reset.post.ts`) ;
  - le `onError` par défaut journalise une ligne (`[npc] réponse abandonnée : <message>`), sans trace de pile.

## Hors périmètre
- Adaptateur `anthropic`, streaming, embeddings, messages directs, lanceur d'alerte automatique, nouvelles fiches, réglage du moteur depuis `/admin`.

## Critères d'acceptation
- [x] CA1 — Vitest (`buildNpcPrompt`, pur) :
  - pour le Release Manager et « Quel déploiement récent ? », le `system` contient le nom, le rôle, au moins une puce `Sait`, une puce `Ignore`, l'extrait `v2.41.0` et les mots « français » et « 2 à 4 phrases » ;
  - pour « Bonjour, tu as des nouvelles ? », aucun message du prompt ne contient `v2.40.3` ;
  - l'historique garde l'ordre, les messages du PNJ sont en `assistant`, ceux des humains en `user` préfixés de l'auteur, et le dernier message est la question.
- [x] CA2 — Vitest (adaptateur, `fetch` simulé injecté) :
  - l'appel part en `POST` vers `<base>/chat/completions` (même si la base finit par `/`), avec `model` et `messages` ;
  - l'en-tête `Authorization: Bearer k` est présent si et seulement si la clé `k` est fournie ;
  - le `content` de la réponse est renvoyé, sans espaces en bord.
- [x] CA3 — Vitest (repli) : rejet réseau, statut 500, délai dépassé (horloge ou délai réduit), JSON invalide et `content` vide donnent tous la réponse exacte de `keywords` pour la même requête, avec un seul appel au logger, d'une ligne, sans l'URL ni la clé. `resolveNpcEngine` avec `NPC_ENGINE=openai-compatible` sans URL renvoie `keywords` et un avertissement.
- [x] CA4 — Vitest (dispatcher) :
  - 20 réponses dans le canal A dans la minute n'empêchent pas une réponse dans le canal B, alors que la 21ᵉ dans A ne répond pas ;
  - après l'annulation des réponses en attente (méthode appelée par `reset messages`), aucune publication ni appel à `onError` n'a lieu ;
  - le `onError` par défaut écrit une seule ligne.
- [x] CA5 — `npm run test:http` : le test lance un faux serveur OpenAI-compatible (`node:http`, port libre), puis démarre le build avec `NPC_ENGINE=openai-compatible` et `NPC_LLM_BASE_URL` pointé sur ce faux serveur.
  - `/api/health` renvoie `npcEngine: "openai-compatible"` et ne contient ni l'URL ni la clé ;
  - une mention du Release Manager fait apparaître en moins de 5 s le texte renvoyé par le faux serveur, dans le fil ; le faux serveur a reçu `Authorization: Bearer <clé de test>` ;
  - avec le faux serveur en erreur 500, la réponse est celle de `keywords` (elle contient `v2.41.0`) et les journaux contiennent la ligne de repli ;
  - un `reset {scope:"messages"}` envoyé pendant qu'une réponse est en attente : aucun message PNJ n'apparaît ensuite, et les journaux ne contiennent aucune ligne de trace de pile (`    at `).
- [x] CA6 — `render.yaml` déclare les trois variables `NPC_LLM_*` en `sync: false`. Le README documente Ollama et LM Studio.
- [x] CA7 — Chrome (orchestrateur), sur le build branché au faux serveur (`node scripts/fake-openai.mjs`) : dans `incident-en-cours`, `@Julien Moreau quel déploiement récent ?` affiche la réponse du faux serveur dans le fil, avec le badge « PNJ ». Une fois le faux serveur arrêté, une nouvelle mention reçoit la réponse `keywords`. Aucune erreur en console ni violation CSP.

## Vérification
```bash
npm test
npm run build && npm run test:http
node scripts/fake-openai.mjs &   # écoute sur 127.0.0.1:11999, répond « [faux modèle] … »
NPC_ENGINE=openai-compatible NPC_LLM_BASE_URL=http://127.0.0.1:11999/v1 NPC_LLM_MODEL=test NPC_LLM_API_KEY=secret \
  FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=200 node .output/server/index.mjs &
curl -s localhost:3000/api/health            # npcEngine: openai-compatible, ni URL ni "secret"
curl -s -X POST localhost:3000/api/admin/npcs -H 'content-type: application/json' -H 'x-facilitator-code: animateur' -d '{"enabled":true}'
curl -s -X POST localhost:3000/api/channels/incident-en-cours/messages -H 'content-type: application/json' -d '{"author":"Alice","text":"@Julien Moreau quel déploiement récent ?"}'
sleep 2; curl -s localhost:3000/api/channels/incident-en-cours/messages | grep -o 'faux modèle[^"]*'
grep -n 'NPC_LLM' render.yaml README.md
```

## Notes d'implémentation
- Fabrique `createOpenAiCompatibleResponder({ baseUrl, model, apiKey?, timeoutMs, fetch?, fallback, logger })` : `fetch` et le logger injectés pour les tests, `AbortSignal.timeout` pour le délai. Retirer les blocs `<think>…</think>` (modèles à raisonnement) avant le test « vide », puis tronquer à `NPC_REPLY_MAX_LENGTH`.
- `scripts/fake-openai.mjs` (port configurable par argument ou par `PORT`) : la même logique que le faux serveur de `tests/http` peut être partagée. Ajouter `NPC_LLM_*` et `NPC_LLM_TIMEOUT_MS` à la liste `CLEARED` de `tests/http/server.ts`, et capter stderr en plus de stdout pour les vérifications de journaux.
- Plafonds : clé `channelId` et `channelId:personaId` dans `takeRateSlot`. Ajouter `NPC_REPLIES_GLOBAL_PER_MINUTE = 60` à `shared/utils/limits.ts`. Exposer `cancelPending()` sur `NpcDispatcher`, avec un helper dans `server/utils/npc.ts`.
- La CSP n'est pas concernée : l'appel au modèle part du serveur.
