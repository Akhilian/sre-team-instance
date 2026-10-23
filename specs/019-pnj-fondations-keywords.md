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
- Front : un badge « PNJ » à côté de l'auteur d'un message porteur de `npc`. Les noms des PNJ sont ajoutés aux `knownNames` pour surligner les mentions.

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
