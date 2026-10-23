# 011 — Cartes d'alerte façon connecteur « Alerting » et acquittement par les participants

## Pourquoi
L'atelier porte sur le paging : un incident commence par une alerte. Permettre à l'animateur de poster dans un canal une carte d'alerte (sévérité, service, statut) que les participants acquittent puis résolvent rend l'exercice réaliste, en réutilisant les outils d'animateur (point 6 de GOAL.md) et le polling existant.

## Périmètre
- Type partagé : `Message.kind` accepte `'alert'` en plus de `'announcement'` ; champ optionnel `alert` : `{ severity: 'SEV1'|'SEV2'|'SEV3', title, service, status: 'triggered'|'acknowledged'|'resolved', acknowledgedBy?, acknowledgedAt?, resolvedBy?, resolvedAt? }`. `text` = description courte, `author` = `"Alerting"` (constante exportée du store).
- `POST /api/admin/alerts` (en-tête `x-facilitator-code`, 401 sinon, vérifié avant le corps) `{ channelId, severity, title, service, text }` → 201 + message racine `status: 'triggered'`. 400 si corps non-objet, `channelId` absent/vide, `severity` hors liste, `title`/`service`/`text` vides ou trop longs (`title` ≤ 120, `service` ≤ 60, `text` ≤ limite actuelle) ; 404 si canal inconnu.
- `POST /api/channels/:id/messages/:messageId/alert-status` (sans code animateur) `{ status: 'acknowledged'|'resolved', name }` → 200 + message à jour. Transitions : `triggered → acknowledged`, `triggered|acknowledged → resolved` (renseigne `…By` = `name` et `…At` = ISO). 400 si `status`/`name` invalides ou si le message n'est pas une alerte ; 404 canal/message inconnu ; 409 si transition interdite (déjà acquittée, déjà résolue).
- `/admin` : formulaire « Publier une alerte » (canal, sévérité en `<select>`, titre, service, description) avec retour succès/erreur comme pour l'annonce.
- Carte dans `MessageList` (`data-testid="alert-card"`, attribut `data-status`) : bande colorée par sévérité (SEV1 rouge, SEV2 orange, SEV3 jaune/ambre), libellé sévérité, titre, service, description, badge de statut en français (« Déclenchée » / « Acquittée » / « Résolue »), ligne « Acquittée par X à HH:MM » / « Résolue par X à HH:MM ». Boutons « Acquitter » (`data-testid="alert-ack"`, si déclenchée) et « Résoudre » (`data-testid="alert-resolve"`, si non résolue), pour tout participant nommé ; mise à jour optimiste ou rechargement, puis synchronisation par le polling. Réponses en fil et réactions restent disponibles sur la carte.

## Hors périmètre
- Escalade, réassignation, astreinte, notification sonore, désacquittement, réouverture d'une alerte résolue.
- Scénario d'alertes pré-écrit ou planifié ; alertes envoyées par un système externe (webhook).
- Persistance au-delà de la mémoire ; la réinitialisation existante supprime aussi les alertes (comportement par défaut).

## Critères d'acceptation
- [x] CA1 — Tests Vitest du store : création d'alerte valide (`kind: 'alert'`, `status: 'triggered'`, auteur `Alerting`), rejet des entrées invalides (sévérité inconnue, titre vide), transitions autorisées (ack puis resolve, resolve direct) avec `…By`/`…At` renseignés, transitions interdites (ack d'une alerte acquittée ou résolue, resolve d'une résolue) et changement de statut sur un message ordinaire → erreurs distinctes.
- [x] CA2 — Via HTTP : `POST /api/admin/alerts` sans code → 401 ; avec code `animateur` : `{}` → 400, `severity:"SEV9"` → 400, `channelId:"nope"` → 404, alerte valide sur `incident-en-cours` → 201 et elle apparaît dans `GET /api/channels/incident-en-cours/messages` avec `alert.status = "triggered"`.
- [x] CA3 — Via HTTP sur cette alerte : `alert-status {status:"acknowledged",name:"Bob"}` → 200 avec `acknowledgedBy:"Bob"` et `acknowledgedAt` ; même requête rejouée → 409 ; `{status:"resolved",name:"Alice"}` → 200 (`resolvedBy:"Alice"`) ; `{status:"acknowledged",name:""}` → 400 ; sur un message ordinaire → 400 ; `messageId` inconnu → 404. Une réaction (`POST …/reactions`) et une réponse (`parentId` = id de l'alerte) sur l'alerte → 200/201.
- [x] CA4 — Le HTML SSR de `GET /channels/incident-en-cours` après création d'une alerte contient `data-testid="alert-card"`, le titre, le service, le libellé de sévérité et « Déclenchée ».
- [x] CA5 — Vérification dans Chrome (orchestrateur), deux navigateurs/profils : l'animateur publie une alerte SEV1 depuis `/admin` ; elle s'affiche en carte à bande rouge dans les deux fenêtres en ≤ 5 s ; Bob clique « Acquitter » → chez Alice, sans recharger, le badge passe à « Acquittée » et « Acquittée par Bob à HH:MM » s'affiche, le bouton « Acquitter » disparaît ; « Résoudre » fait passer à « Résolue » partout ; réaction et réponse en fil fonctionnent sur la carte ; aucune erreur console ni avertissement d'hydratation ; à 375 px la carte ne provoque pas de défilement horizontal.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10131 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; F='x-facilitator-code: animateur'; B=localhost:10131/api
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/alerts -H "$J" -d '{}'                                  # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/alerts -H "$J" -H "$F" -d '{}'                          # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/alerts -H "$J" -H "$F" -d '{"channelId":"incident-en-cours","severity":"SEV9","title":"t","service":"s","text":"x"}'  # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/admin/alerts -H "$J" -H "$F" -d '{"channelId":"nope","severity":"SEV1","title":"t","service":"s","text":"x"}'               # 404
ID=$(curl -s -X POST $B/admin/alerts -H "$J" -H "$F" -d '{"channelId":"incident-en-cours","severity":"SEV1","title":"Taux d erreur 5xx > 20 %","service":"checkout-api","text":"Erreurs 5xx en hausse depuis 10 min"}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
S=$B/channels/incident-en-cours/messages/$ID/alert-status
curl -s -X POST $S -H "$J" -d '{"status":"acknowledged","name":"Bob"}'                                            # 200, acknowledgedBy Bob
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H "$J" -d '{"status":"acknowledged","name":"Bob"}'           # 409
curl -s -X POST $S -H "$J" -d '{"status":"resolved","name":"Alice"}'                                              # 200, resolvedBy Alice
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/channels/incident-en-cours/messages/inconnu/alert-status -H "$J" -d '{"status":"resolved","name":"A"}'  # 404
curl -s localhost:10131/channels/incident-en-cours | grep -o 'data-testid="alert-card"' | head -1
```
Compléter CA3 (message ordinaire → 400, nom vide → 400, réaction + réponse sur l'alerte) avec des requêtes similaires, puis CA5 dans Chrome.

## Notes d'implémentation
- Store `server/utils/chat-store.ts` : `addAlert(channelId, input)` et `setAlertStatus(channelId, messageId, input)` ; nouvelle classe `AlertTransitionError` → 409 ; `copyMessage` doit copier en profondeur `alert`. Valider `channelId` dans la route avant le store (comme l'annonce).
- Types et constantes de sévérité/statut dans `shared/` (`shared/utils/alerts.ts` : listes, libellés FR, couleurs) pour servir au front et aux tests.
- Front : composant `app/components/AlertCard.vue` rendu dans la bulle de `MessageList.vue` quand `kind === 'alert'` ; action passée en prop comme `react` depuis `[id].vue`. Heure via le formatage déjà utilisé pour l'horodatage.
- `/admin` : réutiliser le code animateur saisi et le motif `run(action)` existant.
