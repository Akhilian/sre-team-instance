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

## 011 — Cartes d'alerte façon connecteur « Alerting » et acquittement (2026-10-23, commit e1dccbe)
- Livré : `POST /api/admin/alerts` (code animateur ; `severity` SEV1/2/3, `title`, `service`, `text`) → message `kind: "alert"` signé « Alerting » ; `POST /api/channels/:id/messages/:messageId/alert-status {name, status: acknowledged|resolved}` ouvert à tous (409 si transition impossible) ; `AlertCard.vue` (bande colorée par sévérité, badge de statut, « Acquittée par … à … », boutons Acquitter / Résoudre) ; formulaire « Publier une alerte » dans `/admin`. Vérifié dans Chrome (acquittement local, résolution par un autre participant synchronisée, rendu 375 px sans débordement).
- Décisions : règles de sévérité/statut/transitions dans `shared/utils/alerts.ts` (partagé front/serveur) ; changer le statut ne compte pas comme non-lu.
- Dette / suite : toujours pas de test HTTP automatisé des routes. Suites possibles : scénario d'incident pré-écrit (suite d'alertes/annonces planifiées déclenchée par l'animateur), statut de présence.

## 012 — Scénario d'incident pré-écrit, lancé par l'animateur (2026-10-23, commit a2d57e6)
- Livré : scénarios dans `server/scenarios/` (`panne-checkout` : 14 étapes sur 14 min, alertes checkout-api / orders-db / payment-gateway… et annonces Support / Direction / CTO, indice : déploiement v2.41.0 ; `demo-express` : 3 étapes en 6 s) ; exécuteur `server/utils/scenario-runner.ts` (planificateur + horloge injectables) ; `GET /api/admin/scenarios`, `POST /api/admin/scenarios/:id/start` (404 / 409), `POST /api/admin/scenarios/stop` (409 si rien) ; reset arrête le scénario ; panneau de progression dans `/admin` (polling 2 s). Vérifié dans Chrome (lancement de la démo, 3 étapes publiées, statut « Terminé »).
- Décisions : un seul scénario à la fois ; une étape en échec n'interrompt pas les suivantes ; garde `run !== current` contre les timers d'un ancien run.
- Dette / suite : `/admin` recharge la liste des scénarios à chaque frappe du code (401 en rafale) ; une erreur réseau ponctuelle masque le panneau. Suites possibles : statut de présence, export de la chronologie (timeline) pour le post-mortem.

## 013 — Chronologie de l'incident pour le post-mortem (2026-10-23, commit à renseigner)
- Livré : `buildTimeline` / `timelineToMarkdown` dans `shared/utils/timeline.ts` (messages, réponses, annonces, alertes déclenchées / acquittées / résolues, triés ; tableau Markdown avec heure Europe/Paris et `|` échappé) ; `GET /api/admin/timeline?channelId=…&format=json|md` (code animateur ; 401 / 404 / 400 ; `.md` en pièce jointe `chronologie-<canal>.md`) ; section « Chronologie (post-mortem) » dans `/admin` (aperçu défilant, « Télécharger .md »). Dette 012 corrigée : bouton « Valider le code », plus de requêtes à chaque frappe. Vérifié dans Chrome (aperçu tous canaux / incident, 0 requête avant validation, 375 px sans débordement).
- Décisions : heure formatée avec `hourCycle: 'h23'` ; `format` contrôlé avant `channelId` ; `channelId` vide = tous les canaux.
- Dette / suite : toujours pas de test HTTP automatisé. Prochaine feature pressentie : persistance légère des messages (fichier) pour survivre à un redémarrage Render ; puis rôles d'incident, bandeau d'état SEV/statut.
