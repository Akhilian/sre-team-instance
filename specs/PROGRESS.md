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

- 017 — Polling incrémental (0298270) : curseur global `rev` (création ou modification de message), `GET …/messages?since=` → `{rev, full, messages}`, `totalCount` monotone pour les non-lus, instantané v2 (migration v1), pause si onglet caché, `reset {scope: messages|all}` et deux boutons dans `/admin`.

- 018 — Ménage et en-têtes de sécurité (24848c7) : CSP à nonce par requête sur le build, `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` (réimposés via `res.writeHead`, le `defaultHandler` d'erreur de Nitro les écrase), limites importées de `shared/utils/limits.ts`, `processEnv` unique. **Phase 1.5 terminée.**

## 019 — PNJ : fondations, moteur `keywords` et réponses aux mentions (2026-10-23, commit 9731773)
- Livré : interfaces dans `shared/types/npc.ts` (`NpcResponder.respond(NpcRequest): Promise<string>`, `KnowledgeRetriever.retrieve(persona, question): Promise<KnowledgeExcerpt[]>`) ; fiches Markdown à front-matter dans `server/npc/personas/panne-checkout/` (Sarah Benali Support N1, Claire Dumont CEO, Marc Lefort CFO, Julien Moreau Release Manager — seul à connaître v2.41.0), embarquées via `nitro.serverAssets` ; moteur `keywords` (registre `server/npc/engines/index.ts`, `NPC_ENGINE`) ; dispatcher : `@Nom` → réponse du PNJ en fil, `addNpcMessage` (champ `npc`, badge « PNJ ») ; activation par `/admin` (`npc-toggle`) ou au lancement du scénario, coupure au reset complet ; garde-fous (jamais de réponse à un PNJ ni à un message à `kind`, 3 PNJ max par message, 20 réponses/min, 600 caractères, délai max 15 s, noms de PNJ refusés comme auteur). Vérifié dans Chrome (réponse en fil avec badge, aucune erreur console).
- Décisions : `mentions.ts` déplacé dans `shared/utils/` ; ajouter un moteur = un fichier dans `server/npc/engines/` + une ligne au registre ; modifier une fiche impose un rebuild.
- Dette / suite : le plafond de 20 réponses/min est global à la salle (à passer par canal) ; `reset messages` pendant une réponse en attente journalise une trace complète (annuler les réponses en attente) ; le moteur `keywords` livre beaucoup d'un coup sur un mot comme « déploiement ». Suite : 020 — adaptateur `openai-compatible` (Ollama/LM Studio, `NPC_LLM_BASE_URL`, `NPC_LLM_MODEL`) ; puis lanceur d'alerte automatique, messages directs, adaptateur `anthropic`.

## 020 — PNJ : moteur `openai-compatible` avec repli `keywords` (2026-10-23, commit 8ec45de)
- Livré : `server/npc/engines/openai-compatible.ts` (fetch natif vers `{NPC_LLM_BASE_URL}/chat/completions`, `NPC_LLM_MODEL`, `NPC_LLM_API_KEY` Bearer optionnelle, `NPC_LLM_TIMEOUT_MS` 8 s par défaut, plafonné à 14 s, `<think>` retiré, 600 caractères) ; prompt construit par `server/npc/prompt.ts` (rôle, personnalité, sait/ignore, extraits, règles dont anti-injection, 10 derniers messages en historique) ; repli `keywords` sur toute erreur, journalisé en une ligne sans URL ni clé ; champ `personality` obligatoire dans les fiches ; dette 019 soldée (plafond 6 réponses/min par PNJ et par canal, 20 par canal, 60 global ; réponses en attente annulées par tout reset) ; `scripts/fake-openai.mjs` pour les tests ; README « Brancher un modèle » (Ollama, LM Studio). Vérifié dans Chrome avec le faux serveur, puis repli après son arrêt.
- Décisions : fabriques de moteur `(env, logger)`, configuration invalide → `keywords` avec avertissement ; `/api/health.npcEngine` sans URL ni clé.
- Dette / suite : pas encore essayé avec un vrai modèle local (LM Studio installé, serveur à démarrer par l'utilisateur). Suite : 021 — lanceur d'alerte automatique (Sarah Benali ouvre l'incident au lancement du scénario) et répartition pédagogique renforcée ; ensuite messages directs aux PNJ, adaptateur `anthropic`, PNJ supplémentaires (Com, fournisseur de paiement).

## 021 — PNJ : lanceur d'alerte, Communication et prestataire de paiement (2026-10-23, commit à renseigner)
- Livré : étape de scénario `npc-message` (PNJ résolu par `findNpc`, id inconnu → `failed`) ; Sarah Benali ouvre l'incident à t=0 (`panne-checkout` et `demo-express`) ; annonces Support/Direction/Com/Finance remplacées par des messages des PNJ ; fiches `communication.md` (Inès Garnier) et `psp.md` (Thomas Keller, prestataire fictif « Paiemio ») ; alerte de t=620 réduite à un indice neutre (« voir avec l'équipe Release ») ; cause (v2.41.0, pool de 10) établie seulement en recoupant Release + PSP ; moteur `keywords` : une entrée précise exige 2 déclencheurs distincts ou un déclencheur spécifique `!mot`, tolérance de forme explicite (`triggerWordMatches` : jusqu'à +3 lettres, −1 lettre). Parcours d'enquête simulé par le vérificateur (~40 questions) ; vérifié dans Chrome.
- Décisions : seuls les scénarios qui ont des fiches activent les PNJ au lancement (`demo-express` non) ; « qu'est-ce qui a changé ? » livre volontairement le changelog (`!changé`).
- Dette / suite : une mention à un PNJ désactivé reste muette (signaler « PNJ indisponible » ou un indicateur) ; plafond de 20 réponses/min par canal atteignable par une grande équipe ; annonces [CTO], [Service client grands comptes], [Animateur] encore scriptées. Suite pressentie : 022 — messages directs aux PNJ (conversation 1:1) et indicateur « en train d'écrire » des PNJ ; puis adaptateur `anthropic`, essai réel avec LM Studio.
