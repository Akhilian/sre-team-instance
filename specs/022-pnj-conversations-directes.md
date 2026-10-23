# 022 — PNJ : conversations directes et « en train d'écrire »

## Pourquoi
GOAL.md (phase 2) prévoit que les PNJ répondent « quand on les mentionne ou par message direct ». Aujourd'hui seule la mention en canal existe, et le PNJ reste muet jusqu'à sa réponse : la conversation 1:1 et l'indicateur de frappe rendent l'interrogation des PNJ naturelle, façon Teams « Chat ».

## Périmètre
- **Modèle** : une conversation directe est un canal du store, `Channel.direct = { participant, npcId }` (champ optionnel dans `shared/types/chat.ts`), id `dm-<slug(participant)>--<npcId>` (slug = `slugifyChannelName`), nom `<participant> ↔ <nom du PNJ>`. Elle hérite donc de tout l'existant : messages, fils, réactions, `rev`/`since`, persistance (l'instantané conserve `direct`), `totalCount`. Le propriétaire est comparé par slug (« Zoé » et « zoe » partagent la conversation).
- **Création** : `POST /api/direct` `{ participant, npcId }`, idempotente (201 à la création, 200 si elle existe, même corps `Channel`). 400 si `participant` invalide (règles de `author`, slug vide) ou nom réservé à un PNJ ; 404 si `npcId` n'est pas un PNJ du scénario courant ; 409 si les PNJ sont coupés ; 409 au-delà de `DIRECT_CHANNELS_MAX = 300` (nouveau, dans `shared/utils/limits.ts`). Les conversations ne comptent pas dans `CHANNELS_MAX`.
- **Visibilité** : `GET /api/channels` ne renvoie que les canaux d'équipe ; `GET /api/channels?participant=<nom>` y ajoute les conversations de ce participant (avec `direct`), ce qui donne les non-lus sans changer `computeUnread`. **Pas d'auth réelle** : « privé » signifie « non listé pour les autres » ; quiconque connaît l'URL peut lire. Seule l'écriture est gardée : `POST …/messages` dans une conversation directe exige un `author` de même slug que le propriétaire (403 sinon). À écrire tel quel dans le README.
- **Réponse sans mention** : dans une conversation directe, tout message du propriétaire (non `kind`, non PNJ) déclenche la réponse du PNJ de la conversation, à la racine si le message est racine, dans le fil sinon ; les mentions d'autres PNJ y sont ignorées. Mêmes garde-fous 019–020 (plafonds par PNJ/canal et global, délai max, troncature, annulation au reset/coupure) ; historique = fin de la conversation.
- **Frappe des PNJ** : le dispatcher signale le début (planification) et la fin (publication, échec, annulation) de chaque réponse ; `presence-store` tient une frappe PNJ par canal (filet d'expiration 20 s) et `channelPresence().typing` inclut le nom du PNJ, en canal d'équipe comme en conversation directe. Le front existant affiche donc « Julien Moreau est en train d'écrire… » sans changement de rendu.
- **Front** : section « Conversations » dans `ChannelList.vue` sous « Équipes » : un lien par PNJ actif (`/api/npcs`) avec avatar à initiales et rôle, pastille de non-lus si la conversation existe ; un clic appelle `POST /api/direct` puis navigue vers `/channels/<id>`. Section masquée si les PNJ sont coupés et que le participant n'a aucune conversation. En conversation directe, l'en-tête affiche le nom et le rôle du PNJ et le composeur « Écrire à <nom> ».
- **Animateur et reset** : la chronologie (`/api/admin/timeline`, tous canaux) inclut les conversations directes ; `reset all` les supprime, `reset messages` les vide.

## Hors périmètre
- Retour visible lors de la mention d'un PNJ désactivé ou plafonné (dette 021, repoussée en 023), conversations directes entre participants, conversations de groupe, auth réelle, adaptateur `anthropic`.

## Critères d'acceptation
- [x] CA1 — Vitest (store) : créer deux fois la conversation (Alice, `release-manager`) renvoie le même id `dm-alice--release-manager` ; `listChannelSummaries()` sans participant ne la contient pas, avec `alice` (casse différente) oui ; `addChannel` reste possible jusqu'à `CHANNELS_MAX` canaux d'équipe malgré des conversations ; la 301e conversation lève l'erreur de plafond ; `resetAll()` les supprime ; un instantané exporté puis importé conserve `direct`.
- [x] CA2 — Vitest (dispatcher) : dans une conversation directe, un message sans mention du propriétaire est planifié pour le PNJ de la conversation (réponse sans `parentId` pour un message racine) ; une mention d'un autre PNJ n'y déclenche que le PNJ de la conversation ; un message de PNJ ou à `kind` n'y déclenche rien ; PNJ coupés → rien.
- [x] CA3 — Vitest (frappe) : après `handle()`, `channelPresence(channelId).typing` contient le nom du PNJ jusqu'à la publication, puis plus ; idem après un échec du moteur et après `cancelPending()` ; sans fin signalée, la frappe expire après 20 s (horloge injectée).
- [x] CA4 — `npm run test:http` (build, `NPC_REPLY_DELAY_MS=1500`) : scénario `panne-checkout` lancé, `POST /api/direct` `{participant:"Alice", npcId:"release-manager"}` → 201 puis 200 ; `npcId` inconnu → 404 ; `participant` « Julien Moreau » → 400 ; `GET /api/channels` ne liste pas la conversation, `?participant=Alice` oui ; `POST` d'un message par « Bob » → 403 ; Alice écrit « Quel déploiement récent ? » sans mention → `POST /api/presence` (Alice, conversation) dans la seconde renvoie `typing` contenant « Julien Moreau », puis la réponse racine du PNJ (`npc.id = release-manager`, contient `v2.41.0`) apparaît en moins de 5 s ; la chronologie JSON contient la conversation ; après `reset {scope:"all"}`, la conversation renvoie 404.
- [x] CA5 — Vitest (HTTP ou store) : PNJ coupés → `POST /api/direct` 409 ; un PNJ mentionné dans `#incident-en-cours` apparaît aussi dans `typing` de ce canal pendant sa préparation.
- [x] CA6 — Chrome (orchestrateur, sur le build) : après lancement du scénario, la section « Conversations » liste les 6 PNJ ; cliquer « Julien Moreau » ouvre `/channels/dm-<nom>--release-manager`, en-tête au nom et rôle du PNJ ; un message sans `@` affiche « Julien Moreau est en train d'écrire… » puis sa réponse badgée « PNJ » ; un second navigateur sous un autre nom ne voit pas cette conversation dans sa barre latérale ; aucune erreur console.

## Vérification
```
npm test
npm run build && npm run test:http
npm run build && NPC_REPLY_DELAY_MS=3000 node .output/server/index.mjs   # puis parcours CA6 dans Chrome
curl -s -X POST localhost:3000/api/direct -H 'content-type: application/json' -d '{"participant":"Alice","npcId":"release-manager"}'
curl -s 'localhost:3000/api/channels?participant=Alice'
```

## Notes d'implémentation
- `chat-store.ts` : `addDirectChannel`, filtre de `listChannelSummaries(participant?)`, `CHANNELS_MAX` compté sur les seuls canaux d'équipe, `importValidSnapshot` qui garde `direct` (aujourd'hui il ne recopie que `id`/`name`).
- `dispatcher.ts` : dépendances `directNpcId(channelId)` et `onTyping(persona, channelId, typing)` ; frappe démarrée à la planification pour couvrir le délai simulé.
- `presence-store.ts` : frappe PNJ à part des entrées participants (hors `PRESENCE_ENTRIES_MAX`, absente de `present`) ; `server/api/direct.post.ts` passe par le limiteur d'écriture 016.
- Front : le polling 017 de `/api/channels` passe `participant=displayName` ; aucune nouvelle boucle de polling.
- Le plafond global de 60 réponses/min peut être atteint si toute la salle écrit en direct : le noter en dette, ne pas le relever.
