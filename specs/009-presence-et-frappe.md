# 009 — Présence dans le canal et indicateur « en train d'écrire »

## Pourquoi
Pendant l'exercice d'incident, savoir qui suit le canal et qui est en train de rédiger change la dynamique (on attend la réponse de l'astreinte, on évite de parler en même temps), comme dans Teams. C'est la suite pressentie dans PROGRESS.md (008) pour rendre la simulation plus réaliste.

## Périmètre
- Store pur `server/utils/presence-store.ts`, horloge injectée par paramètre `now` (ms) : `recordPresence({ name, channelId, typing }, now)` et `channelPresence(channelId, now)` → `{ present: string[], typing: string[] }` (noms triés, `localeCompare` fr) ; `resetPresenceStore()` pour les tests. Une entrée par nom (nom rogné) : un nom n'est présent que dans le **dernier** canal signalé. Présent si dernier battement < 15 s ; en train d'écrire si dernier `typing: true` < 5 s et pas de `typing: false` depuis.
- `POST /api/presence` `{ name, channelId, typing? }` : enregistre puis renvoie `channelPresence(channelId)` (200). `name` invalide (même règle que `author` : chaîne non vide après rognage, ≤ 50) ou `typing` non booléen → 400 ; canal inconnu → 404. `typing` absent = `false`.
- `app/utils/presence.ts` : `typingLabel(names, me)` (exclut `me` ; 0 → `""` ; 1 → `"Alice écrit…"` ; 2 → `"Alice et Bob écrivent…"` ; 3+ → `"Plusieurs personnes écrivent…"`).
- Front `[id].vue` (client uniquement, si un nom est choisi) : battement au montage, à chaque poll (3 s) et à la navigation ; à la frappe dans `Composer` ou `ReplyComposer`, `typing: true` au plus une fois toutes les 2 s ; `typing: false` juste après l'envoi d'un message.
- En-tête du canal : avatars à initiales empilés et chevauchés (`data-testid="presence-avatar"`, nom en `title`), 4 au plus puis pastille `+N` ; soi-même inclus. Sous le fil, au-dessus du champ de saisie : `data-testid="typing-indicator"` (`aria-live="polite"`) affichant `typingLabel`.

## Hors périmètre
- Statut manuel (absent, occupé, ne pas déranger), présence globale dans la liste des canaux ou la barre latérale.
- Frappe distinguée par fil de réponses, SSE/WebSocket, persistance de la présence.
- Effacement de la présence par `/api/admin/reset`.

## Critères d'acceptation
- [x] CA1 — `npm run test` passe et inclut des tests de `presence-store` avec horloge injectée : présent à t+14 s, absent à t+16 s ; frappe vue à t+4 s, absente à t+6 s ; `typing: false` efface la frappe immédiatement ; changer de canal retire le nom de l'ancien canal ; tri des noms. Et de `typingLabel` (0, 1, 2, 3+ noms, exclusion de `me`).
- [x] CA2 — Via HTTP : après `POST /api/presence {"name":"Alice","channelId":"general","typing":true}`, un `POST` de Bob sur `general` sans `typing` renvoie `{"present":["Alice","Bob"],"typing":["Alice"]}`.
- [x] CA3 — Via HTTP : `name` vide → 400 ; `typing: "oui"` → 400 ; `channelId` inconnu → 404.
- [x] CA4 — Le HTML SSR de `GET /channels/general` contient `data-testid="typing-indicator"` et aucun `data-testid="presence-avatar"` (rien de rendu avant montage, pas d'écart d'hydratation).
- [x] CA5 — Vérification visuelle (orchestrateur, Chrome, « Alice » et « Bob » sur `incident-en-cours`) : en moins de 4 s, chacun voit deux avatars empilés dans l'en-tête ; quand Bob tape, Alice voit « Bob écrit… » en moins de 4 s, qui disparaît après l'envoi du message ou au plus ~8 s après la dernière frappe ; Bob ne voit jamais son propre nom dans l'indicateur ; Bob ferme son onglet → son avatar disparaît chez Alice en moins de ~20 s ; aucune erreur console ni avertissement d'hydratation.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10129 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; P=localhost:10129/api/presence
curl -s -X POST $P -H "$J" -d '{"name":"Alice","channelId":"general","typing":true}' >/dev/null
curl -s -X POST $P -H "$J" -d '{"name":"Bob","channelId":"general"}'                       # {"present":["Alice","Bob"],"typing":["Alice"]}
curl -s -o /dev/null -w '%{http_code}\n' -X POST $P -H "$J" -d '{"name":"  ","channelId":"general"}'              # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $P -H "$J" -d '{"name":"Bob","channelId":"general","typing":"oui"}' # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $P -H "$J" -d '{"name":"Bob","channelId":"nope"}'                # 404
curl -s localhost:10129/channels/general | grep -c 'data-testid="typing-indicator"'   # 1
curl -s localhost:10129/channels/general | grep -c 'data-testid="presence-avatar"'    # 0
```

## Notes d'implémentation
- Store en `Map<name, { channelId, lastSeen, typingUntil }>` ; aucun timer serveur, l'expiration se calcule à la lecture ; la route passe `Date.now()`. Canal vérifié via `hasChannel` du chat-store.
- Composers : émettre un événement `typing` sur `input` ; le throttle 2 s et l'appel `$fetch` vivent dans `[id].vue` (ou un composable `usePresence`).
- État de présence vide tant que non monté ; ignorer silencieusement les erreurs réseau du battement.
- Avatars : réutiliser `initials`/`avatarColor`, `margin-left` négatif et bordure blanche pour l'empilement ; indicateur en italique gris, hauteur réservée pour éviter les sauts de mise en page.
