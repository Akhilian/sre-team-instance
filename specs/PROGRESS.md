# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

- 000 — Socle (00a9070) : Nuxt 4 + `GET /api/health`, déployé sur Render (Node 24, TypeScript ~6.0).

- 001 — API canaux/messages en mémoire + Vitest (8521ecb) : `server/utils/chat-store.ts`, routes `/api/channels[/:id/messages]`, types dans `shared/types/chat.ts`, tests dans `tests/`.

- 002 — Interface façon Teams + polling 3 s (74691a6) : page `/channels/[id]` SSR, composants dans `app/components/`, CSS maison `app/assets/css/main.css` (palette #464775 / #5b5fc7), nom d'affichage en `localStorage`.

- 003 — Création de canal + fil ancré en bas (dc253a4) : `POST /api/channels` (slug, 400/409), erreurs métier via classes d'erreur du store traduites en codes HTTP.

- 004 — Réponses en fil (beb180a) : `parentId` sur un seul niveau, `app/utils/threads.ts`, `ReplyComposer` inline.

- 005 — Mentions `@nom` + alignement à gauche (2cafbf1) : `app/utils/mentions.ts`, `MessageText.vue` sans `v-html`, mise en évidence « me » côté client uniquement.

- 006 — Réactions emoji (63616c6) : `POST …/messages/:messageId/reactions` en bascule, jeu de 6 emojis dans `shared/utils/reactions.ts`, `MessageReactions.vue`.

## 007 — Outils d'animateur : annonce et réinitialisation (2026-10-23, commit 8024b26)
- Livré : `POST /api/admin/announcements` (message `kind: "announcement"` signé « Animateur », bandeau violet « Annonce », on peut y répondre et réagir) ; `POST /api/admin/reset` (vide les messages, garde les canaux) ; page `/admin` non liée ; protection par en-tête `x-facilitator-code` comparé à `FACILITATOR_CODE` (défaut `animateur`), 401 sinon ; palette de réactions déplacée à droite du bouton (ne recouvre plus de texte). Vérifié dans Chrome (publication depuis `/admin`, rendu de l'annonce, palette).
- Décisions : `process.env` lu via `globalThis` (pas de `@types/node`) ; `FACILITATOR_CODE` déclaré `sync: false` dans `render.yaml` — **à saisir dans le dashboard Render avant l'atelier**, sinon le défaut `animateur` s'applique.
- Dette / suite : POST annonce sans corps → 404 au lieu de 400 (commentaire trompeur) ; palette latérale potentiellement débordante sur écran étroit. Périmètre GOAL 1 à 6 livré. Suites possibles : vérification sur l'URL Render déployée, responsive, indicateur « nouveaux messages » par canal.

## 008 — Messages non lus par canal et compteur dans l'onglet (2026-10-23, commit 67d2e66)
- Livré : `GET /api/channels` renvoie aussi `messageCount` et `lastMessageAt` (`listChannelSummaries`) ; `app/utils/unread.ts` (`computeUnread`, `totalUnread`, `parseSeen`, `unreadBadgeLabel`) ; « dernier vu » en localStorage (`sre-team-instance:last-seen`) ; canal non lu en gras + pastille violette (« 99+ ») ; titre d'onglet « (N) … » ; POST annonce sans corps / non-objet → 400. Vérifié dans Chrome (3 messages d'un autre auteur → pastille 3 et « (3) », remise à zéro après visite).
- Décisions : calcul des non-lus uniquement côté client après montage (rien au SSR) ; un canal vu pour la première fois ne compte pas son historique.
- Dette / suite : annonce avec `{}` → 404 au lieu de 400 ; palette latérale sur écran étroit ; l'URL Render n'est pas autorisée dans Claude in Chrome (vérif déployée faite en HTTP). Suites possibles : responsive mobile, indicateur « X est en train d'écrire », persistance légère (fichier) pour survivre aux redémarrages Render.

## 009 — Présence dans le canal et indicateur « en train d'écrire » (2026-10-23, commit à renseigner)
- Livré : `server/utils/presence-store.ts` (horloge `now` injectée, présence 15 s, frappe 5 s, calcul à la lecture) ; `POST /api/presence {name, channelId, typing?}` → `{present, typing}` (400 / 404) ; battement au montage, à chaque poll, au changement de canal/nom, frappe throttlée à 2 s depuis les deux composers, `typing:false` après envoi ; avatars empilés (4 max + `+N`) dans l'en-tête, `typingLabel` sous le fil. Vérifié dans Chrome (3 présents, « Alice Martin et Bob Durand écrivent… », expiration ≈ 8 s).
- Décisions : un battement sans `typing` ne modifie pas la frappe en cours (seul `typing:false` l'efface) ; validation du corps avant la recherche du canal.
- Dette / suite : course mineure (un `typing:true` en vol peut rallumer l'indicateur ≤ 5 s) ; annonce avec `{}` → 404 ; palette latérale sur écran étroit. Suites possibles : responsive mobile, indicateur de statut (disponible / occupé / ne pas déranger).
