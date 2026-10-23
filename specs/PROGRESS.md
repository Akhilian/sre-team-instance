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

- 019 — PNJ fondations (9731773) : interfaces `NpcResponder` / `KnowledgeRetriever` (async) dans `shared/types/npc.ts`, fiches Markdown dans `server/npc/personas/panne-checkout/` (serverAssets, rebuild requis), registre de moteurs `server/npc/engines/`, `@Nom` → réponse en fil (`npc`, badge PNJ), activation `/admin` ou au lancement du scénario, garde-fous anti-boucle.

- 020 — Moteur `openai-compatible` (8ec45de) : `server/npc/engines/openai-compatible.ts` (fetch natif, `NPC_LLM_BASE_URL`/`MODEL`/`API_KEY`/`TIMEOUT_MS`), prompt pur `server/npc/prompt.ts` (personnalité obligatoire, règle anti-injection, 10 messages d'historique), repli `keywords` journalisé en une ligne, `scripts/fake-openai.mjs`.

- 021 — Lanceur d'alerte, Com et PSP (264cd43) : étape `npc-message`, Sarah Benali ouvre l'incident à t=0, fiches `communication.md` (Inès Garnier) et `psp.md` (Thomas Keller, « Paiemio », fictif), cause établie seulement en recoupant Release + PSP, moteur `keywords` : 2 déclencheurs ou `!spécifique`, tolérance de forme explicite.

- 022 — Conversations directes PNJ (f709359) : canaux `direct` `dm-<slug>--<npcId>` (`POST /api/direct`, listés via `?participant=`, écriture réservée au propriétaire), section « Conversations », frappe des PNJ via `presence-store`, budget séparé 120 réponses/min ; échelle 15 participants max.

- 023 — Finitions PNJ (5fa8791) : avis local quand on mentionne un PNJ coupé (`app/utils/npc-notice.ts`), bandeau en conversation directe, réactions/acquittements réservés au propriétaire (403), annonces [CTO] et grands comptes portées par Claire et Sarah ; seule [Animateur] reste.

## 024 — PNJ : moteur `anthropic` avec repli `keywords` (2026-10-24, commit b1db91e)
- Livré : `server/npc/engines/anthropic.ts` (fetch natif vers `{NPC_ANTHROPIC_BASE_URL ou https://api.anthropic.com}/v1/messages`, en-têtes `x-api-key` / `anthropic-version: 2023-06-01`, `NPC_ANTHROPIC_MODEL` défaut `claude-haiku-5-5`, `max_tokens` 300) ; `toAnthropicMessages` (fusion des rôles consécutifs, premier message `user`, « (Début de la conversation) » si le PNJ parle en premier) ; réutilise `buildNpcPrompt` (`system` en chaîne) ; même repli `keywords` et même délai (`NPC_LLM_TIMEOUT_MS`) ; `scripts/fake-anthropic.mjs` ; `render.yaml` (`ANTHROPIC_API_KEY`, `NPC_ANTHROPIC_MODEL` en `sync: false`) et README. Vérifié sur le build avec le faux serveur (alternance multi-auteurs, repli sur 401/429/529/500/délai/réseau, clé jamais exposée).
- Décisions : clé absente ou vide → `keywords` avec avertissement ; contrôle « pas de clé dans le dépôt » : `git grep 'sk-ant-' -- ':!specs'`.
- Dette / suite : jamais essayé contre un vrai modèle (LM Studio ou API) — à faire par l'utilisateur. Suites possibles : éditeur ou rechargement des fiches sans rebuild, second scénario avec ses PNJ.

## 025 — PNJ : fiches lues depuis un dossier et rechargées depuis `/admin` (2026-10-24, commit d90ac5a)
- Livré : `server/npc/persona-source.ts` (lecture de `NPC_PERSONAS_DIR` si défini, sinon fiches embarquées ; noms contrôlés, `realpath` confiné, liens sortants/FIFO refusés, 32 Ko par fiche, 50 fiches max) ; `GET /api/admin/npc-personas` et `POST …/reload` (code animateur ; rapport fiche par fiche, fiche en erreur → version précédente gardée, 422 si aucune fiche valide) ; `dispatcher.replacePersonas` ; section « Fiches » dans `/admin` (`<details>`/`<pre>`, sans `v-html`) et bouton « Recharger les fiches ». Vérifié par le vérificateur (traversées, liens, gros fichiers) et dans Chrome.
- Décisions : le chemin ne vient que de l'environnement ; après un démarrage en repli sur les fiches embarquées, restaurer le dossier demande un redémarrage ; `NPC_PERSONAS_DIR` en `sync: false` (utile sur Render seulement avec un disque persistant).
- Dette / suite : 026 — édition en ligne d'une fiche dans `/admin` (validation par le parseur, en mémoire, export .md), utile sur Render free ; second scénario avec ses PNJ.

## 026 — PNJ : édition en ligne d'une fiche dans `/admin` (2026-10-24, commit à renseigner)
- Livré : `server/npc/persona-overrides.ts` (couche de fiches modifiées, prioritaire sur la source, y compris après rechargement) ; `PUT /api/admin/npc-personas/edit` (validation par le parseur, 401/404/409/413/422, erreurs avec numéro de ligne) et `POST …/revert` ; dérogation de corps à 40 Ko pour cette seule route (16 Ko ailleurs, étendu à PUT/PATCH/DELETE) ; `/admin` : « Modifier », « Valider et appliquer », « Télécharger .md » (en édition), « Annuler », « Revenir à l'original », badge « Modifiée », avertissement « en mémoire ». Vérifié dans Chrome (erreur affichée, badge, téléchargement, retour à l'original, HTML affiché en texte brut sans exécution).
- Décisions : fiches modifiées en mémoire seulement (perdues au redémarrage, exporter le .md) ; validation partagée `checkPersonaFile` avec 025.
- Dette / suite : création d'une nouvelle fiche (PNJ) depuis `/admin` ; second scénario avec ses PNJ ; essai réel avec un modèle (LM Studio ou API).
