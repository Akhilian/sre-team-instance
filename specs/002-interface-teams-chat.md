# 002 — Interface façon Teams branchée sur l'API, avec polling court

## Pourquoi
Les points 1 à 3 de specs/GOAL.md : les participants doivent ouvrir l'URL, choisir un nom, rejoindre un canal et échanger des messages visibles par les autres navigateurs en quelques secondes. L'API de la boucle 001 existe ; il manque l'interface qui la consomme.

## Périmètre
- Mise en page façon Teams (CSS maison, sans bibliothèque UI) : barre d'applications verticale à gauche (icônes factices, « Équipes » active), panneau liste des canaux, zone principale avec en-tête du canal, fil de messages et champ de saisie en bas.
- Route `/channels/[id]` rendue côté serveur (SSR) avec la liste des canaux et les messages du canal ; `/` redirige vers le canal d'incident (premier canal dont l'id commence par `incident-`).
- Canal inconnu : page d'erreur 404.
- Message affiché : avatar à initiales, nom de l'auteur, heure (HH:MM), texte.
- Nom d'affichage : à la première visite, une modale/encart demande un nom (1 à 50 caractères), mémorisé dans `localStorage` ; affiché en haut et modifiable. Le champ de saisie est inutilisable tant qu'aucun nom n'est choisi.
- Envoi : Entrée ou bouton « Envoyer » fait un `POST` vers l'API, vide le champ et affiche le message.
- Polling court : rafraîchissement des messages du canal courant toutes les 3 secondes environ (arrêté quand on quitte la page).
- Utilitaire pur `initials(name)` dans `shared/utils/` ou `app/utils/`, testé par Vitest.

## Hors périmètre
- Création de canal, fils, mentions, réactions, messages système, réinitialisation.
- SSE/WebSocket, paramètre `since`, pagination, indicateur « en train d'écrire », messages non lus.
- Responsive mobile, thème sombre, tests end-to-end ou de composants Vue.
- Toute modification de l'API existante (hormis l'éventuel passage `statusMessage` → `message`, facultatif).

## Critères d'acceptation
- [x] CA1 — `GET /` sur le serveur buildé répond par une redirection (301/302/307) vers `/channels/<id>` où `<id>` commence par `incident-` (ou, si la redirection est faite côté client, le HTML servi par `/channels/incident-en-cours` est celui attendu en CA2).
- [x] CA2 — `GET /channels/incident-en-cours` répond 200 et le HTML SSR contient : un élément `data-testid="app-bar"`, un élément `data-testid="channel-list"` contenant les noms de **tous** les canaux renvoyés par `GET /api/channels` sous forme de liens vers `/channels/<id>`, un élément `data-testid="message-list"` et un champ `data-testid="composer"`.
- [x] CA3 — Après `POST /api/channels/incident-en-cours/messages` avec `{"author":"Alice Martin","text":"Serveur en feu"}`, le HTML de `GET /channels/incident-en-cours` contient `Serveur en feu`, `Alice Martin` et l'avatar à initiales `AM` ; ce texte n'apparaît pas dans `GET /channels/general`.
- [x] CA4 — `GET /channels/inconnu` répond 404.
- [x] CA5 — `npm run test` passe et inclut au moins 3 tests de `initials` (« Alice Martin » → « AM », « bob » → « B », nom avec espaces superflus → initiales correctes, au plus 2 lettres en majuscules).
- [x] CA6 — Le code client interroge `GET /api/channels/:id/messages` périodiquement (intervalle compris entre 1 et 5 s), nettoyé au démontage, et le nom d'affichage est lu/écrit dans `localStorage` (vérifiable par lecture du code : `setInterval`/`useIntervalFn` + `clearInterval` dans `onBeforeUnmount`/`onUnmounted`, et clé `localStorage` dédiée) ; `GET /api/health` répond toujours 200.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10124 node .output/server/index.mjs &   # arrêter à la fin
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:10124/          # 30x vers /channels/incident-...
curl -s localhost:10124/api/channels
curl -s localhost:10124/channels/incident-en-cours | grep -oE 'data-testid="(app-bar|channel-list|message-list|composer)"' | sort -u   # 4 lignes
curl -s localhost:10124/channels/incident-en-cours | grep -oE 'href="/channels/[^"]+"' | sort -u   # un lien par canal
curl -s -X POST localhost:10124/api/channels/incident-en-cours/messages -H 'content-type: application/json' -d '{"author":"Alice Martin","text":"Serveur en feu"}'
curl -s localhost:10124/channels/incident-en-cours | grep -c 'Serveur en feu'      # >= 1
curl -s localhost:10124/channels/incident-en-cours | grep -oE '>\s*AM\s*<' | head -1   # avatar AM
curl -s localhost:10124/channels/general | grep -c 'Serveur en feu'                # 0
curl -s -o /dev/null -w '%{http_code}\n' localhost:10124/channels/inconnu          # 404
curl -s -o /dev/null -w '%{http_code}\n' localhost:10124/api/health                # 200
grep -rnE 'setInterval|useIntervalFn|clearInterval|localStorage' app/
```
Vérification visuelle complémentaire (orchestrateur, Chrome) : deux fenêtres avec deux noms différents, un message envoyé dans l'une apparaît dans l'autre en moins de 5 s.

## Notes d'implémentation
- Fichiers pressentis : `app/pages/index.vue` (redirection via `navigateTo(..., { redirectCode: 302 })`), `app/pages/channels/[id].vue`, `app/components/` (AppBar, ChannelList, MessageList, Composer, DisplayNameDialog), `app/composables/useDisplayName.ts`, `app/utils/initials.ts` + `tests/initials.test.ts`.
- Données SSR via `useFetch('/api/channels')` et `useFetch(\`/api/channels/${id}/messages\`)` ; 404 via `throw createError({ statusCode: 404 })` si le canal n'existe pas ; polling = `refresh()` dans `setInterval` démarré en `onMounted`.
- `localStorage` uniquement côté client (`onMounted` ou `import.meta.client`) pour éviter les erreurs d'hydratation ; l'heure est formatée de façon déterministe pour éviter un écart SSR/client (ex. `toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })`).
- Couleurs Teams indicatives : violet `#464775`/`#6264a7`, fond `#f5f5f5` ; les `data-testid` sont requis pour la vérification.
- Vitest : si `initials` est dans `app/utils/`, l'importer par chemin relatif (pas d'auto-import dans les tests).
