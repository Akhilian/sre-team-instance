# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

- 000 — Socle (00a9070) : Nuxt 4 + `GET /api/health`, déployé sur Render (Node 24, TypeScript ~6.0).

- 001 — API canaux/messages en mémoire + Vitest (8521ecb) : `server/utils/chat-store.ts`, routes `/api/channels[/:id/messages]`, types dans `shared/types/chat.ts`, tests dans `tests/`.

## 002 — Interface façon Teams branchée sur l'API, avec polling court (2026-10-23, commit 74691a6)
- Livré : page `/channels/[id]` (SSR) avec barre d'applications, liste de canaux, fil de messages (avatars à initiales colorés, heure), composer ; `/` redirige vers `incident-en-cours` ; modale de nom d'affichage (`localStorage` `sre-team-instance:display-name`) ; polling 3 s. Vérifié dans Chrome (envoi, réception d'un autre auteur < 4 s, navigation entre canaux, aucune erreur console).
- Décisions : CSS maison (`app/assets/css/main.css`, palette #464775 / #5b5fc7), composants dans `app/components/`, utilitaires purs dans `app/utils/` testés par Vitest ; ses propres messages à droite en bulle violette claire.
- Dette / suite : le fil commence en haut (Teams l'ancre en bas, avec défilement automatique) ; bruit de logs sur les 404 ; recherche et onglets factices. Suite pressentie : création de canal, puis réponses en fil.

## 003 — Création d'un canal par un participant, fil ancré en bas (2026-10-23, commit dc253a4)
- Livré : `POST /api/channels {name}` (id slugifié sans accents, 400 invalide, 409 doublon) ; bouton « + » et formulaire dans la liste de canaux, redirection vers le nouveau canal ; polling 3 s de la liste des canaux ; fil ancré en bas avec défilement auto (si ≤ 100 px du bas ou message envoyé par soi) ; `statusMessage` → `message` dans `server/`. Vérifié dans Chrome (création locale + canal créé par un autre visible < 4 s, ancrage en bas, changement de canal).
- Décisions : erreurs métier du store via classes `ChannelValidationError` / `ChannelConflictError`, traduites en 400/409 par les routes.
- Dette / suite : les messages consécutifs d'un même auteur ne sont pas regroupés comme dans Teams ; bruit de logs sur les 404. Suite pressentie : réponses en fil, puis mentions et réactions.

## 004 — Réponses en fil façon Teams (2026-10-23, commit à renseigner)
- Livré : champ optionnel `parentId` sur `Message` (un seul niveau, même canal, 400 sinon) ; `app/utils/threads.ts` (`groupThreads`) testé ; rendu en fils (réponses indentées et compactes, bouton « Répondre », `ReplyComposer` inline, Échap ferme) ; auto-scroll seulement pour une nouvelle racine. Vérifié dans Chrome (réponse locale, réponse et nouvelle racine d'un autre auteur visibles < 4 s).
- Décisions : un seul champ de réponse ouvert à la fois ; « Répondre » désactivé sans nom d'affichage.
- Dette / suite : ses propres messages sont alignés à droite sans nom, y compris dans les fils — ce n'est pas le rendu d'un canal Teams (tout à gauche, nom affiché) ; à corriger. Suite pressentie : mentions `@nom` et réactions emoji.
