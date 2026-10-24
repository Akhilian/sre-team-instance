# 030 — Cycle de vie scénario et PNJ

## Pourquoi
C'est le lot 2 du rapport `specs/028-revue-phase2.md` (M2, M3, M5, B2), auquel s'ajoute la dette de 029. Aujourd'hui, l'animateur ne peut pas enchaîner deux groupes ou deux scénarios sans laisser derrière lui des PNJ actifs, des conversations mortes ou des incidents mélangés. L'objectif de la phase 2 (`specs/GOAL.md`) demande pourtant que l'animateur « active les PNJ avec le scénario » et « peut les couper ». Échelle : 15 participants, la performance n'est pas un enjeu.

## Périmètre
- **Arrêt (M2).** `POST /api/admin/scenarios/stop` accepte un corps facultatif `{ disableNpcs?: boolean }`, qui vaut `true` par défaut. Par défaut, l'arrêt coupe donc aussi les PNJ (réponses en attente annulées). Avec `false`, il les laisse actifs. Dans `/admin`, une case « Couper aussi les PNJ », cochée par défaut, accompagne le bouton « Arrêter ».
- **Démo (M2).** Lancer `demo-express` sélectionne toujours les PNJ de `panne-checkout` et publie le message de Sarah, mais laisse les PNJ **coupés**. Le scénario porte un champ facultatif `enableNpcs: false` que lit la route `start`.
- **Lancement sur des messages existants (M5).** Avant de lancer, `POST /api/admin/scenarios/:id/start` compte les messages présents dans tous les canaux. S'il y en a au moins un et que le corps ne contient pas `existingMessages`, la route renvoie 409 avec `data: { reason: 'messages-exist', messageCount }`, sans rien lancer. Avec `existingMessages: 'clear'`, elle fait l'équivalent de « Effacer les messages » (scope `messages`) avant de lancer. Avec `'keep'`, elle lance sans rien effacer. S'il n'y a aucun message, le corps n'est pas nécessaire. Sur ce 409, `/admin` affiche « N messages existent » et propose « Effacer et lancer », « Lancer sans effacer » et « Annuler ».
- **Conversations directes (M3, B2).** `DirectChannel` reçoit le champ `npcName`, renseigné à la création et accepté à l'import d'un instantané (on se rabat sur l'id du PNJ s'il manque). `[id].vue` et `ChannelList.vue` lisent ce champ au lieu de découper `name` sur « ↔ ». Le bandeau « X n'est pas disponible pour le moment » s'affiche, et le composeur est désactivé, dans deux cas : les PNJ sont coupés, ou `direct.npcId` ne fait pas partie de `npcState.npcs` (PNJ d'un autre scénario). `clearMessages()` supprime les canaux `direct`, ce qui couvre « Effacer les messages » et `existingMessages: 'clear'`.
- **Dette 029.** « Tout réinitialiser » (`scope: all`) remet `lastModelCall` à `null`. Au chargement d'une source (démarrage ou rechargement), quand deux fiches portent le même id, la **première dans l'ordre des chemins** l'emporte. L'autre est écartée avec un message qui cite le chemin retenu. C'est la règle déjà appliquée à l'édition en ligne (la première fiche en place garde l'id).

## Hors périmètre
- Les PNJ affichés sur les cartes de scénario, la checklist d'avant séance, la vue des conversations PNJ (M4) et le découpage d'`admin.vue` (M6) : tout cela relève de la boucle 031.
- Le refus côté serveur d'un message envoyé dans une conversation directe avec un PNJ inactif : le blocage se fait seulement dans l'interface.
- L'extraction de composables depuis `[id].vue` (B5).

## Critères d'acceptation
- [x] CA1 — Tests HTTP sur le build. Après le lancement de `panne-checkout`, un `stop` sans corps donne `GET /api/admin/npcs` → `enabled: false`. Après un nouveau lancement (`existingMessages: 'clear'`), un `stop` avec `{ disableNpcs: false }` donne `enabled: true`. Après le lancement de `demo-express`, on obtient `enabled: false` et `scenarioId: 'panne-checkout'`, et le message `[Démo] Ici Sarah…` figure dans `incident-en-cours`.
- [x] CA2 — Tests HTTP sur le build. On publie un message, puis on fait `start` sans corps : la réponse est 409, avec `data.reason === 'messages-exist'` et `data.messageCount >= 1`, et `GET /api/admin/scenarios` renvoie `run: null`. Avec `existingMessages: 'keep'`, on obtient 201 et l'ancien message est toujours là. Après `stop`, `start` avec `'clear'` donne 201 et `incident-en-cours` ne contient plus que les messages du nouveau scénario. Sur un store vide, `start` sans corps donne 201.
- [x] CA3 — Tests unitaires (`tests/chat-store.test.ts`) et HTTP. Après `clearMessages()`, les canaux `direct` ont disparu et les canaux d'équipe ainsi que ceux créés par les participants restent. Côté HTTP : après `POST /api/direct`, `GET /api/channels?participant=` liste la conversation avec `direct.npcName` égal au nom du PNJ. Après `reset {scope: messages}`, elle n'est plus listée et `GET /api/channels/<dm>/messages` renvoie 404. Un instantané v2 dont le `direct` n'a pas de `npcName` s'importe quand même.
- [x] CA4 — Tests (unitaires et HTTP). `tests/npc-persona-source.test.ts` : avec `a/x.md` et `b/x.md` valides, toutes deux d'id `x`, `a/x.md` est chargée et `b/x.md` est écartée avec un message qui contient `a/x.md`. `tests/http/npc-anthropic.test.ts` : après un appel réussi au modèle, `reset {scope: all}` donne `GET /api/admin/npcs` → `lastModelCall: null`.
- [x] CA5 — Chrome (orchestrateur), sur le build. (a) On lance `panne-checkout`, un participant ouvre une conversation directe avec Julien Moreau, puis on lance `fuite-donnees` avec « Lancer sans effacer » (la confirmation s'affiche avec le nombre de messages). Par l'URL, la conversation avec Julien affiche le bandeau « Julien Moreau n'est pas disponible pour le moment » et le composeur est désactivé. (b) Dans `/admin`, « Arrêter » avec la case cochée fait passer l'interrupteur « PNJ actifs » sur coupé. (c) « Effacer les messages » fait disparaître la conversation directe de la liste du participant.

## Vérification
```
npm test
npm run build && npm run test:http
# CA5 : FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=0 node .output/server/index.mjs
#       puis /admin et /channels/incident-en-cours dans deux onglets
```

## Notes d'implémentation
- Fichiers : `server/api/admin/scenarios/stop.post.ts` et `[id]/start.post.ts`, `server/scenarios/demo-express.ts`, `shared/types/scenario.ts` (`enableNpcs`), `server/utils/chat-store.ts` (`clearMessages`, `addDirectChannel`, `isValidDirect`), `server/utils/npc.ts` (`resetNpcs` remet `lastModelCall` à null), `server/npc/persona-source.ts` (`validateCandidates`), `app/pages/admin.vue`, `app/pages/channels/[id].vue`, `app/components/ChannelList.vue`.
- `existingMessages` doit être traité avant `startScenario` : l'étape `at: 0` (lanceur d'alerte) est publiée pendant le lancement.
- Les tests HTTP qui lancent déjà un scénario après avoir publié des messages doivent passer `existingMessages` : on les met à jour, sans contourner le 409.
- La règle « première dans l'ordre des chemins » remplace celle de 029 (toutes écartées) : mettre à jour le commentaire de `validateCandidates` et le test existant.
