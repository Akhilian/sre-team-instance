# 035 — PNJ : interventions spontanées

## Pourquoi
Pour simuler un vrai incident (retour de l'utilisateur du 2026-10-24), certains personnages suivent le canal et interviennent sans être sollicités : le CFO s'inquiète des pertes, le CEO réclame un point. La pression et l'information répartie de la phase 2 (GOAL.md) en deviennent plus crédibles, avec ou sans modèle.

## Lot
Une seule boucle implémente :
- A : `specs/020-pnj-moteur-openai-compatible.md`, section « Évolution 2026-10-24 » (ton de collègue, filtre de sortie, lecture du canal) : CA8 à CA11 ;
- B : `specs/034-pnj-auteur-question.md` (bug, auteur de la question) : CA1 à CA4 ;
- C : la présente spec. Le CA Chrome (CA7 ci-dessous) couvre les trois.

## Périmètre
- **Fiche** : section optionnelle `## Intervient spontanément`, une règle par puce, sous l'une de ces trois formes :
  - `- [mots: newsletter, black friday] texte` : un des mots (même normalisation que le retriever) apparaît dans un message **humain** du canal d'incident ;
  - `- [après: 8 min] texte` : 8 minutes écoulées depuis le lancement du scénario ;
  - `- [sans point: 6 min] texte` : aucun message humain du canal d'incident contenant un mot de point de situation (`point`, `statut`, `status`, `update`, `situation`, `eta`, `mise à jour`) depuis 6 min (compté depuis le lancement ou depuis le dernier tel message).
  Une règle invalide rend la fiche invalide (erreur explicite, comme les autres sections). `NpcPersona` gagne `spontaneous: { trigger, text }[]` (vide si la section est absente).
- **Moteur** : `server/npc/spontaneous.ts`, module pur (horloge, planificateur, publication injectés). Il évalue les règles à chaque message publié dans le canal d'incident et à un tic périodique (toutes les 15 s) pendant le scénario.
- **Formulation** : avec `keywords`, le texte de la règle est publié tel quel. Avec un moteur à modèle, `NpcRequest` gagne `spontaneous: { base }` : le prompt (fiche sans extraits, contexte du canal de l'évolution 020) demande de reformuler ce message de base en une intervention spontanée, sans ajouter d'information. Erreur, délai dépassé ou texte vide après `stripServiceTone` : le texte de base est publié.
- **Garde-fous** :
  - PNJ actifs, interrupteur « Interventions spontanées » actif, scénario en cours (pas après `stop` ou reset) ;
  - une règle se déclenche au plus une fois par lancement de scénario ;
  - au moins 4 min entre deux interventions spontanées d'un même PNJ ; au plus 2 interventions spontanées par minute, tous PNJ confondus ; une règle bloquée par ces délais reste en attente et sera réévaluée ;
  - jamais déclenchée par un message de PNJ, une annonce ou une alerte ; une règle `mots` n'est pas déclenchée par un message qui mentionne déjà ce PNJ (il va répondre) ;
  - rien dans les conversations directes ; publication en **message racine** du canal d'incident, signée du PNJ (`npc` renseigné), soumise au plafond global de 60 appels/min au modèle.
- **Fiches** : règles ajoutées là où c'est crédible, 1 à 3 par fiche, en cohérence avec les messages scriptés du scénario (pas de doublon) : `panne-checkout` (CFO, CEO, communication, PSP, support-n1 ; pas le Release Manager) et `fuite-donnees` (porte-parole, DPO, support-clients ; d'autres si crédible). Une intervention exprime une préoccupation ou une pression, jamais une information de la section `Sur question précise`.
- **`/admin`** : interrupteur « Interventions spontanées » sous « PNJ actifs », actif par défaut ; `GET /api/admin/npcs` renvoie `spontaneous: boolean`, `POST /api/admin/npcs` accepte `{ spontaneous }` (avec ou sans `enabled`) ; `reset all` le remet à `true`.
- **Tests** : `NPC_SPONTANEOUS_MINUTE_MS` (défaut 60000) fixe la durée d'une « minute » des règles et des délais (tic = minute / 4), pour les tests HTTP.

## Hors périmètre
- Interventions spontanées en conversation directe ou dans un autre canal que celui d'incident, réponses d'un PNJ à un autre PNJ, édition des règles ailleurs que dans la fiche (l'édition en ligne de 026 suffit), règles répétables avec délai.

## Critères d'acceptation
- [x] CA1 — Vitest (parseur) : les trois formes de règle sont lues ; une fiche sans la section a `spontaneous: []` ; `[après: abc]` ou une forme inconnue rend la fiche invalide avec un message explicite. Toutes les fiches livrées restent valides, et au moins 5 fiches de `panne-checkout` et 3 de `fuite-donnees` ont une règle.
- [x] CA2 — Vitest (pas de fuite) : pour chaque fiche livrée, aucun texte spontané ne contient un nombre ou un déclencheur spécifique (`!…`) d'une entrée `Sur question précise` de la même fiche, ni `v2.41.0` / `v2.40.3` ; la fiche du Release Manager n'a aucune règle.
- [x] CA3 — Vitest (`spontaneous.ts`, horloge injectée) : une règle `mots` se déclenche sur un message humain du canal d'incident, pas sur un message de PNJ, une alerte, une conversation directe ni un message qui mentionne ce PNJ ; `après` se déclenche au tic qui suit l'échéance ; `sans point` se déclenche après 6 min sans point et est repoussé par un message « point de situation » ; une règle ne se déclenche qu'une fois par lancement.
- [x] CA4 — Vitest (garde-fous) : deux règles d'un même PNJ déclenchables à 1 min d'écart donnent une seule publication, la seconde arrive 4 min après la première ; 3 PNJ déclenchés dans la même minute donnent 2 publications cette minute-là ; PNJ coupés, interrupteur coupé ou scénario arrêté : aucune publication ; les messages publiés sont racines dans `incident-en-cours`.
- [x] CA5 — Vitest (formulation) : avec `keywords`, le texte publié est le texte de base ; avec un moteur simulé, c'est sa reformulation, et le prompt contient le texte de base sans aucun extrait `Sur question précise` ; moteur en erreur ou réponse réduite à une excuse : texte de base.
- [x] CA6 — `npm run test:http` (build, `NPC_SPONTANEOUS_MINUTE_MS=1000`, `keywords`) : `panne-checkout` lancé, un message humain contenant un mot d'une règle du CFO fait apparaître en moins de 5 s un message racine de Marc Lefort égal au texte de la règle ; une règle `après` d'un autre PNJ apparaît dans les délais ; après `POST /api/admin/npcs {spontaneous:false}`, plus aucune intervention spontanée pendant 5 s ; `GET /api/admin/npcs` renvoie `spontaneous` ; sans code, 401.
- [x] CA7 — Chrome (orchestrateur), build avec `NPC_SPONTANEOUS_MINUTE_MS=10000`, `NPC_ENGINE=openai-compatible` et `FAKE_OPENAI_APOLOGY=1 node scripts/fake-openai.mjs` : dans `/admin`, l'interrupteur « Interventions spontanées » est coché après le lancement de `panne-checkout` ; dans `incident-en-cours`, signé Bob, un message contenant un mot d'une règle du CFO fait apparaître un message racine de Marc Lefort sans y être mentionné ; signé Bob, `@Julien Moreau quel déploiement récent ?` reçoit dans le fil une réponse du faux modèle qui cite « Bob : » (B) et ne contient pas « désolé » (A) ; décoché, plus d'intervention ; aucune erreur en console ni violation CSP.

## Vérification
```bash
npm test
npm run build && npm run test:http
node scripts/fake-openai.mjs &   # ou FAKE_OPENAI_APOLOGY=1 pour CA7
NPC_SPONTANEOUS_MINUTE_MS=1000 FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=200 node .output/server/index.mjs &
curl -s -X POST localhost:3000/api/admin/scenarios/panne-checkout/start -H 'x-facilitator-code: animateur' -H 'content-type: application/json' -d '{"existingMessages":"clear"}'
curl -s -X POST localhost:3000/api/channels/incident-en-cours/messages -H 'content-type: application/json' -d '{"author":"Bob","text":"on a combien de clients bloqués sur le paiement ?"}'
sleep 3; curl -s localhost:3000/api/channels/incident-en-cours/messages | grep -o '"author":"Marc Lefort"[^}]*'
curl -s localhost:3000/api/admin/npcs -H 'x-facilitator-code: animateur' | grep -o '"spontaneous":[a-z]*'
```

## Notes d'implémentation
- Canal d'incident : celui des étapes du scénario lancé (`incident-en-cours`) ; le moteur s'abonne au lancement/arrêt dans `scenario-runner.ts` et reçoit les messages depuis `messages.post.ts` (après `dispatchNpcReplies`).
- Normalisation des mots : réutiliser celle de `lexical-retriever.ts` ; la règle CFO de CA6 utilise un mot simple (ex. `paiement`, `clients`), à aligner sur la fiche.
- Plafonds dans `shared/utils/limits.ts` (`NPC_SPONTANEOUS_GAP_MINUTES = 4`, `NPC_SPONTANEOUS_PER_MINUTE = 2`) ; formulation sous le délai du dispatcher, frappe signalée via `presence-store` comme une réponse.
- `scripts/fake-openai.mjs` : `FAKE_OPENAI_APOLOGY` (A) ; le faux modèle cite le début du dernier message `user`, ce qui rend B visible.
