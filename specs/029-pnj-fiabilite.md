# 029 — PNJ : fiabilité en atelier

## Pourquoi
Lot 1 du rapport `specs/028-revue-phase2.md` (H1, H2, M1, M7, B1) : sans ces corrections, le moteur `anthropic` bascule toujours sur `keywords`, et les participants croient les PNJ en panne (fil sans `@Nom`, plafond silencieux). Échelle de `specs/GOAL.md` : 15 participants, la performance n'est pas un enjeu.

## Périmètre
- **H1, moteur `anthropic`** (`server/npc/engines/anthropic.ts`, fetch natif, pas de SDK, décision de 024). Faits vérifiés dans la doc de l'API Claude, à appliquer tels quels :
  - Claude Haiku 5.5 (`claude-haiku-5-5`) renvoie 400 si `temperature`, `top_p` ou `top_k` ont une valeur autre que celle par défaut. Avec `anthropic-version: 2023-06-01`, seul `temperature: 1` passe ; avec `2026-10-21`, la simple présence de ces champs donne 400. Le moteur `anthropic` n'envoie donc plus ni `temperature`, ni `top_p`, ni `top_k`. Le moteur `openai-compatible` garde sa `temperature`.
  - La réflexion est active par défaut et compte dans `max_tokens`. Envoyer `output_config: { effort: "low" }` et `max_tokens: 1024`, sans désactiver la réflexion. Le texte est la concaténation des blocs `type === "text"`, les blocs `thinking` sont ignorés. Une réponse `stop_reason: "max_tokens"` sans texte, ou `stop_reason: "refusal"`, compte comme un échec : repli `keywords`, avec une ligne de journal qui donne la raison (`max_tokens sans texte`, `refus`).
  - On garde `anthropic-version: 2023-06-01`.
- **Faux serveur strict** (`scripts/fake-anthropic.mjs`). Il renvoie 400 (`invalid_request_error`) si le corps contient `temperature`, `top_p` ou `top_k`. Un réglage `state.mode` choisit la forme de la réponse : `text` (défaut), `thinking` (un bloc `{type:"thinking", thinking:"", signature:"…"}` avant le texte), `max_tokens` (bloc `thinking` seul, `stop_reason: "max_tokens"`) ou `refusal`.
- **Dernier appel au modèle.** `GET /api/admin/npcs` renvoie `lastModelCall: null | { at: ISO, ok: boolean, reason?: string }`, alimenté par les moteurs `anthropic` et `openai-compatible` (`null` en `keywords` ou avant tout appel). `/admin` l'affiche à côté du moteur : « dernier appel au modèle : réussi à HH:MM » ou « échec (raison) à HH:MM, repli mots-clés ».
- **H2, réponse implicite dans un fil** (`server/npc/dispatcher.ts`, canal d'équipe uniquement). Une réponse en fil (`parentId` présent) qui ne mentionne aucun PNJ et ne contient aucune mention `@…` reçoit une réponse du PNJ actif qui a écrit le dernier message du fil avant elle (message racine compris). Mêmes plafonds que pour une mention. Pas de boucle possible : un PNJ ne répond toujours pas à un message de PNJ. Si la réponse mentionne un PNJ, la règle actuelle s'applique (seuls les PNJ mentionnés répondent). Si elle contient une autre mention `@…`, elle s'adresse à un humain et aucun PNJ ne répond.
- **M1, plafond visible.** Quand un PNJ ne peut pas répondre faute de place dans le plafond (mention, réponse implicite ou conversation directe), il publie sans appeler le moteur une réponse fixe à l'endroit où il aurait répondu : « Je suis sollicité de toutes parts, je reviens vers vous dans une minute. » Cette réponse est publiée au plus une fois par minute pour un même PNJ dans un même canal. Au-delà, le silence reste la règle. Elle n'entre pas dans les budgets de réponses.
- **M7.** Dans `render.yaml`, `NPC_ENGINE` passe en `sync: false`. Le défaut `keywords` reste dans le code.
- **B1.** `checkPersonaFile` refuse un `id` déjà utilisé dans un autre scénario et un nom de plus de `AUTHOR_MAX_LENGTH` (50) caractères. Ces deux erreurs ont un message explicite et s'appliquent au chargement, au rechargement et à l'édition en ligne.

## Hors périmètre
- Cycle de vie scénario/PNJ (M2, M3, M5, B2) : boucle 030. Console animateur (M4, M6, B3 à B8, checklist) : boucle 031.
- Essai réel avec une clé Anthropic : il revient à l'utilisateur avant l'atelier, la boucle n'en dépend pas.
- Passage à `anthropic-version: 2026-10-21`, SDK Anthropic, désactivation de la réflexion.

## Critères d'acceptation
- [x] CA1 — Tests unitaires (`tests/npc-anthropic.test.ts`). Le corps envoyé ne contient ni `temperature`, ni `top_p`, ni `top_k`, et contient `max_tokens: 1024` et `output_config: { effort: "low" }`. Une réponse `[thinking, text]` donne le texte. Une réponse `max_tokens` sans texte, ou `refusal`, donne la réponse `keywords` et une seule ligne `warn` qui contient la raison, sans la clé.
- [x] CA2 — HTTP sur le build (`tests/http/npc-anthropic.test.ts`) avec le faux serveur strict. En mode `thinking`, la réponse du PNJ commence par `[faux Claude]` et `GET /api/admin/npcs` renvoie `lastModelCall.ok === true`. En mode `max_tokens`, la réponse vient de `keywords` et `lastModelCall` vaut `{ ok: false, reason: … }`. Un appel direct au faux serveur avec `temperature: 0.3` reçoit 400.
- [x] CA3 — Tests unitaires du dispatcher (H2). Dans le fil ouvert par le PNJ A, une réponse sans mention déclenche A, et A seul. Si le dernier message du fil vient d'un humain, il n'y a pas de réponse implicite. Une réponse qui contient `@Bob` (humain) ne déclenche rien. Une réponse qui mentionne `@B` déclenche B seul. Un message de PNJ dans le fil ne déclenche rien. Un message racine sans mention ne déclenche rien.
- [x] CA4 — Tests unitaires du dispatcher (M1). Après 6 réponses de A dans le canal en moins d'une minute, la 7e mention publie la réponse fixe sans appeler le moteur, et la 8e ne publie rien. Après 60 s, A répond de nouveau normalement. Le même comportement vaut en conversation directe.
- [x] CA5 — `tests/npc-persona-source.test.ts`. Une fiche `fuite-donnees/x.md` dont l'id existe déjà dans `panne-checkout` est rejetée, avec un message qui cite l'autre chemin. Une fiche dont le nom fait 51 caractères est rejetée. `PUT /api/admin/npc-personas/edit` renvoie 422 dans ces deux cas. `grep -A1 'key: NPC_ENGINE' render.yaml` affiche `sync: false`.
- [x] CA6 — Chrome (orchestrateur), build lancé avec `NPC_ENGINE=anthropic` et le faux serveur. Lancer `panne-checkout`, puis répondre dans le fil de Sarah sans `@` : Sarah répond `[faux Claude] …`. `/admin` affiche « dernier appel au modèle : réussi ». Passer le faux serveur en `max_tokens` et répondre de nouveau : la réponse vient des mots-clés et `/admin` affiche l'échec et sa raison.

## Vérification
```
npm test
npm run build && npm run test:http
grep -n -A1 'key: NPC_ENGINE' render.yaml
# CA6 : node scripts/fake-anthropic.mjs 11998 &
#       NPC_ENGINE=anthropic ANTHROPIC_API_KEY=x NPC_ANTHROPIC_BASE_URL=http://127.0.0.1:11998 FACILITATOR_CODE=animateur node .output/server/index.mjs
```

## Notes d'implémentation
- Faux serveur : pour changer `mode` en CA6, ajouter `POST /__mode {mode}` (route de test locale seulement) ou lire `FAKE_ANTHROPIC_MODE`.
- `lastModelCall` : une option `onOutcome({ok, reason})` dans les deux adaptateurs, branchée dans `server/utils/npc.ts`. Le dispatcher reste pur.
- H2 : `deps.history(message)` donne déjà les messages du fil. Prendre le dernier message avant la question et vérifier `npc?.id` parmi les PNJ actifs. Mentions `@…` humaines : détecter `@` suivi d'un caractère non blanc.
- Réponse fixe M1 : une constante dans `dispatcher.ts`, publiée par `deps.publish` (même `parentId` que la réponse normale), avec sa propre fenêtre par `channelId:personaId`.
