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

- 024 — Moteur `anthropic` (b1db91e) : `server/npc/engines/anthropic.ts` (fetch natif, `x-api-key`, `anthropic-version: 2023-06-01`, `NPC_ANTHROPIC_MODEL` défaut `claude-haiku-5-5`, `NPC_ANTHROPIC_BASE_URL`), `toAnthropicMessages` (alternance des rôles), même repli `keywords`, `scripts/fake-anthropic.mjs`.

- 025 — Fiches lues depuis un dossier (d90ac5a) : `server/npc/personas/<scénario>/*.md`, `NPC_PERSONAS_DIR`, rechargement depuis `/admin` (fiche invalide écartée, version précédente conservée).

- 026 — Édition en ligne d'une fiche dans `/admin` (ef0f9d6) : `PUT /api/admin/npc-personas/edit`, validation avant écriture, surcharge annulable (`revert`).

## 027 — PNJ : second scénario « Fuite de données clients » (2026-10-24, commit d45fe99)
- Livré : `server/scenarios/fuite-donnees.ts` (13 étapes sur 14 min : Yanis du SOC ouvre l'incident, alertes ACL publique et lectures anonymes, SMS d'hameçonnage côté support, journaliste, une seule consigne [Animateur]) ; 5 fiches dans `server/npc/personas/fuite-donnees/` (soc, dev-data, dpo, porte-parole, support-clients ; noms fictifs, IP de documentation RFC 5737) ; cause établie en recoupant SOC + Dev, décision (notification sous 72 h, information des personnes, conservation des journaux) avec DPO + Support ; seuls les PNJ du scénario lancé sont actifs et listés ; champ `npcScenarioId` (demo-express → panne-checkout) ; « Tout réinitialiser » ramène les PNJ au scénario initial (`resetScenario`). Un FAIL (demo-express après fuite-donnees gardait les mauvais PNJ ; questions naturelles bloquées) corrigé puis PASS ; vérifié dans Chrome.
- Décisions : ids de PNJ distincts entre scénarios (les ids de conversation directe ne contiennent pas le scénario) ; `initialScenarioId` = premier scénario de `SCENARIOS` ; un scénario sans fiches propres doit déclarer `npcScenarioId`.
- Dette / suite : `stop` laisse les PNJ du scénario arrêté actifs (seul le reset complet les change) ; conversations directes d'un ancien scénario encore listées. Suites possibles : création de fiche depuis `/admin`, essai réel avec un modèle, revue globale de la phase 2.

## 028 — Revue de la phase 2 (2026-10-24, rapport `specs/028-revue-phase2.md`)
- Dépendances inchangées depuis 015 (TS 7, ioredis 6, unstorage 2 écartés ; node-forge dev seulement). Deux points hauts (moteur anthropic incompatible avec l'API réelle, fil de PNJ sans réponse sans `@`) ; découpage 029 fiabilité, 030 cycle de vie scénario/PNJ, 031 console animateur.

## 029 — PNJ : fiabilité en atelier (2026-10-24, commit 2d80403)
- Livré : moteur `anthropic` sans `temperature`/`top_p`/`top_k`, `output_config.effort: "low"`, `max_tokens` 1024, texte lu par blocs `type: "text"`, `max_tokens` sans texte et `refusal` → repli keywords journalisé ; faux serveur strict (400 sur sampling, modes `thinking`/`max_tokens`/`refusal`, `POST /__mode`) ; `lastModelCall` dans `GET /api/admin/npcs` et `/admin` ; réponse en fil sans `@` → le PNJ auteur du dernier message du fil répond (jamais après un humain, ni si un humain est mentionné) ; au-delà du plafond, réponse fixe « Je suis sollicité… » une fois par minute/PNJ/canal ; `NPC_ENGINE` en `sync: false` ; ids de fiches dupliqués et noms > 50 caractères rejetés. PASS au premier passage, vérifié dans Chrome.
- Décisions : faits API Claude vérifiés dans la doc de référence (Haiku 5.5 refuse le sampling non par défaut, réflexion active par défaut comptée dans `max_tokens`) ; moteur toujours en `fetch` natif ; PNJ ne répondent jamais à un PNJ.
- Dette / suite : essai réel avec une clé Anthropic avant l'atelier ; au démarrage, deux fiches au même id sont toutes deux écartées (aucune version précédente) ; `lastModelCall` non remis à zéro par le reset. Prochaine : 030 cycle de vie scénario/PNJ.

## 030 — Cycle de vie scénario et PNJ (2026-10-24, commit à renseigner)
- Livré : `stop` coupe les PNJ par défaut (`disableNpcs: false` pour les garder, case « Couper aussi les PNJ » dans `/admin`) ; la démo laisse les PNJ coupés (`enableNpcs: false`) ; lancement sur un store non vide → 409 `messages-exist` sauf `existingMessages: 'clear' | 'keep'` (confirmation à trois boutons dans `/admin`), aucun refus n'efface rien ; conversation directe avec un PNJ inactif : bandeau « X n'est pas disponible pour le moment » et composeur désactivé ; « Effacer les messages » et `clear` suppriment les conversations directes ; `npcName` stocké dans `direct` ; fiches au même id : la première par chemin gagne ; reset complet remet `lastModelCall` à null. PASS au premier passage, vérifié dans Chrome.
- Décisions : ordre des contrôles au lancement 401 → 400 → 404 → 409 run → 409 messages, puis seulement effacement.
- Dette / suite : au rechargement, une nouvelle fiche plus tôt dans l'ordre des chemins peut évincer une fiche en service ; texte d'état vert sur le 409 ; test CA2 de `scenario-lifecycle` dépendant de l'ordre (le reset ne remet pas `run` à null). Prochaine : 031 console animateur (découpage d'`admin.vue`, vue des conversations PNJ, checklist d'avant séance). Essai réel avec une clé Anthropic avant l'atelier.
