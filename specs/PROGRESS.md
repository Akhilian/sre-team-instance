# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

- 000 — Socle (00a9070) : Nuxt 4 + `GET /api/health`, déployé sur Render (Node 24, TypeScript ~6.0).

- 001 — API canaux/messages en mémoire + Vitest (8521ecb) : `server/utils/chat-store.ts`, routes `/api/channels[/:id/messages]`, types dans `shared/types/chat.ts`, tests dans `tests/`.

- 002 — Interface façon Teams + polling 3 s (74691a6) : page `/channels/[id]` SSR, composants dans `app/components/`, CSS maison `app/assets/css/main.css` (palette #464775 / #5b5fc7), nom d'affichage en `localStorage`.

- 003 — Création de canal + fil ancré en bas (dc253a4) : `POST /api/channels` (slug, 400/409), erreurs métier via classes d'erreur du store traduites en codes HTTP.

- 004 — Réponses en fil (beb180a) : `parentId` sur un seul niveau, `app/utils/threads.ts`, `ReplyComposer` inline.

- 005 — Mentions `@nom` + alignement à gauche (2cafbf1) : `app/utils/mentions.ts`, `MessageText.vue` sans `v-html`, mise en évidence « me » côté client uniquement.

- 006 — Réactions emoji (63616c6) : `POST …/messages/:messageId/reactions` en bascule, jeu de 6 emojis dans `shared/utils/reactions.ts`, `MessageReactions.vue`.

- 007 — Outils d'animateur (8024b26) : `/admin` non liée, `POST /api/admin/{announcements,reset}` protégés par `x-facilitator-code` = `FACILITATOR_CODE` (défaut `animateur`, **à saisir sur Render**, `sync: false`), annonces `kind: "announcement"` avec bandeau.

- 008 — Non-lus par canal (67d2e66) : `GET /api/channels` avec `messageCount`/`lastMessageAt`, `app/utils/unread.ts`, « dernier vu » en localStorage, pastille + titre « (N) », calcul client uniquement.

- 009 — Présence + « en train d'écrire » (0ca8480) : `server/utils/presence-store.ts` (horloge injectée, 15 s / 5 s), `POST /api/presence`, avatars empilés, `typingLabel` ; seul `typing:false` efface la frappe.

- 010 — Interface petit écran (683d4b8) : tiroir des canaux sous 768 px, barre 48 px, `vite.build.cssTarget` fixé, correctif survol réactions `.message:hover :deep(.reactions__add)`.

- 011 — Cartes d'alerte (e1dccbe) : `POST /api/admin/alerts` → `kind: "alert"` signé « Alerting », `POST …/alert-status` (acknowledged/resolved, 409), `AlertCard.vue`, règles dans `shared/utils/alerts.ts`.

- 012 — Scénario d'incident (a2d57e6) : `server/scenarios/` (`panne-checkout` 14 étapes, `demo-express`), `scenario-runner.ts` (planificateur/horloge injectables), routes `/api/admin/scenarios[/:id/start|/stop]`, un seul scénario à la fois, arrêté par reset.

- 013 — Chronologie post-mortem (4f1b4a6) : `shared/utils/timeline.ts` (`buildTimeline`, `timelineToMarkdown`, heure Europe/Paris), `GET /api/admin/timeline?channelId=&format=json|md`, section dans `/admin` ; bouton « Valider le code ».

- 014 — Persistance (12f1cc2) : instantané `chat-snapshot` via unstorage, driver `REDIS_URL` → redis, `CHAT_DATA_DIR` → fs, sinon memory ; aucune écriture tant qu'aucune lecture n'a réussi ; `/api/health.storage`. Seul un Redis externe protège vraiment sur Render free.

- 016 — Durcissement API (12537c6) : rapport `specs/015-revue-phase1.md` ; corps ≤ 16 Ko, plafonds dans `shared/utils/limits.ts`, limiteur 120/10 s par IP+auteur et 600/10 s par IP (`/api/presence` exclu, IP = dernière entrée de `x-forwarded-for`), code animateur généré en prod si `FACILITATOR_CODE` absent, `npm run test:http` sur le build.

## 017 — Polling incrémental, non-lus monotones et reset complet (2026-10-23, commit 0298270)
- Livré : curseur global `rev` (chaque création ou modification de message — réaction, statut d'alerte — reçoit un nouveau `rev`) et `GET …/messages?since=<rev>` → `{ rev, full, messages }` (`full` après reset/éviction/import ; sans `since` : tableau, compatible) ; `totalCount` par canal jamais décrémenté → non-lus justes au-delà de 2000 ; instantané v2 avec migration v1 ; front : `setTimeout` réarmé, pause si onglet caché et rattrapage immédiat au retour, backoff jusqu'à 30 s, 404 → `incident-en-cours`, plus de rechargement complet après envoi ; `POST /api/admin/reset {scope: "messages"|"all"}` (`all` : scénario arrêté, canaux par défaut, présence vidée) et deux boutons dans `/admin`. Vérifié dans Chrome (deltas vides au repos, 0 requête onglet caché, message affiché 60 ms après le retour, reset complet qui renvoie le participant vers `incident-en-cours`).
- Décisions : `mergeMessages` dans `app/utils/messages.ts` reçoit le plafond en paramètre (import de `shared/utils/limits` depuis `app/utils` cassait le build Nitro) ; curseur remis à 0 à chaque changement de canal.
- Dette / suite : 018 — ménage des points bas du rapport 015 (optionnel) ; puis phase 2 (PNJ) : interfaces `NpcResponder` / `KnowledgeRetriever`, repli `keywords`, adaptateur `openai-compatible` (Ollama).

## 018 — Ménage avant la phase 2 : en-têtes de sécurité, doublons, reprise de persistance (2026-10-23, commit 24848c7)
- Livré : CSP à nonce par requête sur le build (`server/plugins/security-headers.ts` ; `script-src 'self' 'nonce-…'`, `style-src 'unsafe-inline'` pour le CSS en ligne de Nuxt, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` sur toutes les réponses, erreurs comprises ; limites de longueur importées partout depuis `shared/utils/limits.ts` ; `processEnv` unique dans `server/utils/env.ts` ; un canal créé pendant une panne de lecture n'est plus écrasé à la reprise ; `/admin` recharge les canaux au retour du focus. Vérifié dans Chrome : aucune erreur CSP sur `/`, `/channels/…`, `/admin`, et parcours complet (fil, mention, réaction, acquittement, envoi, navigation).
- Décisions : en-têtes réimposés en enveloppant `res.writeHead` (le `defaultHandler` d'erreur de Nitro les écrase) ; alternative propre si besoin : `nitro.errorHandler` personnalisé ; CSP désactivée sous `nuxt dev` (HMR).
- Dette / suite : **phase 1.5 terminée** (dépendances à jour, `npm audit` : node-forge en dev seulement, sans correctif). Suite : phase 2 (PNJ) — interfaces `NpcResponder` / `KnowledgeRetriever`, repli `keywords`, adaptateur `openai-compatible` (Ollama), fiches de PNJ liées au scénario.

## 019 — PNJ : fondations, moteur `keywords` et réponses aux mentions (2026-10-23, commit à renseigner)
- Livré : interfaces dans `shared/types/npc.ts` (`NpcResponder.respond(NpcRequest): Promise<string>`, `KnowledgeRetriever.retrieve(persona, question): Promise<KnowledgeExcerpt[]>`) ; fiches Markdown à front-matter dans `server/npc/personas/panne-checkout/` (Sarah Benali Support N1, Claire Dumont CEO, Marc Lefort CFO, Julien Moreau Release Manager — seul à connaître v2.41.0), embarquées via `nitro.serverAssets` ; moteur `keywords` (registre `server/npc/engines/index.ts`, `NPC_ENGINE`) ; dispatcher : `@Nom` → réponse du PNJ en fil, `addNpcMessage` (champ `npc`, badge « PNJ ») ; activation par `/admin` (`npc-toggle`) ou au lancement du scénario, coupure au reset complet ; garde-fous (jamais de réponse à un PNJ ni à un message à `kind`, 3 PNJ max par message, 20 réponses/min, 600 caractères, délai max 15 s, noms de PNJ refusés comme auteur). Vérifié dans Chrome (réponse en fil avec badge, aucune erreur console).
- Décisions : `mentions.ts` déplacé dans `shared/utils/` ; ajouter un moteur = un fichier dans `server/npc/engines/` + une ligne au registre ; modifier une fiche impose un rebuild.
- Dette / suite : le plafond de 20 réponses/min est global à la salle (à passer par canal) ; `reset messages` pendant une réponse en attente journalise une trace complète (annuler les réponses en attente) ; le moteur `keywords` livre beaucoup d'un coup sur un mot comme « déploiement ». Suite : 020 — adaptateur `openai-compatible` (Ollama/LM Studio, `NPC_LLM_BASE_URL`, `NPC_LLM_MODEL`) ; puis lanceur d'alerte automatique, messages directs, adaptateur `anthropic`.
