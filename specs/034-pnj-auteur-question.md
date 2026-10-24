# 034 — PNJ : la question transmise au modèle porte son auteur

## Pourquoi
Bug relevé en essai (Ollama `qwen2.5:1.5b`) : `buildNpcPrompt` envoie la question en texte brut, alors que l'historique est préfixé de l'auteur. Le modèle ne sait pas qui lui parle et appelle l'interlocuteur par un autre prénom pris dans l'historique, ce qui casse l'illusion d'un collègue (GOAL.md, phase 2). Implémenté dans le lot de `specs/035-pnj-interventions-spontanees.md`.

## Périmètre
- `NpcRequest` gagne `questionAuthor?: string` (auteur du message qui sollicite le PNJ), toujours renseigné par le dispatcher pour une réponse ; absent, le prompt garde la question brute et n'ajoute pas la règle.
- `buildNpcPrompt` : le dernier message `user` devient `<Auteur> : <question>`, même format que l'historique.
- Une règle du `system` nomme l'interlocuteur : « Tu réponds à <Auteur>. Si tu t'adresses à quelqu'un, c'est à lui, par son prénom ; n'emploie jamais un autre prénom pour lui. »
- Vaut pour `openai-compatible` et `anthropic` ; `keywords` inchangé.

## Hors périmètre
- Réécriture du ton et lecture du canal (évolution 2026-10-24 de 020), interventions spontanées (035).

## Critères d'acceptation
- [x] CA1 — Vitest (`buildNpcPrompt`) : avec un historique contenant des messages d'Alice et une question de Bob, le dernier message est `user` et commence par `Bob : `, et le `system` contient « Tu réponds à Bob » ; aucun message du prompt n'attribue la question à Alice.
- [x] CA2 — Vitest (dispatcher) : la requête reçue par le moteur injecté porte `questionAuthor` égal à l'auteur du message, en canal comme en conversation directe.
- [x] CA3 — Vitest (`toAnthropicMessages`) : le dernier message `user` converti commence aussi par `Bob : ` et l'alternance des rôles reste valide.
- [x] CA4 — `npm run test:http` (faux serveur OpenAI-compatible) : après un message d'Alice dans le canal, une mention envoyée par Bob produit une requête dont le dernier message `user` commence par `Bob : `.

## Vérification
```bash
npm test -- prompt npc-dispatcher npc-anthropic
npm run build && npm run test:http
```

## Notes d'implémentation
- `shared/types/npc.ts`, `server/npc/prompt.ts`, `server/npc/dispatcher.ts` (`reply()` passe `message.author`).
- Les interventions spontanées de 035 n'ont pas de question : `questionAuthor` y est absent.
