# 004 — Réponses en fil façon Teams

## Pourquoi
Point 5 de specs/GOAL.md : pendant un exercice d'incident, les échanges se structurent par sujet (« diagnostic BDD », « communication client »). Dans un canal Teams, chaque publication est un message racine sous lequel on répond ; c'est la première brique de confort de discussion, et le modèle de données dont dépendront mentions et réactions.

## Périmètre
- Type `Message` (`shared/types/chat.ts`) : champ optionnel `parentId?: string`, absent pour un message racine.
- Store : `addMessage(channelId, { author, text, parentId? })`. Si `parentId` est fourni, il doit être une chaîne désignant un message **racine** existant du **même canal** ; sinon `MessageValidationError` (donc 400) et rien n'est ajouté. Un seul niveau de fil : répondre à une réponse est refusé.
- API : `POST /api/channels/:id/messages` accepte `parentId` ; `GET` renvoie toujours la liste plate chronologique (les réponses portent `parentId`).
- Utilitaire pur `groupThreads(messages)` dans `app/utils/threads.ts` : renvoie les racines dans l'ordre chronologique, chacune avec ses `replies` triées chronologiquement ; une réponse dont la racine est absente est ignorée.
- Interface (`MessageList.vue`) : chaque racine est rendue comme un bloc fil (`data-testid="thread"`) ; ses réponses sont affichées en dessous, indentées et plus compactes (`data-testid="reply"`) ; sous chaque fil, un lien « Répondre » (`data-testid="reply-button"`) ouvre un champ de réponse inline (`data-testid="reply-composer"`, Entrée envoie, Échap ferme) qui poste avec `parentId`.
- Le composer du bas continue de créer des messages racines. Le défilement automatique vers le bas ne se déclenche que pour une nouvelle **racine** (une réponse arrivée dans un fil ancien ne fait pas sauter le fil).

## Hors périmètre
- Regroupement visuel des messages consécutifs d'un même auteur : dans un canal Teams, chaque publication est un bloc distinct ; reporté (éventuellement à l'intérieur des réponses) à une boucle ultérieure.
- Repli/dépli des fils (« Voir N réponses »), compteur de non-lus, édition ou suppression.
- Mentions, réactions, notifications.

## Critères d'acceptation
- [x] CA1 — Sur `general`, après un `POST` racine (201, réponse sans `parentId`), un `POST` avec `{"author":"Bob","text":"Je regarde","parentId":"<id racine>"}` répond 201 et le message renvoyé contient `"parentId":"<id racine>"` ; `GET /api/channels/general/messages` liste les deux messages, la réponse portant ce `parentId`.
- [x] CA2 — `POST /api/channels/general/messages` répond 400 et n'ajoute rien pour : `parentId` inconnu, `parentId` non-chaîne (ex. `123`), `parentId` d'une réponse (fil à deux niveaux), `parentId` d'un message racine d'un autre canal (`incident-en-cours`). Le nombre de messages de `general` est inchangé après ces appels.
- [x] CA3 — `npm run test` passe et inclut : des tests de `addMessage` avec `parentId` (cas valide et les 4 refus de CA2), et des tests de `groupThreads` (ordre des racines, réponses rattachées et triées, réponse orpheline ignorée, liste vide).
- [x] CA4 — Après CA1, le HTML SSR de `GET /channels/general` contient au moins un `data-testid="thread"`, un `data-testid="reply"` dont le bloc contient le texte `Je regarde`, et un `data-testid="reply-button"`.
- [x] CA5 — Vérification visuelle (orchestrateur, Chrome, deux fenêtres avec deux noms) : un clic sur « Répondre » ouvre le champ inline ; la réponse envoyée s'affiche sous sa racine, indentée, dans les deux fenêtres en moins de 5 s ; un message envoyé par le composer du bas apparaît comme nouveau fil en bas ; répondre à un fil ancien, fil remonté, ne fait pas défiler la vue jusqu'en bas ; aucune erreur console.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10124 node .output/server/index.mjs &   # arrêter à la fin
J='content-type: application/json'; U=localhost:10124/api/channels
ROOT=$(curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Alice","text":"Latence API en hausse"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
REPLY=$(curl -s -X POST $U/general/messages -H "$J" -d "{\"author\":\"Bob\",\"text\":\"Je regarde\",\"parentId\":\"$ROOT\"}"); echo "$REPLY"   # contient parentId = $ROOT
RID=$(echo "$REPLY" | sed -E 's/.*"id":"([^"]+)".*/\1/')
OTHER=$(curl -s -X POST $U/incident-en-cours/messages -H "$J" -d '{"author":"Alice","text":"ailleurs"}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
for p in '"inconnu"' '123' "\"$RID\"" "\"$OTHER\""; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $U/general/messages -H "$J" -d "{\"author\":\"Bob\",\"text\":\"x\",\"parentId\":$p}"; done   # 400 x4
curl -s $U/general/messages | grep -o '"author"' | wc -l      # 2
curl -s localhost:10124/channels/general | grep -oE 'data-testid="(thread|reply|reply-button)"|Je regarde' | sort -u   # 4 lignes
grep -n parentId shared/types/chat.ts server/utils/chat-store.ts app/utils/threads.ts
```

## Notes d'implémentation
- Validation `parentId` dans `addMessage` (`server/utils/chat-store.ts`) : chercher dans `messagesByChannel.get(channelId)` ; refuser si introuvable ou si la cible a elle-même un `parentId`. N'inclure `parentId` dans l'objet stocké que s'il est fourni (les racines restent sans champ, tests existants intacts).
- `messages.post.ts` n'a rien à changer si l'objet `body` est transmis tel quel ; vérifier.
- `MessageList.vue` consomme `groupThreads` ; extraire au besoin `ThreadItem.vue` / `ReplyComposer.vue`. La page passe une fonction `reply(parentId, text)` comme elle passe déjà `send`.
- Auto-scroll : remplacer la surveillance de `messages.at(-1)` par celle de la dernière racine (`groupThreads(...).at(-1)?.id`) ; garder la règle « ≤ 100 px du bas ou envoyé par soi ».
- Ses propres messages restent à droite en violet clair ; les réponses suivent la même règle à l'intérieur du fil.
