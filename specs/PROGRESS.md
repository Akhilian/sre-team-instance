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

- 033 — Mention par prénom (5b2e2de) : « @Claire » reconnu si le prénom est non ambigu parmi les PNJ actifs.

- 035 — PNJ : interventions spontanées, ton de collègue, auteur de la question (9bef121) : section `## Intervient spontanément`, moteur `server/npc/spontaneous.ts`, interrupteur dans `/admin`, `cleanModelOutput` ; la reformulation spontanée ne reçoit aucune connaissance de la fiche, nombre absent ou sortie > 2× → texte de base.

- 036 — Panneau « Architecture » dans /admin (9069d72) : `GET /api/admin/architecture` (`buildArchitecture`, sans secret), `AdminArchitecture.vue` (actif/inactif, état réel : hébergement, stockage, moteur, PNJ, scénario, fiches).

- 037 — Guide animateur par scénario (41668c5) : `docs/guide-animateur/*.md` en serverAsset `guides`, `GET /api/admin/guides/:scenarioId`, panneau repliable dans `/admin`, parseur Markdown maison `shared/utils/markdown-blocks.ts`, test de cohérence `tests/guides.test.ts` ; tout changement d'étape ou de fiche doit mettre le guide à jour.

- 038 — Onboarding des participants et rôles d'incident (48dec84) : parcours en 5 étapes rejouable, 5 rôles d'incident, rôle côté serveur (`role-store.ts`, `POST /api/roles`), section `/admin` « Participants et rôles ».

- 039 — Bug rôle écrasé ; évolutions 007 (`/admin` deux colonnes) et 038 (textes) (4db86ab) : `/admin` en deux colonnes ≥ 1100 px, choix de rôle local conservé tant que non confirmé (`role-sync.ts`), textes d'onboarding nuancés.

- 040 — Qualité et rythme des réponses des PNJ (ff8d7bc) : extrait de fiche dans le tour, anti-répétition, avis « pas dans ce scénario », rythme `NPC_PACE` (instantané|réaliste|occupé), Ollama `qwen2.5:3b` par défaut (7b rejeté sur Colima 10 Gi).

- 041 — Métriques Prometheus et SLI/SLO de l'app de paging (268d83b) : registre maison, `GET /metrics` (`METRICS_ENABLED`, false sur Render), métriques HTTP/messages/PNJ/Redis/`paging_npc_llm_*`, 6 SLO Sloth fenêtre 30 j ; dette : seuil débit à recalibrer sur qwen2.5:3b, double comptage d'issue possible.

- 042 — Version dans /api/health (eea7baf) : `version` lue depuis `package.json` (0.1.0), source de vérité pour `appVersion` côté platform.

- 043 — Chart paging : teams source de vérité (2453b2d) : `deploy/chart` aligné sur platform (metrics, ServiceMonitor, ConfigMap llm), scripts `k8s:up|down|personas` ; reste : retirer `charts/paging` côté platform.

- 044 — SLO Sloth du paging dans teams (5850e42) : 6 SLO `observability/sloth/`, test de cohérence avec les métriques ; dashboards restent dans platform.

- 045 — Publication de l'image sur Docker Hub (fa7ac5b) : `ci.yml` et `image.yml` (image multi-arch `akhilian/sre-teams`, tags sha/version/`latest`), secret `DOCKERHUB_TOKEN` à créer côté GitHub ; la plateforme doit épingler le tag.

- 046 — Renommage du produit en sre-war-room (1eb75b1) : produit, chart, image, métriques `war_room_*`, SLO renommés ; clés localStorage `sre-war-room:*` ; platform doit suivre.

- 047 — CI : build avant test:http (647e71f) : ordre `npm ci`, typecheck, test, build, test:http ; remote `origin` passé à `Akhilian/sre-war-room`.

- 048 — Publication de l'image après la CI (766d1c2) : `image.yml` déclenché par `workflow_run` du workflow « CI » (success sur `main`), `ci.yml` sans `workflow_call` ; enchaînement constaté au push suivant.

- 049 — Références au dossier workshop-war-room (c95f110) : `workshop-teams` remplacé par `workshop-war-room` (contrat, chart, ROADMAP) ; reste : renommer dépôt GitHub, service Render, dépôt Docker Hub.

- 050 — Chart : annotations et sources autorisées du Service (b399b5a) : `service.annotations` et `loadBalancerSourceRanges` rendus seulement si non vides ; README « Exposition sur EKS » ; TLS/Ingress absents.

## 051 — Cohérence collective des PNJ (2026-10-26, 7c0e70f)
- Livré : section « Ce que les autres PNJ ont déjà dit » (6 réponses pairs au plus), règle ne pas contredire/répéter (hors spontané), génération chaînée des cibles sans changer délais ni ordre de publication, anti-redite inter-PNJ (`isNearDuplicate` ≥ 0,8, issue `rejected_repeat`). PASS (CA1-6).
- Décisions : option A (historique brut borné, aucun appel LLM de plus) choisie par l'utilisateur ; `flush()` des tests passe de 5 à 50 ticks à cause du chaînage.
- Dette / suite : `respondTimeoutMs` est par PNJ, la chaîne cumule les délais si le LLM est lent.

## 052 — Alertes informatives (2026-10-26, 1543823)
- Livré : retrait des boutons Acquitter/Résoudre, du badge et du suivi de statut des alertes (route `alert-status` supprimée, chat-store, shared, chronologie) ; anciens états persistés tolérés ; références nettoyées (README, rate-limit, `limits.ts`, onboarding, guides animateur). PASS (CA1-6).
- Décisions : option A (suppression complète) choisie par l'utilisateur. Écart accepté : CA1 vérifié par analyse du template d'`AlertCard.vue` (pas d'outillage de test de composant).
- Dette / suite : aucune.

## 054 — Client DocShare et étape de scénario fault (2026-10-27, 18b303c)
- Livré : `server/utils/docshare-client.ts` (fetch injectable, timeout 3 s, erreurs génériques), `fault-state.ts` (registre singleton), étape `fault` et condition `when:{fault,active}` dans le runner (annulée si condition fausse, `failed` sans casser le scénario), stop/reset coupent les pannes activées, `DOCSHARE_BASE_URL` / `DOCSHARE_OPS_TOKEN` (README, `render.yaml` sync:false), `/admin` masque le canal des étapes fault. 663 tests, 104 HTTP, typecheck, build OK. PASS (CA1-6).
- Décisions : jeton prévu pour les futurs appels /ops, jamais renvoyé au navigateur ; pannes non persistées au redémarrage ; `getFaults` fourni mais non appelé.
- Dette / suite : `POST /admin/faults` de DocShare sans authentification (côté DocShare) ; tranche 2 du scénario « biais cognitifs » (actions ChatOps).
