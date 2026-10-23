# 007 — Outils d'animateur : annonce et réinitialisation des conversations

## Pourquoi
Point 6 de specs/GOAL.md : l'animateur de l'atelier doit pouvoir injecter un événement visible de tous (« 14h02 : le taux d'erreur du checkout passe à 30 % ») et remettre les conversations à zéro entre deux groupes, sans redémarrer le service Render. On solde au passage la dette de la boucle 006 (palette de réactions qui recouvre le texte).

## Périmètre
- Code animateur : `server/utils/facilitator.ts` exporte `isFacilitatorCode(code: unknown, env = process.env): boolean`, vrai si `code` est une chaîne égale à `env.FACILITATOR_CODE`, ou à `animateur` quand la variable est absente ou vide. Les routes admin lisent le code dans l'en-tête `x-facilitator-code` ; absent ou faux → 401.
- Type `Message` : champ optionnel `kind?: 'announcement'`, absent pour un message ordinaire. Le `POST` public des messages ignore tout `kind` reçu dans le corps.
- Store : `addAnnouncement(channelId, { text })` crée un message racine `author: "Animateur"`, `kind: "announcement"` (mêmes règles de `text` que `addMessage`) ; `clearMessages()` vide les messages de tous les canaux en **conservant** les canaux (y compris ceux créés par les participants).
- API : `POST /api/admin/announcements` `{ channelId, text }` → 201 + message ; 400 texte invalide ; 404 canal inconnu ; 401 code invalide. `POST /api/admin/reset` → 200 `{ "cleared": true }` ; 401 code invalide. Le `GET` des messages existant renvoie les annonces ; les réponses et réactions sur une annonce restent possibles.
- Front : rendu d'une annonce dans le fil (`data-testid="announcement"`) façon Teams : bandeau coloré en tête de bulle avec l'intitulé « Annonce », auteur « Animateur », bordure violette marquée. Page `/admin` (non liée dans la navigation) : champ code animateur (gardé en `sessionStorage`), sélecteur de canal, zone de texte et bouton « Publier l'annonce », bouton « Réinitialiser les conversations » avec `confirm()` ; message de succès ou d'erreur (« Code animateur invalide » sur 401). Les participants voient l'annonce, ou le fil vidé, au polling suivant.
- Dette 006 : la palette `reaction-picker` (aujourd'hui ouverte vers le bas, `top: calc(100% + 4px)`) ne recouvre plus le texte de la réponse suivante : ouverture vers le haut, façon Teams, flottant au-dessus du coin haut droit de la bulle.
- `render.yaml` : déclarer `FACILITATOR_CODE` avec `sync: false` (valeur saisie dans le tableau de bord Render).

## Hors périmètre
- Vraie authentification, sessions, rôles, journal d'audit.
- Suppression ou édition d'un message, suppression de canaux, réinitialisation d'un seul canal.
- Annonce planifiée, notification, mise en avant épinglée en haut du canal.

## Critères d'acceptation
- [x] CA1 — `npm run test` passe et inclut des tests de : `isFacilitatorCode` (défaut `animateur` si variable absente ou vide, valeur de `FACILITATOR_CODE` sinon, ancien défaut refusé quand la variable est définie, non-chaîne refusée) ; `addAnnouncement` (auteur `Animateur`, `kind` présent, texte vide → erreur, canal inconnu → erreur) ; `clearMessages` (messages vidés, canal créé par un participant conservé) ; `addMessage` avec `kind` dans l'entrée → message sans `kind`.
- [x] CA2 — Via HTTP, sans en-tête ou avec un code faux : `POST /api/admin/announcements` et `POST /api/admin/reset` → 401, et rien n'est modifié.
- [x] CA3 — Via HTTP avec `x-facilitator-code: animateur` (variable non définie) : annonce sur `incident-en-cours` → 201, puis le `GET` des messages du canal contient `"kind":"announcement"` et `"author":"Animateur"` ; canal inconnu → 404 ; texte vide → 400. Un `POST` public avec `"kind":"announcement"` crée un message sans `kind`.
- [x] CA4 — Le HTML SSR de `GET /channels/incident-en-cours` contient un élément `data-testid="announcement"` avec le texte « Annonce » et le texte de l'annonce ; `GET /admin` → 200.
- [x] CA5 — Reset : après création d'un canal `Exercice 2` et d'un message, `POST /api/admin/reset` → 200 ; ensuite `GET /api/channels/general/messages` et `…/exercice-2/messages` renvoient `[]`, et `GET /api/channels` contient toujours `exercice-2`. Serveur démarré avec `FACILITATOR_CODE=secret` : `animateur` → 401, `secret` → 200.
- [x] CA6 — Vérification visuelle (orchestrateur, Chrome, une fenêtre `/admin` et une fenêtre participant « Alice » sur le canal d'incident) : code faux → message d'erreur visible ; annonce publiée → bandeau « Annonce » visible chez Alice en moins de 4 s, Alice peut y répondre et réagir ; réinitialisation confirmée → fil vide chez Alice en moins de 4 s ; palette de réactions ouverte sur une réponse suivie d'une autre réponse : la palette ne chevauche pas le texte de la réponse suivante (rectangles `getBoundingClientRect` disjoints) ; aucune erreur console.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10127 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; A=localhost:10127/api/admin; U=localhost:10127/api/channels; K='x-facilitator-code: animateur'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$J" -d '{"channelId":"incident-en-cours","text":"x"}'                      # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/reset -H 'x-facilitator-code: faux'                                                        # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$J" -H "$K" -d '{"channelId":"incident-en-cours","text":"Le checkout renvoie 30 % de 500"}'  # 201
curl -s $U/incident-en-cours/messages | grep -o '"author":"Animateur"[^}]*"kind":"announcement"\|"kind":"announcement"' | head -1   # présent
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$J" -H "$K" -d '{"channelId":"nope","text":"x"}'                          # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST $A/announcements -H "$J" -H "$K" -d '{"channelId":"general","text":" "}'                       # 400
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Eve","text":"faux","kind":"announcement"}' | grep -c '"kind"'                        # 0
curl -s localhost:10127/channels/incident-en-cours | grep -o 'data-testid="announcement"' | head -1                                          # présent
curl -s localhost:10127/channels/incident-en-cours | grep -c 'Le checkout renvoie 30 % de 500'                                               # >= 1
curl -s -o /dev/null -w '%{http_code}\n' localhost:10127/admin                                                                                # 200
curl -s -X POST $U -H "$J" -d '{"name":"Exercice 2"}' >/dev/null
curl -s -X POST $U/exercice-2/messages -H "$J" -d '{"author":"Bob","text":"hello"}' >/dev/null
curl -s -X POST $A/reset -H "$K"                                                                                                              # {"cleared":true}
curl -s $U/general/messages; echo; curl -s $U/exercice-2/messages; echo                                                                       # [] puis []
curl -s $U | grep -c '"exercice-2"'                                                                                                           # 1
# Puis : arrêter le serveur, relancer avec FACILITATOR_CODE=secret PORT=10128 node .output/server/index.mjs &
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10128/api/admin/reset -H "$K"                                                     # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10128/api/admin/reset -H 'x-facilitator-code: secret'                             # 200
```

## Notes d'implémentation
- Routes `server/api/admin/announcements.post.ts` et `server/api/admin/reset.post.ts`, même style que `messages.post.ts` (`createError({ statusCode, message })`) ; vérifier le code en premier, avant toute lecture du corps.
- Lire `process.env.FACILITATOR_CODE` à chaque requête (pas de `runtimeConfig`, qui imposerait le préfixe `NUXT_`) ; `addMessage` construit son objet champ par champ, donc `kind` est déjà ignoré : le tester.
- Rendu : dans `MessageList.vue`, ajouter une classe `message--announcement` et le bandeau sur la bulle racine quand `thread.kind === 'announcement'` ; ne pas toucher au rendu des messages ordinaires.
- Palette : dans `MessageReactions.vue`, passer `.reaction-picker` de `top: calc(100% + 4px)` à `bottom: calc(100% + 4px)` (z-index au-dessus des bulles).
- `/admin` : `app/pages/admin.vue`, réutilise les classes CSS existantes ; la liste des canaux vient de `GET /api/channels`.
