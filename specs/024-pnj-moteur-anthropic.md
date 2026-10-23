# 024 — PNJ : moteur `anthropic` avec repli `keywords`

## Pourquoi
La phase 2 (GOAL.md) prévoit trois moteurs interchangeables, dont `anthropic` (API Claude, clé optionnelle). Ajouter un fournisseur ne doit toucher qu'un fichier d'adaptateur : cette boucle le montre, sur le modèle du moteur `openai-compatible` (020).

## Périmètre
- `server/npc/engines/anthropic.ts` et une ligne dans `NPC_ENGINES` (`'anthropic'`). L'adaptateur appelle `POST {NPC_ANTHROPIC_BASE_URL}/v1/messages` avec le `fetch` natif, sans SDK. L'URL de base vaut `https://api.anthropic.com` par défaut ; on la surcharge seulement pour les tests, et un slash final est toléré.
  - En-têtes : `x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
  - Corps : `model` (`NPC_ANTHROPIC_MODEL`, `claude-haiku-5-5` par défaut), `max_tokens` court (300), `temperature` basse, `system` (chaîne) et `messages`.
- Prompt : on réutilise `buildNpcPrompt` sans dupliquer la logique. Le message `system` va dans le champ `system`. Le reste passe par une fonction pure `toAnthropicMessages`, qui fait trois choses :
  - elle fusionne les messages consécutifs du même rôle (contenus joints par une ligne vide) ;
  - si le premier message est `assistant`, elle le fait précéder d'un message `user` `(Début de la conversation)` ;
  - le dernier message reste la question, en `user`.
- Réponse : on concatène les `text` des blocs `content[]` de type `text`. Les blocs d'un autre type sont ignorés. Le texte est rogné puis tronqué à `NPC_REPLY_MAX_LENGTH`.
- Repli : erreur réseau, statut différent de 2xx, délai dépassé, JSON invalide ou texte vide. Dans tous ces cas, l'adaptateur renvoie la réponse de `keywords` pour la même requête et journalise une seule ligne : `[npc] anthropic indisponible (<raison courte>) : repli keywords`. Cette ligne ne contient ni la clé ni le corps de l'erreur. Le délai est celui d'`openai-compatible` : `NPC_LLM_TIMEOUT_MS`, 8 s par défaut, plafonné à 14 s.
- Configuration :
  - `NPC_ENGINE=anthropic` sans `ANTHROPIC_API_KEY`, ou avec une clé vide : le moteur `keywords` est utilisé, avec un avertissement d'une ligne qui nomme la variable manquante.
  - `/api/health.npcEngine` vaut `anthropic`, sans clé ni modèle.
  - `render.yaml` déclare `ANTHROPIC_API_KEY` et `NPC_ANTHROPIC_MODEL` en `sync: false`.
  - Le README ajoute une section « Moteur Anthropic » : les variables, le modèle par défaut et le repli.

## Hors périmètre
- SDK `@anthropic-ai/sdk`, streaming, prompt caching, outils, appel réel à l'API, changement de moteur depuis `/admin`, refonte d'`openai-compatible`.

## Critères d'acceptation
- [x] CA1 — Vitest (`toAnthropicMessages`, pur) :
  - un historique `user, user, assistant, assistant, user` puis la question donne une alternance stricte, dont le premier et le dernier message sont `user` ;
  - les contenus fusionnés gardent leur ordre ;
  - un historique qui commence par un message du PNJ est précédé d'un message `user` ;
  - aucun message n'a le rôle `system`.
- [x] CA2 — Vitest (adaptateur, `fetch` simulé injecté) :
  - l'appel part en `POST` vers `https://api.anthropic.com/v1/messages`, ou vers `<base>/v1/messages` si `NPC_ANTHROPIC_BASE_URL` est définie, même avec un slash final ;
  - il porte exactement les trois en-têtes attendus ;
  - le corps contient `model` (`claude-haiku-5-5` par défaut, ou la valeur de `NPC_ANTHROPIC_MODEL`), `max_tokens` ≤ 300, un `system` de type chaîne qui contient le nom du PNJ, et des `messages` alternés ;
  - une réponse `{content:[{type:"text",text:" A "},{type:"tool_use",…},{type:"text",text:"B"}]}` donne un texte qui contient `A` et `B`, sans espaces en bord.
- [x] CA3 — Vitest (repli) : un rejet réseau, un statut 401, un statut 529, un délai dépassé, un JSON invalide et un `content` vide ou sans bloc `text` donnent tous la réponse exacte de `keywords`. Le logger est appelé une seule fois, sur une ligne qui ne contient pas la clé. `resolveNpcEngine({NPC_ENGINE:"anthropic"})` sans clé renvoie `keywords` et un avertissement qui contient `ANTHROPIC_API_KEY`.
- [x] CA4 — `npm run test:http` : un faux serveur Anthropic (`node:http`, port libre) est lancé, puis le build avec `NPC_ENGINE=anthropic`, `ANTHROPIC_API_KEY=<clé de test>` et `NPC_ANTHROPIC_BASE_URL` pointé sur ce faux serveur.
  - `/api/health` renvoie `npcEngine: "anthropic"` et ne contient pas la clé ;
  - une mention du Release Manager fait apparaître le texte du faux serveur dans le fil en moins de 5 s ;
  - le faux serveur a reçu `x-api-key: <clé de test>` et `anthropic-version: 2023-06-01` ;
  - avec le faux serveur en erreur 500, la réponse contient `v2.41.0` (`keywords`), et les journaux contiennent la ligne de repli mais pas la clé.
- [x] CA5 — `render.yaml` déclare `ANTHROPIC_API_KEY` et `NPC_ANTHROPIC_MODEL` en `sync: false`. Le README contient la section « Moteur Anthropic ». `git grep -n 'sk-ant-'` ne renvoie rien.

## Vérification
```bash
npm test
npm run build && npm run test:http
grep -n 'ANTHROPIC' render.yaml README.md server/npc/engines/index.ts
git grep -n 'sk-ant-' || echo "aucune clé commitée"
```

## Notes d'implémentation
- La fabrique `createAnthropicResponder({ baseUrl, model, apiKey, timeoutMs, fetch?, fallback, logger })` et `anthropicFromEnv(env, logger)` suivent le modèle de `openai-compatible.ts`. Exporter `timeoutFromEnv` depuis ce fichier plutôt que de le recopier.
- `toAnthropicMessages(prompt: NpcPromptMessage[]) → { system, messages }` peut vivre dans `anthropic.ts`. `buildNpcPrompt` ne change pas, sauf s'il le faut vraiment.
- Dans `tests/http/server.ts`, ajouter `ANTHROPIC_API_KEY`, `NPC_ANTHROPIC_MODEL` et `NPC_ANTHROPIC_BASE_URL` à `CLEARED`. Le faux serveur peut s'inspirer de `tests/http/npc-openai.test.ts`.
- La CSP n'est pas concernée : l'appel part du serveur.
