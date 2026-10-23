# 005 — Mentions `@nom` et messages de canal tous alignés à gauche

## Pourquoi
Point 5 de specs/GOAL.md (mentions) : pendant un incident, on interpelle quelqu'un (« @Bob tu peux redémarrer ? ») et la personne doit le repérer d'un coup d'œil. On corrige en même temps la dette de 004 : dans un canal Teams, tous les messages, y compris les siens, sont à gauche avec avatar et nom.

## Périmètre
- Utilitaire pur `splitMentions(text, knownNames)` dans `app/utils/mentions.ts` : découpe le texte en segments `{ type: 'text', value }` / `{ type: 'mention', value, name }`. Une mention est un `@` placé en début de texte ou après un espace ou une ponctuation (pas `a@b.fr`), suivi d'un nom de `knownNames` (comparaison insensible à la casse, nom le plus long d'abord, pour « Alice Martin » vs « Alice ») et suivi d'une fin de texte, d'un espace ou d'une ponctuation. Un `@mot` ne correspondant à aucun nom connu reste du texte. Fonction `mentionsName(text, knownNames, me)` (ou équivalent) : vrai si une mention désigne `me` (insensible à la casse).
- Noms connus = auteurs distincts des messages du canal affiché, plus le nom d'affichage courant.
- Rendu (`MessageList.vue`, racines et réponses) : chaque mention est un `<span data-testid="mention" class="mention">@Nom</span>` en violet gras ; si elle désigne le participant courant, elle porte en plus `data-testid="mention-me"` (ou une classe `mention--me`) avec un fond coloré plus marqué, et le message qui le mentionne reçoit une marque visible (bordure gauche colorée + `data-testid="mentions-me"` sur le bloc message). Le texte reste échappé (pas de `v-html` sur le texte brut).
- Alignement : suppression du rendu « mes messages à droite » ; tous les messages, racines et réponses, sont à gauche avec avatar et nom, même bulle blanche. La règle d'auto-scroll « envoyé par soi » est conservée.

## Hors périmètre
- Autocomplétion / liste de suggestions à la frappe de `@`.
- Stockage des mentions côté serveur, compteur ou notification de mentions, onglet « Activité ».
- Mention `@canal` / `@équipe`, réactions emoji.

## Critères d'acceptation
- [x] CA1 — `npm run test` passe et inclut des tests de `splitMentions` : mention simple, mention en début et en fin de texte, nom à espaces préféré au nom court (« @Alice Martin » avec `Alice` et `Alice Martin` connus), casse différente (« @bob » → Bob), `@inconnu` laissé en texte, adresse `ops@bob.fr` non reconnue, texte sans mention (un seul segment texte) ; et de la détection « me mentionne » (vrai, faux, `me` vide → faux).
- [x] CA2 — Après `POST /api/channels/general/messages` de `{"author":"Bob","text":"salut"}` puis de `{"author":"Alice","text":"@Bob tu peux regarder ? cc ops@bob.fr"}`, le HTML SSR de `GET /channels/general` contient exactement un `data-testid="mention"` dont le contenu est `@Bob`, et le texte `ops@bob.fr` n'est pas dans un span de mention.
- [x] CA3 — Après un `POST` dont le texte est `@Bob <b>gras</b>`, le HTML SSR contient `&lt;b&gt;gras&lt;/b&gt;` et pas de balise `<b>gras</b>`.
- [x] CA4 — `app/components/MessageList.vue` ne contient plus `row-reverse` ni de règle masquant avatar/nom pour ses propres messages (`grep -nE 'row-reverse|message--mine' app/components/MessageList.vue` ne renvoie rien).
- [x] CA5 — Vérification visuelle (orchestrateur, Chrome, deux fenêtres « Alice » et « Bob ») : ses propres messages et réponses sont à gauche avec avatar et nom ; dans la fenêtre de Bob, un message d'Alice contenant `@Bob` (racine et réponse en fil) affiche la mention avec fond marqué et le message porte la bordure de mise en évidence ; dans la fenêtre d'Alice, la même mention est en violet sans mise en évidence forte ; aucune erreur console.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10125 node .output/server/index.mjs &   # arrêter à la fin
J='content-type: application/json'; U=localhost:10125/api/channels
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Bob","text":"salut"}' >/dev/null
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Alice","text":"@Bob tu peux regarder ? cc ops@bob.fr"}' >/dev/null
curl -s localhost:10125/channels/general | grep -oE 'data-testid="mention"[^>]*>[^<]*' | wc -l     # 1
curl -s localhost:10125/channels/general | grep -oE 'data-testid="mention"[^>]*>[^<]*'             # ...>@Bob
curl -s -X POST $U/general/messages -H "$J" -d '{"author":"Alice","text":"@Bob <b>gras</b>"}' >/dev/null
curl -s localhost:10125/channels/general | grep -c '&lt;b&gt;gras&lt;/b&gt;'    # >= 1
curl -s localhost:10125/channels/general | grep -c '<b>gras</b>'                # 0
grep -nE 'row-reverse|message--mine' app/components/MessageList.vue             # rien
```

## Notes d'implémentation
- `app/utils/mentions.ts` sans auto-import Nuxt (testé directement par Vitest, comme `initials.ts`) ; tests dans `tests/mentions.test.ts`. Échapper les noms avant de construire une RegExp, ou parcourir le texte sans RegExp.
- Rendu des segments via `v-for` + `<span>` / texte interpolé ; extraire au besoin un petit composant `MessageText.vue` utilisé par racines et réponses.
- Le nom courant est vide au SSR : `mention-me` n'apparaît que côté client, c'est attendu (vérifié en CA5).
- Garder `isMine` pour l'auto-scroll ; retirer seulement les styles et la classe `message--mine`.
