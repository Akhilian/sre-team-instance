# 028 — Revue de la phase 2 (PNJ, boucles 019 à 027)

Audit fait le 2026-10-24 sur `main` (d45fe99), sans modifier le code. Seul changement dans l'arbre de travail : `specs/PROGRESS.md`, où le sha de 027 a été renseigné mais pas encore commité. État constaté : `npm run typecheck` passe, `npm test` passe (28 fichiers, 448 tests), `npm run build` passe (2,94 Mo) et `npm run test:http` passe (14 fichiers, 63 tests). Échelle retenue : 15 participants au plus, la performance n'est pas un enjeu.

## 1. Dépendances

Rien n'a changé depuis 015. `npm outdated` ne liste que les trois majors déjà écartées : typescript 6.0.3 → 7.0.2, ioredis 5.11.1 → 6.0.0, unstorage 1.17.6 → 2.0.0-beta.0. Les raisons de 015 tiennent toujours (peer `typescript <7` de `@volar/typescript`, peer `ioredis ^5` d'unstorage 1, bêta). nuxt 4.6.2, vue 3.5.44, vitest 5.0.5 et vue-tsc 3.3.13 sont toujours les dernières versions.

`npm audit` : 7 vulnérabilités hautes, toutes dans la même chaîne `node-forge@1.4.0` → `listhen` → `nitropack` → `nuxt`. 1.4.0 est toujours la dernière version publiée, il n'existe donc aucun correctif. Le paquet ne sert qu'en dev et ne figure pas dans `.output/` (vérifié). Le retard reste justifié.

La phase 2 n'a ajouté aucune dépendance : les moteurs `openai-compatible` et `anthropic` utilisent le fetch natif.

## 2. Revue du code

Contrôles faits sans rien trouver :
- Les 13 routes `/api/admin/*` vérifient toutes le code animateur avant de lire la requête.
- Aucun `v-html` : fiches, chronologie et messages des PNJ passent tous par l'interpolation de Vue.
- Aucune requête ne peut choisir le chemin des fiches : `NPC_PERSONAS_DIR` vient de l'environnement, et `path` n'est qu'une clé comparée aux fiches en service.
- Les clés et URL n'apparaissent jamais dans les journaux.
- Le prompt contient une règle contre l'injection, la question n'arrive que dans un tour `user`, et seuls les extraits retenus entrent dans le prompt.
- Les plafonds de débit sont en place, le délai de 15 s est respecté, et un PNJ ne répond jamais à un PNJ.

### Gravité haute
| # | Fichier:ligne | Constat | Correctif en une ligne |
| --- | --- | --- | --- |
| H1 | `server/npc/engines/anthropic.ts:18-19, 96-102` | Le moteur `anthropic` ne peut pas marcher contre la vraie API avec le modèle par défaut `claude-haiku-5-5`. Il envoie `temperature: 0.3`, or Claude Haiku 5.5 renvoie 400 pour toute valeur de sampling autre que la valeur par défaut (et l'API `2026-10-21` les refuse toutes). En plus, la réflexion adaptative est active par défaut sur Haiku 5.5 et entame les `max_tokens: 300`, d'où un risque de réponse sans texte. Résultat : chaque appel bascule en silence sur `keywords`, avec seulement « HTTP 400 » dans les logs. Les tests utilisent `scripts/fake-anthropic.mjs`, qui accepte tout, donc rien ne l'a détecté. | Retirer `temperature`, envoyer `thinking: { type: 'disabled' }` (accepté à l'effort par défaut `medium`) ou monter `max_tokens`, faire refuser `temperature` par le faux serveur, et prévoir un essai réel avant l'atelier. |
| H2 | `server/npc/dispatcher.ts:268-272` | Dans un canal d'équipe, un PNJ ne répond que si on le mentionne. Une réponse dans le fil qu'il vient d'ouvrir, sans `@Nom` (le geste le plus naturel), reste sans réponse et sans avis. En atelier, les participants vont croire que le PNJ est en panne. | Si aucun PNJ n'est mentionné et que le message est une réponse dans un fil où un seul PNJ actif a déjà répondu, ce PNJ répond. |

### Gravité moyenne
| # | Fichier:ligne | Constat | Correctif en une ligne |
| --- | --- | --- | --- |
| M1 | `server/npc/dispatcher.ts:283` | Au-delà du plafond (6 réponses par PNJ et par canal par minute, 20 par canal), la mention est ignorée en silence : pas d'indicateur de frappe, pas de message. Avec 15 personnes qui interrogent le même PNJ dans `#incident`, le plafond peut être atteint. | Publier une fois par minute une courte réponse du PNJ (« je reviens vers vous dans une minute ») ou renvoyer un avis au client. |
| M2 | `server/api/admin/scenarios/stop.post.ts:5`, `server/utils/npc.ts:182` | « Arrêter » coupe les injections mais laisse les PNJ actifs, et rien dans `/admin` ne le signale (dette 027). La démo (`demo-express.ts:9`) active elle aussi les PNJ de `panne-checkout` et les laisse actifs après ses 6 s : les participants qui arrivent peuvent interroger les PNJ avant le lancement. | À l'arrêt, proposer « couper aussi les PNJ » (cochée par défaut) ; la démo ne doit pas activer les PNJ, ou les couper à la fin. |
| M3 | `app/pages/channels/[id].vue:64, 436` ; `app/components/ChannelList.vue:41-60` | Conversation directe avec un PNJ d'un ancien scénario : quand les PNJ actifs sont ceux d'un autre scénario, elle disparaît de la liste mais reste ouverte par URL. Le bandeau « n'est pas disponible » ne s'affiche que si les PNJ sont coupés : le participant écrit et n'obtient jamais de réponse (dette 027). « Effacer les messages » garde aussi ces conversations. | Afficher le bandeau et désactiver le composeur quand `direct.npcId` n'est pas dans `npcState.npcs` ; supprimer les conversations directes dans `clearMessages` (ou au lancement d'un scénario d'un autre jeu de PNJ). |
| M4 | `app/pages/admin.vue` (pas de vue des conversations directes) | L'objectif dit que l'animateur « voit leurs échanges ». Or les conversations directes n'apparaissent que dans l'export « Tous les canaux » de la chronologie, et la liste déroulante ne les propose pas. L'animateur ne voit pas en direct ce que les participants demandent aux PNJ en privé. | Section « Conversations PNJ » dans `/admin` : route admin listant les canaux `direct` avec leur nombre de messages, et lien ou aperçu en lecture seule. |
| M5 | `server/api/admin/scenarios/[id]/start.post.ts:12` | Lancer un scénario ne vide ni ne signale les messages du précédent. Enchaîner `panne-checkout` puis `fuite-donnees` mêle les deux incidents dans `#incident-en-cours`. | Demander une confirmation dans `/admin` (« des messages existent : effacer avant de lancer ? ») avec une option de reset des messages. |
| M6 | `app/pages/admin.vue` (1073 lignes, dont environ 440 de script et 290 de template) | La page regroupe sept sections et tout l'état PNJ et fiches. Le message de statut est rendu en bas (`:717-725`) : sur une page longue, une fois les fiches dépliées, l'animateur ne voit pas le résultat de son clic. L'en-tête `x-facilitator-code` est recopié 13 fois et le téléchargement par Blob deux fois (`:306`, `:402`). | Découper en `AdminScenarioPanel`, `AdminNpcPanel` + `PersonaEditor`, `AdminTimeline` et `AdminReset`, avec un composable `useFacilitatorApi()` (code, `$fetch` avec en-tête, `run`, statut) et un util `downloadText()` ; afficher le statut près de l'action, ou en bandeau fixe. |
| M7 | `render.yaml:21-22` | `NPC_ENGINE` est figé à `value: keywords` dans le blueprint. Le passer à `anthropic` dans le tableau de bord Render sera écrasé à la prochaine synchronisation du blueprint. | Mettre `sync: false` (défaut `keywords` dans le code), comme les autres variables PNJ. |

### Gravité basse
| # | Fichier:ligne | Constat | Correctif en une ligne |
| --- | --- | --- | --- |
| B1 | `server/npc/persona-source.ts:96-100` | La décision de 027 impose des ids distincts entre scénarios, mais la validation ne le vérifie pas (le chemin `scénario/id.md` les rend uniques seulement à l'intérieur d'un scénario). `findLoadedNpcPersona` (`npc.ts:154`) prendrait alors la première fiche trouvée, et `dm-<slug>--<id>` serait partagé. Le nom n'est pas borné non plus : au-delà de 50 caractères (`AUTHOR_MAX_LENGTH`), `addNpcMessage` lève une erreur et toutes les réponses de ce PNJ sont abandonnées. | Dans `checkPersonaFile`, refuser un id déjà pris dans un autre scénario et un nom de plus de `AUTHOR_MAX_LENGTH`. |
| B2 | `app/pages/channels/[id].vue:60`, `app/components/ChannelList.vue:55` | Le nom du PNJ d'une conversation directe est retrouvé en découpant `channel.name` sur « ↔ », à deux endroits. C'est fragile (un participant qui a « ↔ » dans son nom, un PNJ renommé). | Ajouter `npcName` dans `DirectChannel` et le lire directement. |
| B3 | `server/npc/engines/anthropic.ts:9, 12, 67-137` et `openai-compatible.ts:33-103` | Les deux adaptateurs dupliquent environ 50 lignes (`ModelUnavailable`, traduction des erreurs de fetch, repli journalisé). `anthropic` importe `timeoutFromEnv` depuis l'autre adaptateur et `truncateText` depuis `chat-store`. Ajouter un fournisseur ne touche certes qu'un fichier, mais oblige à recopier ce bloc. | Sortir `withKeywordsFallback(name, complete)`, `fetchJson()` et `timeoutFromEnv` dans `server/npc/engines/shared.ts`. |
| B4 | `server/api/admin/**/*.ts` (13 fichiers) | Les 4 lignes de la garde (`isFacilitatorCode(getHeader(…))` + 401) sont recopiées dans chaque route. Une route admin ajoutée sans cette garde passerait inaperçue. | `requireFacilitator(event)` dans `server/utils/facilitator.ts`, ou un middleware sur `/api/admin/`, et un test HTTP qui parcourt toutes les routes admin sans code. |
| B5 | `app/pages/channels/[id].vue` (759 lignes) | Le script (environ 330 lignes) mêle polling incrémental, présence, non-lus, avis PNJ et mutations. Ce n'est pas encore bloquant, mais c'est le prochain point chaud. | Extraire `useChannelPolling()` et `usePresence()` dans `app/composables/` ; à faire en même temps que M3, pas avant. |
| B6 | `server/npc/prompt.ts:30` | Le prompt présente toujours la situation comme « un incident de production » : c'est inexact pour `fuite-donnees`, un incident de sécurité. | Remplacer par « pendant un incident », ou ajouter un champ `context` facultatif à la fiche ou au scénario. |
| B7 | `server/npc/personas/fuite-donnees/soc.md` (entrée IP) | 198.51.100.77 (23h14, 9h31) pourrait être la chercheuse qui a fait le signalement à 9h52. Le recoupement voulu (« accès par un tiers ») reste vrai, mais une équipe peut conclure « ce n'est que la chercheuse » et ne pas notifier. | Faire dire au SOC que la chercheuse affirme n'avoir rien téléchargé, ou dater son signalement avant 23h14. |
| B8 | `specs/PROGRESS.md` | La dette accumulée n'est suivie nulle part en dehors des entrées : restaurer `NPC_PERSONAS_DIR` après un repli exige un redémarrage (025), les fiches modifiées sont perdues au redémarrage (026), la dette de 027 (M2, M3), aucun essai réel avec un modèle (026, 027, cf. H1). Le sha de 027 n'est pas commité. | Ajouter une section « Dette ouverte » maintenue à chaque clôture, et commiter le sha avec la prochaine boucle. |

## 3. Expérience en atelier

En relisant les deux scénarios comme un animateur :

- **Lancement** : les PNJ affichés dans `/admin` sont ceux du scénario courant (`panne-checkout` au démarrage) et non ceux du scénario que l'on va lancer. La carte d'un scénario ne dit pas quels PNJ il active. Il faudrait afficher les PNJ (nom, rôle) sur chaque carte de scénario.
- **Mention obligatoire dans les fils** (H2) et **silence au-delà du plafond** (M1) : ce sont les deux frictions que les participants remarqueront en premier. Pour l'instant, la consigne orale « toujours écrire @Nom, même dans le fil » est indispensable.
- **Arrêt et démo** (M2) : après « Arrêter » ou une démo, les PNJ restent actifs. L'interrupteur « PNJ actifs » existe, mais il faut penser à le couper. Il manque une séquence claire « préparer → lancer → arrêter → effacer ».
- **Enchaîner deux groupes ou deux scénarios** (M3, M5) : « Effacer les messages » garde les conversations directes, et lancer un scénario sans reset mélange les incidents. Aujourd'hui, seul « Tout réinitialiser » remet tout au propre, mais il supprime aussi les canaux créés par les participants.
- **Suivi** (M4) : l'animateur ne voit pas les échanges privés avec les PNJ et ne sait pas quel PNJ a déjà été interrogé. C'est pourtant ce qui lui permettrait de relancer une équipe bloquée (« avez-vous demandé à Hugo ? »). Un compteur « mentions / réponses par PNJ » suffirait.
- **Heures du récit** : les PNJ citent des heures fixes (newsletter à 14h30, journaliste avant 15h ou 17h, signalement à 9h52) qui ne correspondent pas à l'horloge réelle des messages. Il faut le dire au briefing, ou parler en durées relatives.
- **Moteur** : en `keywords`, une question vague obtient la phrase d'esquive. C'est voulu, mais une équipe peut se décourager. Rappeler au briefing qu'il faut des questions précises. Avec un modèle, rien ne garantit qu'il marche le jour J tant que H1 n'est pas corrigé et qu'aucun essai réel n'a été fait. `/api/health` donne le moteur configuré, pas le dernier appel réussi.
- **Fiches** : l'édition en ligne est perdue au redémarrage. Sur Render free (mise en veille), une fiche modifiée le matin peut avoir disparu l'après-midi. Le bandeau « en mémoire » le dit déjà ; il faut ajouter à la checklist : télécharger le .md.

Pour animer sereinement, il manque une **checklist d'avant séance** dans `/admin` : moteur effectif et dernier appel au modèle réussi ou non, PNJ du scénario choisi, état des canaux (messages existants), code animateur défini (`env` ou généré).

## 4. Découpage proposé en boucles correctives

1. **029 — Fiabilité des PNJ en atelier (indispensable)** : H1 (corps de requête Anthropic, faux serveur plus strict, statut du dernier appel au modèle dans `/api/admin/npcs`), H2 (réponse sans mention dans le fil d'un PNJ), M1 (réponse « occupé » au plafond), M7 (`NPC_ENGINE` en `sync: false`), B1 (ids et longueur des noms). Tests unitaires du dispatcher pour H2 et M1.
2. **030 — Cycle de vie scénario et PNJ (indispensable avant d'enchaîner les groupes)** : M2 (arrêt qui coupe les PNJ, démo sans PNJ), M3 (bandeau, composeur désactivé, conversations directes supprimées par « Effacer les messages »), M5 (confirmation au lancement s'il reste des messages), B2 (`npcName` dans `DirectChannel`), PNJ affichés sur les cartes de scénario.
3. **031 — Console animateur (fortement conseillée)** : M6 (découpage d'`admin.vue` en composants + `useFacilitatorApi`, statut près de l'action), M4 (vue des conversations PNJ et compteurs par PNJ), checklist d'avant séance, B3 et B4 (helpers partagés), B6, B7, B8. B5 seulement si la boucle 030 a touché `[id].vue`.

Dépendances : rien à monter. Retard justifié comme en 015.
