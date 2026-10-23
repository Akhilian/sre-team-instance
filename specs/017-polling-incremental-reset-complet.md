# 017 — Polling incrémental, non-lus monotones et reset complet

## Pourquoi
C'est le lot « 017 » du rapport `specs/015-revue-phase1.md` (M1, M2, B6, B8), auquel s'ajoute la dette de 016. Aujourd'hui, chaque client recharge tous les messages toutes les 3 s, et le reset ne retire ni les canaux de test ni la présence. Depuis le plafond de 2000 messages (FIFO), `messageCount` ne bouge plus une fois atteint, si bien que les non-lus restent figés. Il faut régler ces points avant que les PNJ (phase 2) ne fassent grossir le volume.

## Périmètre
- **Curseur de révision** : le store tient un compteur global `rev`, entier et monotone. Chaque création ou modification de message (nouveau message, réponse, annonce, alerte, bascule de réaction, changement de statut d'alerte) l'incrémente et l'inscrit dans le champ `Message.rev`. Ni l'éviction ni le reset ne le font jamais reculer.
- **Compteur monotone par canal** : `ChannelSummary.totalCount` donne le nombre de messages jamais publiés dans le canal. Ni l'éviction FIFO ni aucun reset ne le décrémentent. Les compteurs ne sont pas rattachés à la vie du canal : un canal supprimé puis recréé avec le même slug reprend son ancien compteur. `messageCount` reste le nombre de messages présents.
- **Instantané v2** : il ajoute `rev` et `totalCounts`. Un instantané v1 reste accepté : `rev` est alors attribué dans l'ordre des messages, et `totalCounts` prend le nombre de messages présents.
- **`GET /api/channels/:id/messages?since=<rev>`** renvoie `{ rev, full, messages }` :
  - cas normal : seulement les messages dont `rev > since`, triés par `rev` croissant, avec `full: false` ;
  - `full: true` avec la liste complète quand le curseur n'est plus valable : `since` antérieur au dernier reset ou à la dernière éviction de ce canal, ou `since` supérieur au `rev` courant (redémarrage sans persistance) ;
  - un `since` absent garde la réponse actuelle (un tableau). Un `since` non entier ou négatif renvoie 400.
- **Front, `app/pages/channels/[id].vue`** :
  - le poll fusionne les messages reçus par id (remplacement s'il existe, ajout sinon), puis ne garde que les 2000 derniers ;
  - `full: true` remplace la liste entière ;
  - le curseur repart de zéro à chaque changement de canal ;
  - les mutations locales (envoi, réaction, statut) ne sont plus suivies d'un rechargement complet ;
  - polling suspendu quand `document.hidden` (ni messages, ni canaux, ni présence) ; au retour sur l'onglet, un poll immédiat rattrape tout, puis l'intervalle de 3 s reprend ;
  - après une erreur réseau ou 5xx, l'intervalle double à chaque échec jusqu'à 30 s, et revient à 3 s au premier succès ;
  - un 404 sur le canal courant (canal supprimé) renvoie vers `/channels/incident-en-cours`.
- **Non-lus, `app/utils/unread.ts`** : le calcul passe sur `totalCount`. Un compteur en baisse (redémarrage sans persistance) réaligne sans rien compter, comme aujourd'hui. B8 est corrigé de fait, puisque le reset ne fait plus baisser le compteur.
- **Reset, `POST /api/admin/reset`**, avec un corps optionnel `{ scope: "messages" | "all" }` (défaut `messages`, comportement actuel) :
  - `messages` : arrête le scénario et efface les messages, en conservant les canaux et la présence ;
  - `all` (« complet ») : arrête le scénario, ramène les canaux à `DEFAULT_CHANNELS` (les canaux créés par les participants sont supprimés), efface les messages et vide la présence (`resetPresenceStore`) ;
  - le limiteur de débit et le code animateur ne changent pas ;
  - l'état qui en résulte est persisté ;
  - la réponse vaut `{ cleared: true, scope }`. Tout autre `scope` renvoie 400.
- **`/admin`** : deux boutons, chacun avec sa confirmation. « Effacer les messages » (`data-testid="reset"`) annonce que les canaux sont conservés. « Tout réinitialiser » (`data-testid="reset-all"`) annonce que les canaux des participants, les messages et la présence seront supprimés et que le scénario sera arrêté.
- **B6** : `mentionsMe` est calculé une seule fois par liste (`computed` vers une `Map<id, boolean>`) dans `MessageList.vue`.

## Hors périmètre
- SSE, WebSocket, ETag/304, ainsi que le polling incrémental de `GET /api/channels` et de la présence : leurs réponses sont petites.
- Supprimer un canal à l'unité, ou purger l'instantané persistant hors reset.
- Les points B1 à B5, B7, B9 à B11 (lot 018).

## Critères d'acceptation
- [x] CA1 — Tests unitaires du store :
  - `rev` augmente strictement à chaque création, réaction et statut d'alerte ;
  - après 2005 `addMessage`, `totalCount` vaut 2005 (et `messageCount` 2000) ;
  - après `clearMessages` puis un reset `all`, `totalCount` ne baisse pas et `rev` ne recule pas ;
  - un instantané v2 exporté puis importé restitue `rev`, `totalCounts` et `Message.rev` ;
  - un instantané v1 est accepté.
- [x] CA2 — Tests unitaires de `computeUnread` sur `totalCount` :
  - un canal non courant qui passe de 2000 à 2003 compte 3 non-lus alors que `messageCount` reste à 2000 ;
  - après un reset suivi de 2 nouveaux messages, le canal compte 2 non-lus (B8) ;
  - un compteur en baisse réaligne sans compter.
- [x] CA3 — Test HTTP, `?since` : un poll avec le `rev` reçu ne renvoie aucun message s'il ne s'est rien passé. Après un nouveau message, une réponse en fil, une réaction sur un ancien message et un acquittement d'alerte, le poll suivant renvoie exactement ces 4 messages à jour (`full: false`). Après un `POST /api/admin/reset`, l'ancien curseur donne `full: true` avec une liste vide. `since=999999999` donne `full: true`, `since=abc` donne 400, et un appel sans `since` renvoie toujours un tableau.
- [x] CA4 — Test HTTP, reset. Situation de départ : un canal créé par un participant, un message dans `general` et une présence active.
  - `scope: "messages"`, ou pas de corps du tout : le canal créé est conservé ;
  - `scope: "all"` : `GET /api/channels` ne renvoie plus que `general` et `incident-en-cours`, `GET` sur les messages du canal créé renvoie 404, et un nouveau `POST /api/presence` d'un autre nom ne voit que lui-même ;
  - un scénario lancé est arrêté (`GET /api/admin/scenarios` ne signale plus rien en cours) ;
  - `scope: "x"` renvoie 400.
- [x] CA5 — Chrome, vérifié par l'orchestrateur sur le build :
  - en régime établi, les requêtes de messages portent `?since=` et renvoient `messages: []` quand rien ne bouge ;
  - onglet caché (un autre onglet au premier plan pendant 10 s) : aucune requête vers `/api/` ;
  - au retour, un message posté entre-temps depuis un second navigateur apparaît en moins d'une seconde, et la pastille de non-lus d'un autre canal augmente.
- [x] CA6 — Chrome, `/admin` : les deux boutons sont présents. Avec un participant ouvert sur un canal qu'il a créé, « Tout réinitialiser » retire ce canal de sa liste et le renvoie vers `incident-en-cours` en moins de 6 s, sans erreur dans la console. « Effacer les messages » conserve les canaux.

## Vérification
```bash
npm test
npm run build && npm run test:http
# Contrôle manuel
FACILITATOR_CODE=animateur PORT=3999 node .output/server/index.mjs > /tmp/srv.log 2>&1 &
sleep 2
R=$(curl -s 'localhost:3999/api/channels/general/messages?since=0' | node -pe 'JSON.parse(require("fs").readFileSync(0)).rev')
curl -s -X POST -H 'content-type: application/json' -d '{"author":"a","text":"x"}' localhost:3999/api/channels/general/messages >/dev/null
curl -s "localhost:3999/api/channels/general/messages?since=$R"           # 1 message, full:false
curl -s -X POST -H 'content-type: application/json' -d '{"name":"Test"}' localhost:3999/api/channels
curl -s -X POST -H 'x-facilitator-code: animateur' -H 'content-type: application/json' -d '{"scope":"all"}' localhost:3999/api/admin/reset
curl -s localhost:3999/api/channels                                      # general, incident-en-cours ; totalCount conservé
kill %1
```
Chrome (orchestrateur) : CA5 et CA6, onglet Réseau ouvert, deux profils ou deux fenêtres.

## Notes d'implémentation
- `server/utils/chat-store.ts` : `rev`, `totalCounts: Map<string, number>` et `resetRev` par canal (rev du dernier reset ou de la dernière éviction) pour décider de `full`. `resetChatStore` doit rester une vraie remise à zéro pour les tests. Prévoir une fonction `resetAll()` distincte qui garde les compteurs.
- Type de réponse `MessagesDelta` dans `shared/types/chat.ts` ; `Message.rev` obligatoire côté serveur.
- `server/api/admin/reset.post.ts` : `readBody` tolère un corps vide. Le middleware 413 de 016 accepte déjà un `POST` avec `content-length: 0`, à confirmer dans le test.
- Pause et rattrapage : `visibilitychange` dans la page canal, une seule fonction `pollOnce()` dédoublonnée, et un `setTimeout` réarmé à chaque tour (pas de `setInterval`), pour l'intervalle variable.
