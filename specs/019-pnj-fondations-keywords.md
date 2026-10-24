# 019 — PNJ : fondations, moteur `keywords` et réponses aux mentions

## Pourquoi
Première tranche de la phase 2 (GOAL.md) : l'équipe peut interroger des PNJ du scénario `panne-checkout` par `@Nom`. Chacun ne détient qu'une part de l'information. Le moteur est interchangeable, et `keywords` (déterministe, sans modèle) sert de défaut et de base aux tests.

## Périmètre
- Types `shared/types/npc.ts` : `NpcPersona` (id, name, role, scenarioId, tone, deflection, `knows[]`, `ignores[]`, `onPreciseQuestion[]` avec mots déclencheurs), `KnowledgeExcerpt`, `NpcRequest` (persona, excerpts, historique récent ≤ 10 messages, question), interfaces `KnowledgeRetriever.retrieve(persona, question) → KnowledgeExcerpt[]` et `NpcResponder.respond(request) → Promise<string>`.
- `server/npc/` : parseur de fiches, retriever lexical, responder `keywords`, registre des moteurs `NPC_ENGINE` (seule valeur `keywords`, valeur par défaut ; toute autre valeur donne `keywords` avec un avertissement dans les logs). Le registre est une table `nom → fabrique`, si bien qu'un futur moteur (`openai-compatible`, `anthropic`) tient en un fichier d'adaptateur et une ligne dans la table.
- **Format des fiches : Markdown avec un front-matter minimal `clé: valeur`, parsé à la main (aucune dépendance).** Elles vivent dans `server/npc/personas/panne-checkout/<id>.md`. Sections `## Sait`, `## Ignore` et `## Sur question précise` (puces `- [mots: rollback, v2.40.3] texte`). Pourquoi ce format : un animateur le lit et le modifie dans n'importe quel éditeur ou sur GitHub, le texte long s'y écrit sans échappement (contrairement à JSON), et le parseur évite une dépendance YAML.
- 4 fiches cohérentes avec `server/scenarios/panne-checkout.ts` :
  - **Support N1** (lanceur d'alerte, symptômes clients, tickets) ;
  - **CEO** (pression, newsletter Black Friday de 14h30, veut des points réguliers) ;
  - **CFO** (environ 18 000 € par 15 min, SLA et pénalités du client B2B) ;
  - **Release Manager** d'une autre équipe : sait que `checkout-api v2.41.0` a été déployée 6 min avant la première alerte. Il ne donne les détails (nouveau client HTTP, timeout 30 s, retries x3, pool 10, rollback `v2.40.3`) qu'à une question sur le déploiement, la release, un changement ou le rollback.
  - Seule la fiche Release contient « v2.41.0 ».
- Déclenchement : après un `POST /api/channels/:id/messages` réussi, chaque PNJ **actif** mentionné (`@Nom complet`, insensible à la casse, au plus 3 par message) répond après un délai simulé de 1 à 2 s. Sa réponse part dans le même canal, dans le fil du message (`parentId` = parent du message, ou le message lui-même s'il est racine). Elle est signée du nom du PNJ et porte `npc: { id, role }`.
- Garde-fous :
  - aucune réponse à un message d'un PNJ, ni à une annonce ou une alerte ;
  - un `POST` humain dont `author` est un nom de PNJ (insensible à la casse) reçoit un 400 ;
  - au plus 6 réponses par PNJ et par minute, et 20 tous PNJ confondus ; au-delà, le PNJ se tait sans erreur ;
  - réponse tronquée à 600 caractères ;
  - les plafonds de 016 s'appliquent (FIFO du canal, `TEXT_MAX_LENGTH`).
- Activation : le lancement de `panne-checkout` active ses PNJ. `GET /api/admin/npcs` (état et liste) et `POST /api/admin/npcs {enabled}` sont protégés par le code animateur. Un interrupteur « PNJ actifs » apparaît dans `/admin`. `reset all` les désactive. `GET /api/npcs` (public) renvoie `{ enabled, npcs: [{ id, name, role }] }`.
- Front : un badge « PNJ » à côté de l'auteur d'un message porteur de `npc` (**retiré par l'évolution 2026-10-24 ci-dessous** : plus rien ne signale un PNJ aux participants). Les noms des PNJ sont ajoutés aux `knownNames` pour surligner les mentions.

## Hors périmètre
- Adaptateurs `openai-compatible` et `anthropic`, retriever par embeddings ou plus fin, messages directs, lanceur d'alerte automatique (le Support ne parle que si on le mentionne), fiches des autres PNJ (Com, PSP, DPO), autocomplétion des mentions, persistance de l'état activé (mémoire seulement).

## Critères d'acceptation
- [x] CA1 — Vitest : les 4 fiches de `panne-checkout` se chargent et sont valides (nom, rôle, sections `Sait` et `Ignore` non vides, au moins une entrée `Sur question précise`). Seule la fiche Release contient « v2.41.0 ». Une fiche sans `name` est rejetée avec une erreur explicite.
- [x] CA2 — Vitest (retriever et responder `keywords`, purs) :
  - à « Quel déploiement récent sur le checkout ? », le Release Manager répond par un texte qui contient `v2.41.0`, et le CEO comme le CFO par un texte qui ne la contient pas ;
  - à « Quel est le coût de l'indisponibilité ? », le CFO répond avec `18 000` ;
  - une information `Sur question précise` (ex. `v2.40.3`) n'apparaît jamais en réponse à « Bonjour, tu as des nouvelles ? » : le PNJ répond alors par sa `deflection` ;
  - deux appels identiques donnent la même réponse.
- [x] CA3 — Vitest (orchestrateur, avec horloge et planificateur injectés) :
  - PNJ actifs : un message racine `@Julien Moreau …` (nom du Release Manager, ou le nom retenu) produit une réponse du PNJ avec `parentId` = id du message et `npc.id` renseigné. Un message en fil produit une réponse dans ce même fil ;
  - PNJ inactifs, message signé par un PNJ, annonce ou alerte : aucune réponse ;
  - la 7ᵉ mention du même PNJ dans la minute ne produit pas de réponse.
- [x] CA4 — `npm run test:http` (sur le build) :
  - `POST /api/admin/npcs {enabled:true}` sans code renvoie 401. Avec le code, la réponse est 200 et `GET /api/npcs` renvoie `enabled: true` et 4 PNJ ;
  - un message mentionnant le Release Manager fait apparaître, en moins de 5 s, dans `GET …/messages`, un message de cet auteur avec `npc` et le bon `parentId` ;
  - `{enabled:false}` : aucune réponse au bout de 3 s ;
  - `POST` d'un message avec `author` égal à un nom de PNJ : 400 ;
  - `GET /api/health` contient `npcEngine: "keywords"`.
- [x] CA5 — Démarrer `panne-checkout` depuis `/admin` active les PNJ, avec l'interrupteur coché. `POST /api/admin/reset {scope:"all"}` les désactive (`GET /api/npcs` renvoie `enabled: false`).
- [x] CA6 — Chrome (orchestrateur), sur le build :
  - dans `incident-en-cours`, l'envoi de `@<Release> quel déploiement récent ?` affiche la réponse du PNJ dans le fil en quelques secondes, avec le badge « PNJ » et la mention surlignée ;
  - après la désactivation dans `/admin`, une nouvelle mention reste sans réponse ;
  - aucune erreur en console ni violation CSP.

## Vérification
```bash
npm test
npm run build && npm run test:http
FACILITATOR_CODE=animateur node .output/server/index.mjs &
curl -s localhost:3000/api/health
curl -s -X POST localhost:3000/api/admin/npcs -H 'content-type: application/json' -H 'x-facilitator-code: animateur' -d '{"enabled":true}'
curl -s localhost:3000/api/npcs
curl -s -X POST localhost:3000/api/channels/incident-en-cours/messages -H 'content-type: application/json' -d '{"author":"Alice","text":"@Julien Moreau quel déploiement récent ?"}'
sleep 3; curl -s localhost:3000/api/channels/incident-en-cours/messages | grep -o '"npc":{[^}]*}'
```

## Notes d'implémentation
- Déplacer `app/utils/mentions.ts` vers `shared/utils/mentions.ts`, pour que le serveur détecte les mentions avec le même code, et mettre à jour les imports et les tests. `Message` gagne `npc?: { id: string, role: string }` (ajouté par une fonction serveur `addNpcMessage`, jamais par le corps HTTP). `importSnapshot` doit accepter `npc`.
- Fiches embarquées dans le build : `nitro.serverAssets` (`useStorage('assets:…')`) ou import `?raw`. Le parseur reste pur (il prend une chaîne) ; les tests lisent les fichiers avec `fs`.
- Orchestrateur pur `createNpcDispatcher({ schedule, now, retriever, responder, publish, personas })`, sur le modèle de `scenario-runner.ts`. Appel depuis `messages.post.ts` après `addMessage`. Délai via `NPC_REPLY_DELAY_MS` (défaut 1500).
- Retriever : minuscules, sans accents, mots vides FR retirés. Il score les puces `Sait` par recouvrement de mots ; une puce `Sur question précise` n'est éligible que si l'un de ses mots déclencheurs est présent. Il garde les 2 meilleures. Le responder préfixe la réponse d'une phrase de ton (`tone`) ; sans extrait, il répond par `deflection`.
- `startScenario('panne-checkout')` active les PNJ du scénario. `resetAll` les désactive.

## Évolution 2026-10-24 — personnages non signalés aux participants

Retour d'essai réel : les participants ne doivent pas savoir que ces personnages sont simulés ; ils les interrogent comme des collègues. Implémentée dans le lot de `specs/033-mention-prenom.md`.

### Périmètre
- Côté participant (`app/` hors `app/pages/admin.vue`), plus aucun texte visible, infobulle ni attribut accessible contenant « PNJ » ou « personnage non joueur » :
  - badge des messages (`MessageList.vue`, racines et réponses, `data-testid="npc-badge"` supprimé) ;
  - badge et `title` de l'en-tête de conversation directe (`app/pages/channels/[id].vue`) ;
  - infobulle `title="PNJ inactif"` de la liste « Conversations » (`ChannelList.vue`, 023) → « Indisponible pour le moment » ;
  - avis local de `app/utils/npc-notice.ts` (023) → « <nom> n'est pas disponible pour le moment. » / « <noms> ne sont pas disponibles pour le moment. » (tests `tests/npc-notice.test.ts` mis à jour) ;
  - tout autre bandeau, placeholder ou libellé trouvé par le grep du CA7.
- Un message de PNJ s'affiche comme celui d'un participant (avatar, nom, heure) ; le rôle peut rester visible sous forme de fonction (« Release Manager »), jamais avec le mot « PNJ ».
- `/admin` garde la notion de PNJ (interrupteur, fiches, libellés). Données et API serveur inchangées (`npc: { id, role }` sur les messages, `/api/npcs`, ids `dm-…--<npcId>`). Les commentaires de code et noms internes (`npc`, `npcNames`, classes CSS) ne sont pas concernés.

### Critères d'acceptation
- [x] CA7 — `grep -rnE 'PNJ|[Pp]ersonnage non joueur' app/ --exclude=admin.vue | grep -vE '^[^:]+:[0-9]+:\s*(//|/\*|\*|<!--)'` ne renvoie rien, et `grep -rn 'npc-badge' app/` non plus.
- [x] CA8 — Sur le build, scénario `panne-checkout` lancé et réponse de Julien Moreau publiée dans `incident-en-cours` (et dans une conversation directe `dm-alice--release-manager`) : `curl -s` de `/channels/incident-en-cours` et de `/channels/dm-alice--release-manager` ne contient ni `PNJ` ni `non joueur` (`grep -ciE 'PNJ|non joueur'` → 0) ; `app/pages/admin.vue` contient toujours « PNJ » (`grep -c PNJ app/pages/admin.vue` ≥ 1).
- [x] CA9 — `npm test` : `npcNoticeFor` renvoie « Julien Moreau n'est pas disponible pour le moment. » (une mention, PNJ coupés) et « Julien Moreau et Marc Lefort ne sont pas disponibles pour le moment. » (deux mentions) ; `GET /api/channels/incident-en-cours/messages` porte toujours `npc` sur la réponse (données inchangées).

### Vérification
```bash
npm test
grep -rnE 'PNJ|[Pp]ersonnage non joueur' app/ --exclude=admin.vue | grep -vE '^[^:]+:[0-9]+:\s*(//|/\*|\*|<!--)'   # rien
npm run build && FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=500 PORT=10127 node .output/server/index.mjs &
H='x-facilitator-code: animateur'; J='content-type: application/json'; B=localhost:10127
curl -s -X POST $B/api/admin/scenarios/panne-checkout/start -H "$H"
curl -s -X POST $B/api/channels/incident-en-cours/messages -H "$J" -d '{"author":"Alice","text":"@Julien Moreau quel déploiement récent ?"}'
curl -s -X POST $B/api/direct -H "$J" -d '{"participant":"Alice","npcId":"release-manager"}'
curl -s -X POST $B/api/channels/dm-alice--release-manager/messages -H "$J" -d '{"author":"Alice","text":"Quel déploiement récent ?"}'
sleep 3
curl -s $B/channels/incident-en-cours | grep -ciE 'PNJ|non joueur'            # 0
curl -s $B/channels/dm-alice--release-manager | grep -ciE 'PNJ|non joueur'    # 0
grep -c 'PNJ' app/pages/admin.vue                                           # >= 1
```

## Évolution 2026-10-24 (bis) — PNJ interpellé par son nom, sans `@`

Retour d'essai réel : « Claire, tu es là ? » doit faire réagir la CEO, comme entre collègues. Implémentée dans le lot de `specs/033-mention-prenom.md`.

### Périmètre
- Fonction pure `namedPersons(text, knownNames)` dans `shared/utils/mentions.ts`. Elle renvoie les noms complets cités **en clair**, dans l'ordre du texte et sans doublon, soit par le nom complet, soit par le prénom seul.
  - Mot entier : frontière avant et après, comme pour une mention (« Claireval » et « Claire2 » ne comptent pas).
  - Comparaison insensible à la casse et aux accents (« ines » → « Inès Garnier »).
  - Le nom complet est prioritaire. Le prénom n'est accepté que s'il est non ambigu, avec la même règle et le même ensemble de personnes connues qu'en 033.
  - Les segments déjà reconnus comme `@mention` sont ignorés.
- Dispatcher, en canal d'équipe (racine ou fil) :
  - si le message contient au moins une `@mention` d'une personne connue (PNJ ou participant), seuls les PNJ actifs @mentionnés répondent, comme aujourd'hui ;
  - sinon, chaque PNJ actif nommé en clair répond, comme s'il était mentionné : même fil, même délai, même plafond `NPC_MENTIONS_PER_MESSAGE_MAX` par message, mêmes budgets et même réponse « sollicité » au plafond ;
  - sinon, la réponse implicite de fil (H2) s'applique, inchangée.
- Inchangés : aucune réponse à un message de PNJ ni à une annonce ou une alerte ; en conversation directe, seul le PNJ de la conversation répond ; PNJ coupés, aucune réponse. L'avis local `npcNoticeFor` reste limité aux `@mentions`.
- Front : un nom cité en clair n'est **pas** surligné comme une mention et ne déclenche pas `mentions-me`.

### Critères d'acceptation
- [x] CA10 — Vitest `namedPersons`, avec « Claire Dumont », « Julien Moreau », « Inès Garnier » et « Bob » :
  - « Claire, tu es là ? » → `["Claire Dumont"]` ; « claire dumont ? » → idem ; « ines tu confirmes » → `["Inès Garnier"]` ;
  - « Claireval est en panne », « Claire2 » et « ops@claire.fr » → `[]` ;
  - « Julien et Claire » → les deux, dans l'ordre ;
  - avec « Claire Martin » en plus, « Claire ? » → `[]`, mais « Claire Martin ? » → `["Claire Martin"]` ;
  - « @Bob demande à Claire » → `namedPersons` ignore « @Bob » et renvoie `["Claire Dumont"]`. Le dispatcher ne fait pourtant répondre personne, car une `@mention` est présente (CA11).
- [x] CA11 — Vitest (dispatcher), PNJ actifs :
  - « Claire, tu es là ? » à la racine planifie `ceo`, avec `parentId` = id du message ; en fil, la réponse va dans ce fil ;
  - « Claire et Julien, un point ? » planifie `ceo` puis `release-manager` ;
  - « @Julien Moreau tu as vu Claire ? » ne planifie que `release-manager` ; « @Bob demande à Claire » ne planifie rien ;
  - un message de PNJ contenant « Claire », des PNJ coupés ou « Claireval » ne planifient rien ;
  - au plafond, la réponse « sollicité » est publiée comme pour une mention.
- [x] CA12 — `npm run test:http` (build, scénario `panne-checkout` lancé) : `POST` de « Claire, tu es là ? » dans `incident-en-cours` → réponse `npc.id = "ceo"` dans le fil en moins de 5 s ; « Claireval est en panne » → aucune réponse de PNJ au bout de 3 s.
- [x] CA13 — Le HTML SSR de `/channels/incident-en-cours`, après le `POST` de « Claire, tu es là ? », ne contient pas de `data-testid="mention"` sur « Claire ». Le contrôle Chrome relève du CA5 de `specs/033-mention-prenom.md`.

## Évolution 2026-10-24 — Rythme de réponse réaliste
Constat : les PNJ répondent presque instantanément ; en vrai, quelqu'un peut mettre plusieurs secondes, voire minutes, à répondre parce qu'il est occupé ailleurs.
- [x] CA14 — Chaque réponse de PNJ (fil, conversation directe, intervention spontanée) est publiée après un délai : indicateur de frappe immédiat, puis message au bout d'un délai tiré au hasard selon le mode de rythme. Le délai s'ajoute au temps de génération du modèle (on n'attend pas deux fois).
- [x] CA15 — Trois modes de rythme réglables dans `/admin` et par `NPC_PACE` : `instantané` (comportement actuel, défaut des tests), `réaliste` (≈ 5 à 40 s, défaut du déploiement), `occupé` (≈ 30 s à 3 min). Une fiche peut surcharger le rythme d'un PNJ (section `## Disponibilité`, ex. Claire plus lente que Julien), sans casser les fiches existantes.
- [x] CA16 — Un PNJ « occupé » peut afficher un accusé bref (« je regarde, je reviens vers vous ») puis répondre plus tard ; jamais deux réponses identiques.
- [x] CA17 — Les délais sont injectables (horloge/échelle `NPC_DELAY_SCALE`, 0 en test) : Vitest sur le tirage des délais par mode et sur la surcharge de fiche ; `npm run test:http` reste rapide.
- [x] CA18 — Chrome : en mode `réaliste`, l'indicateur de frappe apparaît tout de suite et la réponse arrive après plusieurs secondes ; en `instantané`, comme avant.
