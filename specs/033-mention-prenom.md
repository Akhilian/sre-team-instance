# 033 — Mention par le prénom seul

## Pourquoi
Bug relevé en essai réel : « @Claire tu es là ? » dans `incident-en-cours` n'a pas fait répondre la CEO Claire Dumont, car `splitMentions` n'accepte que le nom complet. Dans Teams, on interpelle un collègue par son prénom ; les mentions (GOAL.md, point 5) et l'interrogation des PNJ (phase 2) doivent le permettre.

## Périmètre
- `shared/utils/mentions.ts` : `splitMentions(text, knownNames)` reconnaît aussi `@Prénom`, prénom = premier mot d'un nom connu à plusieurs mots, si ce prénom désigne **une seule** personne connue. Le segment garde `value` = texte saisi (« @Claire ») et `name` = nom complet (« Claire Dumont »).
- Règles, dans cet ordre :
  1. le nom complet reste prioritaire, le plus long d'abord (« @Claire Dumont », et « @Claire » quand un participant s'appelle exactement « Claire ») ;
  2. un prénom partagé par deux noms connus distincts (« Claire Dumont » et « Claire Martin ») est ambigu : pas de mention, le texte reste du texte ;
  3. mêmes frontières et même casse qu'aujourd'hui (insensible à la casse, `@claire` accepté, `ops@claire.fr` refusé).
- `mentionsName` et `isMe` suivent, donc le surlignage et `mentionsMe` côté front aussi : « @Claire » met en évidence le message chez le participant « Claire Dumont ».
- Serveur (`server/npc/dispatcher.ts`, `mentioned`) : la détection d'ambiguïté se fait sur l'ensemble des personnes connues, à savoir tous les PNJ du scénario courant (actifs ou non) et les auteurs distincts du canal (via `deps.history`). Seuls les PNJ **actifs** désignés répondent. L'avis local `npcNoticeFor` bénéficie de la règle sans modification.

## Hors périmètre
- Mention par le nom de famille seul, tolérance aux accents ou aux fautes dans la mention saisie, mention `@canal`.
- Désambiguïsation interactive (elle passe par l'autocomplétion de l'évolution 005).

## Lot
La même boucle implémente aussi :
- `specs/005-mentions-alignement-canal.md`, section « Évolution 2026-10-24 — autocomplétion des mentions » (CA6 à CA9) ;
- `specs/019-pnj-fondations-keywords.md`, section « Évolution 2026-10-24 — personnages non signalés aux participants » (CA7 à CA9).
- `specs/019-pnj-fondations-keywords.md`, section « Évolution 2026-10-24 (bis) — PNJ interpellé par son nom, sans `@` » (CA10 à CA13). Elle réutilise la règle prénom et ambiguïté de 033.

Le vérificateur contrôle les critères des trois documents. Il coche ceux de 033 ici, et ceux des évolutions dans leur spec d'origine.

## Critères d'acceptation
- [x] CA1 — Vitest `tests/mentions.test.ts`, avec `knownNames = ["Claire Dumont", "Julien Moreau", "Bob"]` :
  - « @Claire tu es là ? » → une mention `{ value: "@Claire", name: "Claire Dumont" }` ;
  - « @claire » → idem ;
  - « @Claire Dumont » → `value` « @Claire Dumont » ;
  - « @Bob » inchangé ; « ops@claire.fr » → aucune mention ;
  - `mentionsName("@Claire ?", knownNames, "Claire Dumont")` → vrai.
- [x] CA2 — Vitest, ambiguïté et priorité :
  - avec « Claire Dumont » et « Claire Martin », « @Claire » donne un seul segment texte, alors que « @Claire Martin » est une mention ;
  - avec « Claire » et « Claire Dumont », « @Claire » désigne « Claire » et « @Claire Dumont » désigne « Claire Dumont » ;
  - les tests 005 existants passent toujours.
- [x] CA3 — Vitest (dispatcher) : PNJ actifs, « @Claire tu es là ? » planifie une réponse de `ceo` ; si l'historique du canal contient un message de « Claire Martin », rien n'est planifié ; PNJ coupés, rien.
- [x] CA4 — `npm run test:http` (build), scénario `panne-checkout` lancé : un `POST` de « @Claire tu es là ? » dans `incident-en-cours` fait apparaître en moins de 5 s une réponse avec `npc.id = "ceo"` dans le fil du message. Dans un canal créé pour le test, après un message de « Claire Martin », « @Claire tu es là ? » reste sans réponse au bout de 3 s, et « @Claire Dumont tu es là ? » obtient une réponse.
- [x] CA5 — Chrome (orchestrateur, sur le build, scénario lancé, deux fenêtres « Alice » et « Bob »), un seul parcours pour tout le lot :
  - **prénom** : dans `incident-en-cours`, « @Claire tu es là ? » est surligné comme mention, et Claire Dumont répond dans le fil ;
  - **nom en clair** : « Claire, tu es là ? » sans `@` fait répondre Claire Dumont dans le fil, et « Claire » n'est pas surligné ;
  - **autocomplétion** : taper `@cl` dans le composeur racine affiche une liste contenant « Claire Dumont » ; ↓ et Entrée insèrent `@Claire Dumont ` sans envoyer ; Échap ferme la liste ; dans un fil, `@bo` puis un clic insère `@Bob ` (Bob présent) ; en conversation directe avec Julien Moreau, seul lui est proposé ; le lecteur d'accessibilité de Chrome montre une combobox et des options ;
  - **non signalé** : aucun « PNJ » visible dans la liste des messages, l'en-tête de la conversation directe, la liste « Conversations » et les avis, alors que `/admin` affiche toujours l'interrupteur « PNJ actifs » ;
  - aucune erreur console ni violation CSP.

## Vérification
```bash
npm test && npm run build && npm run test:http
FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=500 PORT=10133 node .output/server/index.mjs &
H='x-facilitator-code: animateur'; J='content-type: application/json'; B=localhost:10133
curl -s -X POST $B/api/admin/scenarios/panne-checkout/start -H "$H"
curl -s -X POST $B/api/channels/incident-en-cours/messages -H "$J" -d '{"author":"Alice","text":"@Claire tu es là ?"}'
sleep 3; curl -s $B/api/channels/incident-en-cours/messages | grep -o '"npc":{"id":"ceo"[^}]*}'   # au moins une ligne
# puis les commandes de vérification des évolutions de 005 et 019, et le parcours Chrome du CA5
```

## Notes d'implémentation
- Dans `candidates()`, construire en plus une table `prénom (minuscules) → nom complet`, en retirant les prénoms vus pour deux noms distincts ou égaux à un nom connu à un mot. `mentionAt` essaie d'abord les noms complets, puis le prénom.
- Dispatcher : passer à `splitMentions` les noms de tous les PNJ du scénario et les auteurs de l'historique, puis ne garder que les PNJ actifs. L'historique doit être lu dès que le texte contient un `@`.
- Front : `knownNames` de `MessageList.vue` (auteurs, PNJ, participant courant) suffit ; aucun changement de rendu n'est attendu pour ce bug.
