# Avancement

<!-- Une entrée par boucle terminée (format dans CLAUDE.md). 3 dernières en détail, les plus anciennes résumées en une ligne. -->

## 000 — Socle (2026-10-23, commit 00a9070)
- Livré : application Nuxt 4 avec `GET /api/health`, déployée sur Render en Web Service Node.
- Décisions : un seul dépôt (front + API Nuxt), TypeScript ~6.0, Node 24.
- Dette / suite : aucun test ni lint pour l'instant.

## 001 — API de canaux et messages en mémoire, avec tests (2026-10-23, commit voir `git log --grep "^001"`)
- Livré : store en mémoire (`server/utils/chat-store.ts`, canaux `general` et `incident-en-cours`), `GET /api/channels`, `GET`/`POST /api/channels/:id/messages` (400 si invalide, 404 si canal inconnu), Vitest (`npm run test`, 16 tests dans `tests/`).
- Décisions : types partagés dans `shared/types/chat.ts` ; tests hors de `server/` pour éviter l'auto-import Nitro ; `crypto.randomUUID()` global (pas de `@types/node`) ; POST répond 201.
- Dette / suite : passer les erreurs à `createError({ statusCode, message })` (avertissement h3 sur `statusMessage`) ; vulnérabilités npm non traitées. Suite : interface façon Teams branchée sur l'API, polling court.
