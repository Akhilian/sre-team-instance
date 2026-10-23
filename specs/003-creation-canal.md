# 003 — Création d'un canal par un participant, fil ancré en bas

## Pourquoi
Point 4 de specs/GOAL.md : un participant doit pouvoir créer un canal (ex. un canal dédié à un second incident) visible par tous. On en profite pour corriger deux dettes de la boucle 002 : le fil doit être ancré en bas comme dans Teams, et les erreurs API doivent utiliser `message` plutôt que `statusMessage`.

## Périmètre
- Store : `addChannel(input: { name?: unknown })` dans `server/utils/chat-store.ts`. Nom nettoyé (trim), 1 à 50 caractères ; `id` dérivé du nom (minuscules, accents retirés, tout caractère hors `[a-z0-9]` remplacé par `-`, tirets en double ou en bord supprimés). Id vide après normalisation → erreur de validation ; id déjà existant → erreur de conflit. Le nouveau canal est ajouté en fin de liste, sans message.
- API : `POST /api/channels` avec `{ "name": "…" }` → 201 et `{ id, name }` ; 400 si invalide ; 409 si un canal de même id existe.
- Toutes les routes API passent à `createError({ statusCode, message })` (plus de `statusMessage`).
- Interface : bouton « + » / « Créer un canal » dans le panneau des canaux (`data-testid="create-channel"`), ouvrant un petit formulaire (nom) ; après succès, la liste est rafraîchie et l'utilisateur est redirigé vers `/channels/<id>`. Erreur 409/400 affichée dans le formulaire.
- Le polling existant rafraîchit aussi la liste des canaux, pour qu'un canal créé ailleurs apparaisse en quelques secondes.
- Fil de messages ancré en bas : au chargement, à l'envoi et à l'arrivée de nouveaux messages, la zone défile jusqu'au dernier message, sauf si l'utilisateur a remonté le fil (à plus d'environ 100 px du bas).

## Hors périmètre
- Renommage, suppression, archivage ou canaux privés ; description de canal ; plusieurs équipes.
- Limite du nombre de canaux, persistance, SSE.
- Réponses en fil, mentions, réactions.

## Critères d'acceptation
- [x] CA1 — `POST /api/channels` avec `{"name":"Incident Base de Données"}` répond 201 et `{"id":"incident-base-de-donnees","name":"Incident Base de Données"}` ; `GET /api/channels` le liste ensuite en dernière position ; `GET /api/channels/incident-base-de-donnees/messages` répond 200 et `[]`.
- [x] CA2 — `POST /api/channels` répond 400 pour `{}`, `{"name":"   "}`, `{"name":"!!!"}` et un nom de 51 caractères ; il répond 409 pour `{"name":"general"}` et pour un second envoi de `{"name":"Incident base de donnees"}`. Aucun de ces appels ne modifie la liste des canaux.
- [x] CA3 — Après CA1, `GET /channels/incident-base-de-donnees` répond 200, et le HTML SSR de `GET /channels/general` contient un lien `href="/channels/incident-base-de-donnees"` ainsi qu'un élément `data-testid="create-channel"`.
- [x] CA4 — `npm run test` passe et inclut des tests de `addChannel` : id normalisé (accents, espaces, ponctuation), nom trop long ou vide refusé, doublon refusé, canal créé listé et capable de recevoir un message.
- [x] CA5 — Plus aucune occurrence de `statusMessage` dans `server/` ; le corps JSON d'une erreur 400 de `POST /api/channels/general/messages` (corps `{}`) contient le texte de validation (ex. `author est obligatoire`) dans le champ `message`.
- [x] CA6 — Lecture du code : le polling de `app/pages/channels/[id].vue` rafraîchit aussi `/api/channels`, et le fil défile vers le bas après mise à jour des messages (`scrollTop`/`scrollIntoView` dans un `watch` + `nextTick` ou équivalent), conditionné à la proximité du bas. Vérification visuelle (orchestrateur, Chrome) : avec plus de messages que la hauteur de l'écran, le dernier message est visible au chargement et après un envoi ; un canal créé dans une fenêtre apparaît dans la liste de l'autre en moins de 5 s.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10124 node .output/server/index.mjs &   # arrêter à la fin
curl -s -w ' %{http_code}\n' -X POST localhost:10124/api/channels -H 'content-type: application/json' -d '{"name":"Incident Base de Données"}'   # 201
curl -s localhost:10124/api/channels                                                # dernier = incident-base-de-donnees
curl -s -w ' %{http_code}\n' localhost:10124/api/channels/incident-base-de-donnees/messages   # [] 200
for b in '{}' '{"name":"   "}' '{"name":"!!!"}' "{\"name\":\"$(printf 'a%.0s' {1..51})\"}"; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10124/api/channels -H 'content-type: application/json' -d "$b"; done   # 400 x4
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10124/api/channels -H 'content-type: application/json' -d '{"name":"general"}'                   # 409
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10124/api/channels -H 'content-type: application/json' -d '{"name":"Incident base de donnees"}'  # 409
curl -s localhost:10124/api/channels | grep -o '"id"' | wc -l                       # 3
curl -s -o /dev/null -w '%{http_code}\n' localhost:10124/channels/incident-base-de-donnees   # 200
curl -s localhost:10124/channels/general | grep -oE 'href="/channels/incident-base-de-donnees"|data-testid="create-channel"' | sort -u   # 2 lignes
curl -s -X POST localhost:10124/api/channels/general/messages -H 'content-type: application/json' -d '{}'   # "message" contient "author est obligatoire"
grep -rn statusMessage server/ ; echo "exit=$?"                                     # aucune ligne, exit=1
grep -nE 'api/channels|scrollTop|scrollIntoView|nextTick' 'app/pages/channels/[id].vue' app/components/*.vue
```

## Notes d'implémentation
- Normalisation de l'id : `name.normalize('NFD').replace(/[̀-ͯ]/g, '')` puis minuscules et remplacement ; exporter `slugifyChannelName` pur pour les tests. Nouvelle classe `ChannelConflictError` à côté de `MessageValidationError`.
- Fichiers : `server/utils/chat-store.ts`, nouveau `server/api/channels/index.post.ts`, routes existantes (`statusMessage` → `message`), `app/components/ChannelList.vue` (formulaire, émet `created`), `app/pages/channels/[id].vue` (refresh des canaux dans le polling, `navigateTo`), `app/components/MessageList.vue` (ref sur le conteneur défilant), `tests/chat-store.test.ts`.
- La page 404 côté page (`createError` dans `[id].vue`) peut garder `statusMessage` : seul `server/` est visé par CA5.
- Canal créé pendant le rendu : la vérification canal inconnu de `[id].vue` s'appuie sur `useFetch('/api/channels')`, donc un canal juste créé est trouvé sans changement.
