# 023 — PNJ : retour quand ils sont coupés, droits en conversation directe, dernières annonces

## Pourquoi
Phase 2 (GOAL.md) : l'équipe s'adresse aux PNJ, qui « ont chacun une partie de l'info ». Aujourd'hui, une mention ou un message direct à un PNJ coupé reste sans réponse ni explication. Les réactions et acquittements d'une conversation directe sont ouverts à tous (dette 022), et trois annonces scriptées font encore parler des fonctions sans visage (dette 021).

## Périmètre
- **Retour « PNJ coupés » (front, non persisté)** : nouvelle fonction pure `npcNoticeFor(text, { enabled, npcNames, directNpcName? })` dans `app/utils/npc-notice.ts`. Elle renvoie `null` si les PNJ sont actifs. Sinon : « Les PNJ ne sont pas actifs pour le moment : <noms> ne répondra pas. » (libellé remplacé par « <nom> n'est pas disponible pour le moment. » depuis l'évolution 2026-10-24 de `specs/019-pnj-fondations-keywords.md`) quand le texte mentionne des PNJ (via `splitMentions` avec `npcNames`, noms sans doublon, dans l'ordre du texte). En conversation directe, elle renvoie la même phrase pour son PNJ, même sans mention. Elle renvoie `null` dans tous les autres cas.
  - Après un envoi réussi (`send` ou `reply`) dans `app/pages/channels/[id].vue`, le résultat s'affiche dans une ligne système locale `data-testid="npc-notice"`, au-dessus du composeur et sous l'indicateur de frappe, en gris italique, avec `role="status"`. La ligne s'efface à l'envoi suivant qui ne produit pas d'avis, à la navigation vers un autre canal, ou dès que `/api/npcs` repasse à `enabled: true`. Elle n'est ni envoyée au serveur ni stockée.
  - En conversation directe avec des PNJ coupés, un bandeau permanent `data-testid="direct-inactive"` (« <nom> n'est pas disponible pour le moment. ») s'affiche sous l'en-tête. Le composeur reste utilisable.
  - **Alignement de la liste « Conversations »** (comportement 022 conservé, à vérifier) : PNJ coupés → la liste ne montre que les conversations existantes, sans bouton pour en ouvrir une nouvelle. La section est masquée s'il n'y en a aucune. Ces entrées prennent en plus la classe `conversation--inactive` (opacité réduite) et l'infobulle `title="PNJ inactif"` (devenue « Indisponible pour le moment », évolution 2026-10-24 de 019).
- **Droits en conversation directe** : `POST …/messages/:messageId/reactions` (champ `author`) et `POST …/messages/:messageId/alert-status` (champ `name`) renvoient **403** dans un canal `direct` si le nom n'a pas le même slug que le propriétaire (`isDirectOwner`, déjà utilisé par `messages.post.ts`). Les canaux d'équipe ne changent pas. Un nom vide ou invalide continue de produire 400.
- **Dernières annonces de `panne-checkout`** (règle « un visage par fonction ») :
  - t=550 [CTO] → `npc-message` de **Claire Dumont** (`ceo`), sans le préfixe. Raison : réclamer un point de situation écrit (impact, hypothèse, prochaine action, heure du prochain point) correspond déjà à sa fiche (« point écrit toutes les 30 minutes »). Un PNJ CTO serait une 7e fiche sans information propre, et le CTO reste hors scène (« j'appelle moi-même le CTO »). Le texte est reformulé à la première personne : « Je sors du COMEX… ».
  - t=690 [Service client grands comptes] → `npc-message` de **Sarah Benali** (`support-n1`). Elle relaie le service grands comptes : « Maison Verdier menace de basculer chez un concurrent si les commandes ne passent pas avant 15h. » Raison : le service client a déjà un visage, et nommer Maison Verdier crée un recoupement avec le CFO, qui détient le SLA et les pénalités. Sa fiche gagne une ligne « Sait » sur cette échéance de 15h, sans montant ni clause : ces chiffres restent au CFO.
  - t=840 [Animateur] reste une **annonce** (`kind: "announcement"`). Raison : c'est une consigne de jeu hors fiction (« fin des injections »). La faire porter par un PNJ casserait l'immersion, et le bandeau d'annonce est justement le canal de l'animateur.
  - Mettre à jour le commentaire d'en-tête du scénario et le test 021 qui exige les préfixes `[CTO]` et `[Service client grands comptes]`.

## Hors périmètre
- Retour quand un PNJ est **plafonné** (débit 020/022), avis calculé côté serveur, nouveau PNJ, adaptateur `anthropic`, essai avec LM Studio, contrôle de la lecture des conversations directes.

## Critères d'acceptation
- [x] CA1 — Vitest (`npcNoticeFor`) :
  - PNJ actifs → `null`.
  - PNJ coupés, « @Julien Moreau et @Marc Lefort ? » → l'avis cite les deux noms dans cet ordre.
  - PNJ coupés, texte sans mention de PNJ (ou mention d'un participant) → `null`.
  - PNJ coupés, conversation directe, texte sans mention → l'avis cite le PNJ de la conversation.
  - Même mention répétée → nom cité une seule fois.
- [x] CA2 — `npm run test:http` (build), scénario `panne-checkout` lancé, conversation `dm-alice--release-manager` contenant un message d'Alice et la réponse du PNJ :
  - Bob réagit au message → 403. Alice (ou « alice ») → 200.
  - Réaction sans `author` → 400.
  - Une réaction de Bob dans `#incident-en-cours` reste 200.
  - `alert-status` posté par Bob sur un message de la conversation → 403.
- [x] CA3 — Vitest (scénarios) :
  - `panne-checkout` ne contient qu'une seule `announcement`, à t=840, préfixée `[Animateur]`.
  - Les étapes t=550 et t=690 sont des `npc-message` de `ceo` et de `support-n1` respectivement. Leur texte ne contient ni `[CTO]` ni `[Service client`, et celui de t=690 contient « Maison Verdier » et « 15h ».
  - La fiche `support-n1` parsée contient « 15h » et ne contient ni « 40 000 » ni « 99,9 ».
- [x] CA4 — Vitest (moteur `keywords`, fiche `support-n1`) : la question « Que veut Maison Verdier, et pour quand ? » posée à Sarah produit une réponse qui contient « 15h ».
- [x] CA5 — Chrome (orchestrateur, sur le build) :
  1. Scénario lancé, ouvrir une conversation avec Julien Moreau, puis couper les PNJ dans `/admin`. Dans `#incident-en-cours`, envoyer « @Julien Moreau tu es là ? » → la ligne `npc-notice` apparaît sous le fil et ne revient pas après rechargement.
  2. Dans la barre latérale, la conversation existante est grisée, avec l'infobulle « PNJ inactif », et aucun bouton n'ouvre de nouvelle conversation.
  3. Ouvrir la conversation avec Julien Moreau → le bandeau `direct-inactive` est visible.
  4. Réactiver les PNJ → le bandeau et la ligne disparaissent en moins de 5 s.
  5. Aucune erreur console.

## Vérification
```
npm test
npm run build && npm run test:http
npm run build && NPC_REPLY_DELAY_MS=1500 node .output/server/index.mjs   # puis parcours CA5 dans Chrome
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/channels/dm-alice--release-manager/messages/<id>/reactions -H 'content-type: application/json' -d '{"emoji":"👍","author":"Bob"}'   # 403
```

## Notes d'implémentation
- `reactions.post.ts` et `alert-status.post.ts` reprennent la garde de `messages.post.ts` : `getChannel(id)?.direct` puis `isDirectOwner`, avant l'appel au store.
- La page a déjà `npcState` (polling de `/api/npcs`), `npcNames` et `directNpc` : l'avis est calculé à partir de ces valeurs, sans nouvelle boucle de polling. `ChannelList.vue` reçoit déjà `npcsEnabled`.
- Fiches modifiées dans `server/npc/personas/` : un rebuild est nécessaire (serverAssets). La ligne ajoutée à `support-n1.md` doit se déclencher avec `verdier` et `grand compte` sans détourner ses entrées existantes : relancer les tests `npc-keywords`.
- README : une phrase sur l'avis « PNJ inactifs » et sur le 403 des réactions et acquittements en conversation directe.
