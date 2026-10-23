# 006 — Réactions emoji façon Teams sur les messages

## Pourquoi
Dernier élément du point 5 de specs/GOAL.md : pendant l'exercice, on acquiesce ou on signale sa surprise d'un clic (👍 sur « je redémarre le service ») sans polluer le fil. Avec cette boucle, les points 1 à 5 du périmètre sont couverts.

## Périmètre
- Jeu fixe de 6 réactions, dans cet ordre : `👍` `❤️` `😆` `😮` `😢` `😡` (constante partagée dans `shared/`, ex. `REACTION_EMOJIS`).
- Type `Message` : champ optionnel `reactions?: { emoji: string, authors: string[] }[]`, absent quand le message n'a aucune réaction ; entrées dans l'ordre de première réaction, auteurs dans l'ordre d'arrivée ; une entrée dont la liste d'auteurs devient vide est retirée (et le champ supprimé s'il ne reste rien).
- Store : `toggleReaction(channelId, messageId, { emoji, author })` ajoute la réaction de `author` si absente, la retire sinon (comparaison exacte du nom après trim) ; valable sur racines et réponses ; renvoie le message mis à jour. Erreurs : canal ou message inconnu → `MessageNotFoundError`/`ChannelNotFoundError` ; emoji hors du jeu ou author vide/trop long → `MessageValidationError`. `listMessages` renvoie des copies profondes des réactions.
- API : `POST /api/channels/:id/messages/:messageId/reactions` avec `{ emoji, author }` → 200 + message mis à jour ; 404 canal ou message inconnu ; 400 entrée invalide. Le `GET` des messages existant renvoie les réactions : le polling 3 s suffit à la synchronisation.
- Front (racines et réponses) : sous la bulle, une rangée de pastilles `data-testid="reaction"` (emoji + compteur, `title` = noms séparés par `, `, `aria-pressed="true"` et style violet si le participant courant a réagi) ; clic sur une pastille = bascule. Un bouton `data-testid="reaction-add"` (visible au survol du message ou en permanence, au choix) ouvre une palette `data-testid="reaction-picker"` des 6 emojis ; un clic bascule la réaction et ferme la palette ; Échap ou clic extérieur la ferme. Boutons désactivés sans nom d'affichage. Mise à jour locale immédiate avec la réponse du `POST`.

## Hors périmètre
- Emojis libres ou sélecteur complet, réactions sur les canaux.
- Liste détaillée des réacteurs dans une fenêtre (le `title` au survol suffit).
- Notification « X a réagi à votre message ».

## Critères d'acceptation
- [x] CA1 — `npm run test` passe et inclut des tests de `toggleReaction` : ajout (champ créé), deuxième auteur sur le même emoji (2 auteurs, ordre d'arrivée), bascule qui retire (entrée puis champ supprimés), ordre des emojis = ordre de première réaction, réaction sur une réponse, emoji hors jeu → erreur sans modification, message inconnu → erreur, et copie profonde (modifier le résultat de `listMessages` n'altère pas le store).
- [x] CA2 — Via HTTP : `POST …/reactions` `{"emoji":"👍","author":"Alice"}` puis `{"emoji":"👍","author":"Bob"}` → 200, et le `GET` des messages renvoie pour ce message `reactions: [{"emoji":"👍","authors":["Alice","Bob"]}]` ; un nouveau `POST` d'Alice sur 👍 → `authors` vaut `["Bob"]`.
- [x] CA3 — Erreurs HTTP : emoji `"🍕"` → 400 ; author vide → 400 ; messageId inconnu → 404 ; canal inconnu → 404.
- [x] CA4 — Le HTML SSR de `GET /channels/general` contient, pour le message de CA2 (après réaction d'Alice et Bob), un élément `data-testid="reaction"` affichant `👍` et `2`, avec `title="Alice, Bob"`.
- [x] CA5 — Vérification visuelle (orchestrateur, Chrome, fenêtres « Alice » et « Bob ») : Alice ajoute 👍 via la palette sur une racine et ❤️ sur une réponse ; Bob les voit en moins de 4 s, clique la pastille 👍 → compteur 2, pastille marquée chez Bob seulement ; le survol montre « Alice, Bob » ; Bob reclique → compteur 1 chez les deux ; Échap ferme la palette ; aucune erreur console.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10126 node .output/server/index.mjs &   # arrêter à la fin
J='content-type: application/json'; U=localhost:10126/api/channels
ID=$(curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Carol","text":"je redémarre le service"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
R=$U/general/messages/$ID/reactions
curl -s -o /dev/null -w '%{http_code}\n' -X POST $R -H "$J" -d '{"emoji":"👍","author":"Alice"}'   # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST $R -H "$J" -d '{"emoji":"👍","author":"Bob"}'     # 200
curl -s $U/general/messages | grep -o '"reactions":\[[^]]*\]\}\]'                                   # 👍 ["Alice","Bob"]
curl -s localhost:10126/channels/general | grep -oE 'data-testid="reaction"[^>]*' | grep -c 'title="Alice, Bob"'  # 1
curl -s -X POST $R -H "$J" -d '{"emoji":"👍","author":"Alice"}' | grep -o '"authors":\[[^]]*\]'    # ["Bob"]
curl -s -o /dev/null -w '%{http_code}\n' -X POST $R -H "$J" -d '{"emoji":"🍕","author":"Alice"}'   # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $R -H "$J" -d '{"emoji":"👍","author":" "}'       # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $U/general/messages/nope/reactions -H "$J" -d '{"emoji":"👍","author":"Alice"}'  # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST $U/nope/messages/$ID/reactions -H "$J" -d '{"emoji":"👍","author":"Alice"}'     # 404
```
(CA4 se vérifie avant le dernier `POST` d'Alice, comme dans l'ordre ci-dessus.)

## Notes d'implémentation
- Route : `server/api/channels/[id]/messages/[messageId]/reactions.post.ts`, même style que `messages.post.ts` (erreurs du store traduites en 400/404, `message:` et non `statusMessage`).
- Le store stocke les réactions sur l'objet message ; `listMessages`/`addMessage` doivent cloner `reactions` (les copies actuelles sont superficielles). Les tests `toEqual` existants restent valides car le champ est absent par défaut.
- Composant `MessageReactions.vue` (pastilles + bouton + palette) utilisé par racines et réponses dans `MessageList.vue` ; la page `[id].vue` fournit une fonction `react(messageId, emoji)` qui remplace le message dans la liste avec la réponse.
- Comparer les emojis tels quels (chaînes exactes du jeu, `❤️` inclut le sélecteur U+FE0F).
