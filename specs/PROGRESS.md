# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

## 000 — Socle (2026-10-23, commit 00a9070)
- Livré : application Nuxt 4 avec `GET /api/health`, déployée sur Render en Web Service Node.
- Décisions : un seul dépôt (front + API Nuxt), TypeScript ~6.0, Node 24.
- Dette / suite : aucun test ni lint pour l'instant.

## 001 — API de canaux et messages en mémoire, avec tests (2026-10-23, commit 8521ecb)
- Livré : store en mémoire (`server/utils/chat-store.ts`, canaux `general` et `incident-en-cours`), `GET /api/channels`, `GET`/`POST /api/channels/:id/messages` (400 si invalide, 404 si canal inconnu), Vitest (`npm run test`, 16 tests dans `tests/`).
- Décisions : types partagés dans `shared/types/chat.ts` ; tests hors de `server/` pour éviter l'auto-import Nitro ; `crypto.randomUUID()` global (pas de `@types/node`) ; POST répond 201.
- Dette / suite : passer les erreurs à `createError({ statusCode, message })` (avertissement h3 sur `statusMessage`) ; vulnérabilités npm non traitées. Suite : interface façon Teams branchée sur l'API, polling court.

## 002 — Interface façon Teams branchée sur l'API, avec polling court (2026-10-23, commit 74691a6)
- Livré : page `/channels/[id]` (SSR) avec barre d'applications, liste de canaux, fil de messages (avatars à initiales colorés, heure), composer ; `/` redirige vers `incident-en-cours` ; modale de nom d'affichage (`localStorage` `sre-team-instance:display-name`) ; polling 3 s. Vérifié dans Chrome (envoi, réception d'un autre auteur < 4 s, navigation entre canaux, aucune erreur console).
- Décisions : CSS maison (`app/assets/css/main.css`, palette #464775 / #5b5fc7), composants dans `app/components/`, utilitaires purs dans `app/utils/` testés par Vitest ; ses propres messages à droite en bulle violette claire.
- Dette / suite : le fil commence en haut (Teams l'ancre en bas, avec défilement automatique) ; bruit de logs sur les 404 ; recherche et onglets factices. Suite pressentie : création de canal, puis réponses en fil.

## 003 — Création d'un canal par un participant, fil ancré en bas (2026-10-23, commit à renseigner)
- Livré : `POST /api/channels {name}` (id slugifié sans accents, 400 invalide, 409 doublon) ; bouton « + » et formulaire dans la liste de canaux, redirection vers le nouveau canal ; polling 3 s de la liste des canaux ; fil ancré en bas avec défilement auto (si ≤ 100 px du bas ou message envoyé par soi) ; `statusMessage` → `message` dans `server/`. Vérifié dans Chrome (création locale + canal créé par un autre visible < 4 s, ancrage en bas, changement de canal).
- Décisions : erreurs métier du store via classes `ChannelValidationError` / `ChannelConflictError`, traduites en 400/409 par les routes.
- Dette / suite : les messages consécutifs d'un même auteur ne sont pas regroupés comme dans Teams ; bruit de logs sur les 404. Suite pressentie : réponses en fil, puis mentions et réactions.
