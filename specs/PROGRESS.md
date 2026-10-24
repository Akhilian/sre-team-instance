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

- 027 — Second scénario « Fuite de données clients » (d45fe99) : 13 étapes, 5 PNJ propres (soc, dev-data, dpo, porte-parole, support-clients), `npcScenarioId` (demo-express → panne-checkout), reset complet ramène les PNJ au scénario initial.
- 028 — Revue de la phase 2 : rapport `specs/028-revue-phase2.md`, lots 029/030/031.

- 029 — Fiabilité des PNJ (2d80403) : moteur anthropic sans sampling, `effort: low`, `max_tokens` 1024, texte par blocs, repli journalisé, `lastModelCall` ; réponse en fil sans `@` par le PNJ auteur du dernier message ; réponse fixe au-delà du plafond ; `NPC_ENGINE` en `sync: false`.

- 030 — Cycle de vie scénario et PNJ (5db150c) : `stop` coupe les PNJ, démo sans PNJ, 409 `messages-exist` sauf `existingMessages: clear|keep`, bandeau pour un PNJ inactif en conversation directe, reset complet remet `lastModelCall` à null.

- 031 — Kubernetes : image Docker et chart Helm (3a1946e) : Dockerfile `node:24-alpine` non root, chart `deploy/chart/` (app `replicas: 1` + `Recreate`, LoadBalancer 8088, Redis StatefulSet + PVC), `npm run k8s:up` / `k8s:down`, namespace `sre-teams` exclusivement.

- 032 — Kubernetes : fiches en ConfigMap, Ollama optionnel, NetworkPolicy (835e2a1) : `npm run k8s:up:ollama` (`qwen2.5:1.5b`), fiches rechargeables via « Recharger », NetworkPolicy appliquées par k3s ; `FACILITATOR_CODE` surchargeable au déploiement (fa6a081).

## 033 — Mentions par le prénom, autocomplétion, personnages non signalés (2026-10-24, commit 5b2e2de)
- Livré : bug 033, « @Claire » reconnu quand le prénom est non ambigu (nom complet prioritaire, ambigu → texte) ; évolutions amendées dans les specs d'origine : 005 (autocomplétion `@` dans le composeur et les réponses en fil, PNJ actifs + participants présents, 5 au plus, listbox ARIA, ↑↓/Entrée/Tab/Échap/clic, seul le PNJ de la conversation en direct), 019 (aucune mention « PNJ » visible côté participant, `/admin` la garde ; « bis » : un PNJ nommé en clair, mot entier, répond comme une mention). PASS au premier passage, vérifié dans Chrome sur l'instance Colima avec Ollama.
- Décisions : nouvelle règle de l'utilisateur, ajustement de feature → amender la spec d'origine (section « Évolution » datée), bug → nouvelle spec ; priorité dans le dispatcher : @mentions → noms en clair → réponse implicite de fil ; une @mention d'une personne connue exclut les noms en clair.
- Dette / suite : ambiguïté d'un prénom en fil jugée sur les seuls auteurs du fil ; l'historique est lu à chaque message de canal ; une @mention d'une personne inconnue n'exclut pas les noms en clair ; le modèle local peut inventer le prénom de l'interlocuteur à partir de l'historique.

## 035 — PNJ : interventions spontanées, ton de collègue, auteur de la question (2026-10-24, commit 9bef121)
- Livré : feature 035, section de fiche `## Intervient spontanément` (`[mots: …]`, `[après: N min]`, `[sans point: N min]`), moteur pur `server/npc/spontaneous.ts` (tic 15 s, une fois par règle et par lancement, 4 min entre deux interventions d'un PNJ, 2/min au total, jamais en direct ni en réaction à un PNJ), règles dans 8 fiches (pas le Release Manager, le SOC ni dev-data), interrupteur « Interventions spontanées » dans `/admin` ; bug 034, auteur de la question transmis au modèle ; évolution de 020, ton de collègue (1 à 3 phrases, exemples de style) + `cleanModelOutput` (excuses et service client, préfixe de son propre nom, préambule méta, guillemets), lecture des 30 derniers messages du canal d'incident (`NPC_CHANNEL_CONTEXT_MAX`, prompt < 12 000 car.). Vérificateur PASS, puis deux FAIL en Chrome sur Colima avec `qwen2.5:1.5b` (préfixe de nom et consigne recopiée ; fuite de « 1 200 € par minute » en reformulation spontanée) corrigés et revérifiés sur l'instance.
- Décisions : la reformulation spontanée ne reçoit aucune connaissance de la fiche (ni Sait, ni Ignore, ni extraits) ; garde-fou déterministe : nombre absent du texte de base ou sortie > 2× sa longueur → texte de base publié ; tests reprennent les sorties réelles observées.
- Dette / suite : un modèle peut encore inventer un fait sans chiffre en reformulant ; une trace de consigne (« règles ») dans une reformulation légitime fait publier le texte de base ; interventions actives après la dernière étape jusqu'au `stop`. Prochaine : 036, panneau d'architecture dans `/admin` (demande de l'utilisateur).

## 036 — Panneau « Architecture » dans /admin (2026-10-24, commit 9069d72)
- Livré : `GET /api/admin/architecture` (code animateur, 401 sinon) construit par la fonction pure `buildArchitecture` (`server/utils/architecture.ts`, types `shared/types/architecture.ts`) : hébergement (`KUBERNETES_SERVICE_HOST` > `RENDER` > local), stockage et hôte, moteur PNJ, modèle, hôte et dernier appel, PNJ actifs, interventions spontanées, scénario et étape, source et nombre de fiches, 19 composants avec légende ; aucun secret (clés, mots de passe d'URL, code). Composant `AdminArchitecture.vue` : `<details>` fermé par défaut, chargé à l'ouverture, bouton « Actualiser », couches Hébergement / Navigateurs / Application Nuxt / Stockage · Moteur · Fiches, blocs actifs violets et inactifs grisés en tirets avec badge, une colonne sous 600 px, sans `v-html` ni dépendance. PASS au premier passage, vérifié dans Chrome sur Colima (Kubernetes, Redis, Ollama, fiches en dossier actifs).
- Décisions : couches et liens codés dans le composant, état fourni par la route ; `scenario-runner` actif seulement si `running`.
- Dette / suite : `fetch` refuse une `NPC_LLM_BASE_URL` avec identifiants (appel en échec, signalé dans `lastModelCall`).
