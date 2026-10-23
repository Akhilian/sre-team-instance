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

## 013 — Chronologie de l'incident pour le post-mortem (2026-10-23, commit 4f1b4a6)
- Livré : `buildTimeline` / `timelineToMarkdown` dans `shared/utils/timeline.ts` (messages, réponses, annonces, alertes déclenchées / acquittées / résolues, triés ; tableau Markdown avec heure Europe/Paris et `|` échappé) ; `GET /api/admin/timeline?channelId=…&format=json|md` (code animateur ; 401 / 404 / 400 ; `.md` en pièce jointe `chronologie-<canal>.md`) ; section « Chronologie (post-mortem) » dans `/admin` (aperçu défilant, « Télécharger .md »). Dette 012 corrigée : bouton « Valider le code », plus de requêtes à chaque frappe. Vérifié dans Chrome (aperçu tous canaux / incident, 0 requête avant validation, 375 px sans débordement).
- Décisions : heure formatée avec `hourCycle: 'h23'` ; `format` contrôlé avant `channelId` ; `channelId` vide = tous les canaux.
- Dette / suite : toujours pas de test HTTP automatisé. Prochaine feature pressentie : persistance légère des messages (fichier) pour survivre à un redémarrage Render ; puis rôles d'incident, bandeau d'état SEV/statut.

## 014 — Persistance légère des conversations (2026-10-23, commit 12f1cc2)
- Livré : instantané unique `chat-snapshot` (canaux, messages, réactions, statuts d'alerte, `version: 1`) via unstorage ; driver choisi par `resolveStorageConfig` : `REDIS_URL` → redis (ioredis), sinon `CHAT_DATA_DIR` → fs, sinon memory (défaut, comportement inchangé) ; plugin Nitro (réhydratation, sauvegarde ≤ 300 ms après mutation, écriture forcée au `close`), middleware qui fait attendre les routes `/api/` (≤ 5 s) ; `/api/health` expose `storage` ; `REDIS_URL` en `sync: false` dans `render.yaml`. Vérifié sur le build : survie au redémarrage (fs), reset persisté, repli mémoire, Redis injoignable sans plantage.
- Décisions : aucune écriture (ni à l'arrêt) tant qu'aucune lecture n'a réussi, relecture toutes les 5 s ; à la reprise, instantané importé si le store n'a aucun message, sinon l'état local l'emporte (avertissement) ; une ligne de journal par panne Redis.
- Dette / suite : le disque Render free est éphémère, seul un Redis externe (Render Key Value free ou Upstash) protège vraiment ; CA6 (Redis réel) non vérifié faute de Docker. Suite : phase 1.5 (revue des dépendances et contrôle de bout en bout), puis phase 2 (PNJ).

## 016 — Durcissement de l'API (2026-10-23, commit à renseigner)
- Livré : rapport de revue `specs/015-revue-phase1.md` (dépendances à jour ; TS 7 casse toujours vue-tsc ; `npm audit` : node-forge, dev uniquement, sans correctif). Correctifs H1/H2/H3/M3 : corps ≤ 16 Ko (413, y compris chunked) ; plafonds centralisés dans `shared/utils/limits.ts` (2000 messages/canal en FIFO, 30 canaux, 200 présents, 100 auteurs/réaction) ; limiteur en mémoire 120 écritures/10 s par IP+auteur et 600/10 s par IP (429 + `Retry-After`), `/api/presence` exclu ; code animateur : `FACILITATOR_CODE`, sinon code généré au démarrage du build et écrit une fois dans les logs (`animateur` seulement sous `nuxt dev`), `/api/health.facilitatorCode` = env|generated|default ; validation stricte d'`importSnapshot` ; tests HTTP sur le build via `npm run test:http`. Vérifié dans Chrome (parcours normal, aucun 429).
- Décisions : IP client = dernière entrée de `x-forwarded-for` (posée par le proxy Render) ; le limiteur lit le corps après le contrôle de taille pour extraire l'auteur ; en local avec le build, lancer avec `FACILITATOR_CODE=animateur`.
- Dette / suite : `messageCount` plafonné à 2000 fige le calcul des non-lus (à traiter en 017) ; 017 — polling incrémental (et en pause si onglet caché) + reset complet ; 018 — ménage des points bas du rapport 015 ; puis phase 2 (PNJ).
