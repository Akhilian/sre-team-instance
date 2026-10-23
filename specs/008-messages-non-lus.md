# 008 — Messages non lus par canal et compteur dans le titre de l'onglet

## Pourquoi
Pendant l'exercice, l'incident se discute sur plusieurs canaux (incident, général, canaux créés à la volée) : comme dans Teams, un participant doit voir d'un coup d'œil qu'un autre canal a bougé, et l'onglet du navigateur doit le signaler quand il regarde ailleurs. On solde aussi la dette de 007 (annonce sans corps → 404 au lieu de 400).

## Périmètre
- Type `ChannelSummary extends Channel { messageCount: number; lastMessageAt: string | null }` dans `shared/types/chat.ts`. `messageCount` compte tous les messages du canal (racines, réponses, annonces) ; `lastMessageAt` est le `createdAt` du plus récent, `null` si aucun.
- Store : nouvelle fonction `listChannelSummaries(): ChannelSummary[]` (même ordre que `listChannels`, qui reste inchangée). `GET /api/channels` renvoie ces résumés. `POST /api/channels` est inchangé.
- Calcul pur dans `app/utils/unread.ts` : `computeUnread(summaries, seen, currentId)` → `{ counts: Record<string, number>, nextSeen: Record<string, number> }`, où `seen` associe un id de canal au nombre de messages déjà vus. Règles : canal courant → vu en entier (non lu 0) ; canal absent de `seen` (première observation) → initialisé à son `messageCount` actuel (pas d'historique compté comme non lu) ; `messageCount < seen` (réinitialisation) → `seen` ramené à `messageCount` ; sinon non lu = `messageCount - seen`.
- Front : `seen` persisté en `localStorage` (clé `sre-team-instance:last-seen`), lu seulement après montage. Dans `ChannelList.vue`, un canal avec non lus > 0 a son nom en gras (`channel-list__link--unread`) et une pastille compteur (`data-testid="unread-badge"`, « 99+ » au-delà de 99) ; aucun indicateur sur le canal courant. Mise à jour à chaque poll (3 s) et lors de la navigation.
- Titre de l'onglet : `(N) <nom du canal> | SRE Team Instance` quand le total des non lus des autres canaux N > 0, sinon titre actuel inchangé. Côté SSR, pas de préfixe.
- Dette 007 : `POST /api/admin/announcements` avec un code valide et un corps absent, vide ou non-objet → 400 (et le commentaire du fichier devient exact).

## Hors périmètre
- Non-lus par fil de réponses, séparateur « Nouveaux messages » dans le fil, mention comptée à part (pastille `@`).
- Synchronisation des non-lus entre navigateurs ou côté serveur.
- Son, notification système, favicon animé.

## Critères d'acceptation
- [x] CA1 — `npm run test` passe et inclut des tests de `listChannelSummaries` (canal vide : `0` / `null` ; après 1 racine + 1 réponse : `2` et `lastMessageAt` = `createdAt` de la réponse ; après `clearMessages` : retour à `0` / `null`) et de `computeUnread` (première observation → 0 ; 3 nouveaux messages → 3 ; canal courant → 0 et `nextSeen` = `messageCount` ; compteur inférieur à `seen` → 0 et `seen` ramené ; canal disparu ignoré).
- [x] CA2 — Via HTTP, `GET /api/channels` renvoie pour chaque canal `id`, `name`, `messageCount`, `lastMessageAt` ; après 2 `POST` sur `general`, `general` a `"messageCount":2` et un `lastMessageAt` non nul, et `incident-en-cours` a `"messageCount":0,"lastMessageAt":null`.
- [x] CA3 — Via HTTP avec `x-facilitator-code: animateur` : `POST /api/admin/announcements` sans corps → 400, avec `-d '[]'` → 400 ; sans code et sans corps → toujours 401.
- [x] CA4 — Le HTML SSR de `GET /channels/general` contient toujours `data-testid="channel-list"`, ne contient aucun `data-testid="unread-badge"`, et son `<title>` ne commence pas par `(`.
- [x] CA5 — Vérification visuelle (orchestrateur, Chrome, deux fenêtres : « Alice » sur `general`, « Bob » sur `incident-en-cours`) : Bob poste 3 messages (dont une réponse) → chez Alice, en moins de 4 s, « Incident en cours » passe en gras avec une pastille « 3 » et l'onglet affiche `(3) …` ; Alice ouvre le canal → pastille et préfixe disparaissent, et ne reviennent pas après rechargement de la page ; une réinitialisation depuis `/admin` puis 1 nouveau message de Bob → pastille « 1 » chez Alice ; aucune erreur console ni avertissement d'hydratation.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10128 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; U=localhost:10128/api/channels; A=localhost:10128/api/admin; K='x-facilitator-code: animateur'
curl -s $U | grep -o '"id":"incident-en-cours","name":"[^"]*","messageCount":0,"lastMessageAt":null'   # présent (ordre des champs : id, name, messageCount, lastMessageAt)
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Bob","text":"un"}' >/dev/null
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Bob","text":"deux"}' >/dev/null
curl -s $U | grep -o '"id":"general","name":"[^"]*","messageCount":2,"lastMessageAt":"[^"]*"'            # présent
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$K"                                  # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$K" -H "$J" -d '[]'                  # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements                                          # 401
curl -s localhost:10128/channels/general | grep -c 'data-testid="channel-list"'                            # 1
curl -s localhost:10128/channels/general | grep -c 'data-testid="unread-badge"'                            # 0
curl -s localhost:10128/channels/general | grep -o '<title>[^<]*</title>'                                  # sans "(" en tête
```

## Notes d'implémentation
- Garder `listChannels()` et son test (clés `id`, `name`) intacts ; `index.get.ts` appelle `listChannelSummaries()`. Construire l'objet dans l'ordre `id, name, messageCount, lastMessageAt`.
- Annonce : dans `announcements.post.ts`, si le corps n'est pas un objet non-tableau → 400 avant l'appel au store (le store vérifie le canal avant le texte, d'où le 404 actuel).
- `[id].vue` possède déjà `channels` + polling : calculer `computeUnread` dans un `watch` sur `channels`/`channelId` côté client, écrire `nextSeen` en `localStorage`, passer `counts` en prop à `ChannelList` ; un état non lu vide tant que non monté (pas d'écart d'hydratation).
- `useHead` titre : préfixe calculé à partir de `counts` (vide au SSR). Pastille : fond `var(--teams-purple)`, texte blanc, alignée à droite du lien.
