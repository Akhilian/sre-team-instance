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

## 008 — Messages non lus par canal et compteur dans l'onglet (2026-10-23, commit 67d2e66)
- Livré : `GET /api/channels` renvoie aussi `messageCount` et `lastMessageAt` (`listChannelSummaries`) ; `app/utils/unread.ts` (`computeUnread`, `totalUnread`, `parseSeen`, `unreadBadgeLabel`) ; « dernier vu » en localStorage (`sre-team-instance:last-seen`) ; canal non lu en gras + pastille violette (« 99+ ») ; titre d'onglet « (N) … » ; POST annonce sans corps / non-objet → 400. Vérifié dans Chrome (3 messages d'un autre auteur → pastille 3 et « (3) », remise à zéro après visite).
- Décisions : calcul des non-lus uniquement côté client après montage (rien au SSR) ; un canal vu pour la première fois ne compte pas son historique.
- Dette / suite : annonce avec `{}` → 404 au lieu de 400 ; palette latérale sur écran étroit ; l'URL Render n'est pas autorisée dans Claude in Chrome (vérif déployée faite en HTTP). Suites possibles : responsive mobile, indicateur « X est en train d'écrire », persistance légère (fichier) pour survivre aux redémarrages Render.

## 009 — Présence dans le canal et indicateur « en train d'écrire » (2026-10-23, commit 0ca8480)
- Livré : `server/utils/presence-store.ts` (horloge `now` injectée, présence 15 s, frappe 5 s, calcul à la lecture) ; `POST /api/presence {name, channelId, typing?}` → `{present, typing}` (400 / 404) ; battement au montage, à chaque poll, au changement de canal/nom, frappe throttlée à 2 s depuis les deux composers, `typing:false` après envoi ; avatars empilés (4 max + `+N`) dans l'en-tête, `typingLabel` sous le fil. Vérifié dans Chrome (3 présents, « Alice Martin et Bob Durand écrivent… », expiration ≈ 8 s).
- Décisions : un battement sans `typing` ne modifie pas la frappe en cours (seul `typing:false` l'efface) ; validation du corps avant la recherche du canal.
- Dette / suite : course mineure (un `typing:true` en vol peut rallumer l'indicateur ≤ 5 s) ; annonce avec `{}` → 404 ; palette latérale sur écran étroit. Suites possibles : responsive mobile, indicateur de statut (disponible / occupé / ne pas déranger).

## 010 — Interface utilisable sur petit écran (2026-10-23, commit à renseigner)
- Livré : sous 768 px, liste des canaux en tiroir (bouton menu `channel-panel-toggle`, voile, Échap, fermeture au clic sur un canal), barre d'applications 48 px, bulles pleine largeur, palette de réactions au-dessus du bouton, bouton de réaction toujours visible en tactile (`hover: none`) ; `min-width: 900px` supprimé ; annonce avec `channelId` absent → 400. Correctif : le bouton d'ajout de réaction n'apparaissait jamais au survol sur bureau (sélecteur `:global` mal compilé) → `.message:hover :deep(.reactions__add)` dans `MessageList.vue`. Vérifié dans Chrome (survol bureau ; iframe 375 px : pas de défilement horizontal, tiroir ouvert/fermé, navigation).
- Décisions : `vite.build.cssTarget` fixé dans `nuxt.config.ts` (garde la syntaxe `max-width:767px` dans le CSS construit) ; `overflow-wrap: anywhere` sur les bulles.
- Dette / suite : la palette du premier message peut être coupée en haut sur mobile ; pas de test HTTP automatisé des routes (vérifiées par curl). Suites possibles : statut de présence (disponible / occupé), scénario d'incident pré-écrit déclenchable par l'animateur.
