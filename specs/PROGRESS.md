# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

- 000 — Socle (00a9070) : Nuxt 4 + `GET /api/health`, déployé sur Render (Node 24, TypeScript ~6.0).

- 001 — API canaux/messages en mémoire + Vitest (8521ecb) : `server/utils/chat-store.ts`, routes `/api/channels[/:id/messages]`, types dans `shared/types/chat.ts`, tests dans `tests/`.

- 002 — Interface façon Teams + polling 3 s (74691a6) : page `/channels/[id]` SSR, composants dans `app/components/`, CSS maison `app/assets/css/main.css` (palette #464775 / #5b5fc7), nom d'affichage en `localStorage`.

## 003 — Création d'un canal par un participant, fil ancré en bas (2026-10-23, commit dc253a4)
- Livré : `POST /api/channels {name}` (id slugifié sans accents, 400 invalide, 409 doublon) ; bouton « + » et formulaire dans la liste de canaux, redirection vers le nouveau canal ; polling 3 s de la liste des canaux ; fil ancré en bas avec défilement auto (si ≤ 100 px du bas ou message envoyé par soi) ; `statusMessage` → `message` dans `server/`. Vérifié dans Chrome (création locale + canal créé par un autre visible < 4 s, ancrage en bas, changement de canal).
- Décisions : erreurs métier du store via classes `ChannelValidationError` / `ChannelConflictError`, traduites en 400/409 par les routes.
- Dette / suite : les messages consécutifs d'un même auteur ne sont pas regroupés comme dans Teams ; bruit de logs sur les 404. Suite pressentie : réponses en fil, puis mentions et réactions.

## 004 — Réponses en fil façon Teams (2026-10-23, commit beb180a)
- Livré : champ optionnel `parentId` sur `Message` (un seul niveau, même canal, 400 sinon) ; `app/utils/threads.ts` (`groupThreads`) testé ; rendu en fils (réponses indentées et compactes, bouton « Répondre », `ReplyComposer` inline, Échap ferme) ; auto-scroll seulement pour une nouvelle racine. Vérifié dans Chrome (réponse locale, réponse et nouvelle racine d'un autre auteur visibles < 4 s).
- Décisions : un seul champ de réponse ouvert à la fois ; « Répondre » désactivé sans nom d'affichage.
- Dette / suite : ses propres messages sont alignés à droite sans nom, y compris dans les fils — ce n'est pas le rendu d'un canal Teams (tout à gauche, nom affiché) ; à corriger. Suite pressentie : mentions `@nom` et réactions emoji.

## 005 — Mentions `@nom` et messages de canal alignés à gauche (2026-10-23, commit à renseigner)
- Livré : `app/utils/mentions.ts` (`splitMentions`, noms connus = auteurs du canal + soi, nom le plus long prioritaire, insensible à la casse, `ops@bob.fr` ignoré) ; `MessageText.vue` (sans `v-html`) ; mention en violet gras, mention de soi sur fond orangé + bordure rouge à gauche du message (`data-testid="mentions-me"`) ; tous les messages à gauche avec avatar et nom. Vérifié dans Chrome.
- Décisions : la mise en évidence « me » n'existe que côté client (nom vide au SSR) ; jamais de `v-html` pour le texte des messages.
- Dette / suite : pas d'autocomplétion des mentions à la saisie. Suite pressentie : réactions emoji (dernier point du périmètre 1–5), puis outils d'animateur (annonce, réinitialisation).
