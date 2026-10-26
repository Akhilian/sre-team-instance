# 051 — Cohérence collective des PNJ
## Pourquoi
Phase 4 du GOAL : un PNJ doit tenir compte des réponses des autres PNJ de la session (pas de contradiction ni de redite). Aujourd'hui le canal est lu en vrac (`channelContext`, 30 messages) et l'anti-répétition ne compare un PNJ qu'à lui-même ; deux PNJ sollicités par le même message génèrent en parallèle sans se voir.
## Périmètre
- Section dédiée du prompt système « Ce que les autres PNJ ont déjà dit » : réponses des autres PNJ du canal (hors PNJ courant, hors alertes/système), de la plus récente à borner à `NPC_PEER_REPLIES_MAX = 6` messages, chacun tronqué à `NPC_CONTEXT_LINE_MAX_LENGTH`, plus une règle explicite : ne pas contredire ces réponses, ne pas répéter ce qu'un autre a déjà dit, renvoyer vers lui ou compléter.
- Génération séquentielle quand plusieurs PNJ sont ciblés par un même message : la formulation du PNJ n suit la formulation du PNJ n-1 et reçoit son texte dans cette section, même si sa publication (délai réaliste) n'a pas encore eu lieu. L'ordre de publication et les délais existants sont inchangés.
- Anti-redite inter-PNJ : si la réponse générée est quasi identique (`isRepeat`) à une réponse récente d'un autre PNJ, repli existant (extrait de fiche non répété, sinon repli) ; issue comptée `rejected_repeat`.
- Borne d'historique : la section « conversation récente » exclut les messages déjà repris dans la section des pairs (pas de doublon dans le prompt).
- Fichiers : `server/npc/prompt.ts` (section, règle), `server/npc/anti-repeat.ts` (`recentPeerReplies`, `withoutRepeats`), `server/npc/dispatcher.ts` (`reply`, chaînage des cibles, `readChannel`), `server/utils/npc.ts` (câblage inchangé sauf besoin), `shared/utils/limits.ts` (constante).
- Tests : `tests/npc-prompt.test.ts`, `tests/npc-dispatcher.test.ts`, `tests/npc-quality.test.ts`, avec LLM simulé.
## Hors périmètre
- Proactivité / interventions spontanées (spec suivante) : `spontaneous.ts` et le prompt spontané inchangés.
- Résumé du canal généré par le LLM ; changement de modèle ; nouvelle persistance ; modification des fiches PNJ ; UI ; déploiement et `kubectl`.
- Détection sémantique de contradiction par le code (la contradiction est traitée uniquement par l'information et la règle du prompt).
## Critères d'acceptation
- [x] CA1 — `buildNpcPrompt` avec 10 messages de PNJ pairs dans le canal produit un prompt système contenant la section « Ce que les autres PNJ ont déjà dit » avec exactement les 6 plus récents (ordre chronologique), sans message du PNJ courant, d'alerte ni système ; sans PNJ pair, la section est absente (test unitaire).
- [x] CA2 — Le prompt système contient la règle ne pas contredire / ne pas répéter les autres PNJ, uniquement hors intervention spontanée ; le prompt spontané est strictement identique à avant (test d'égalité sur une requête spontanée).
- [x] CA3 — Un message mentionnant deux PNJ A puis B (LLM simulé enregistrant les requêtes) : la requête de B contient le texte de A dans la section des pairs ; l'ordre et les délais de publication sont ceux d'avant (horloge simulée).
- [x] CA4 — LLM simulé renvoyant pour B un texte quasi identique à la réponse de A : le message publié par B n'est pas ce texte (repli extrait/repli) et l'issue `rejected_repeat` est enregistrée.
- [x] CA5 — Taille bornée : avec 30 messages de canal de 600 caractères, la longueur totale des sections « pairs » et « conversation récente » du prompt système reste ≤ `NPC_CONTEXT_SECTION_MAX_LENGTH` + 6 × (`NPC_CONTEXT_LINE_MAX_LENGTH` + 40), et aucun message n'apparaît dans les deux sections.
- [x] CA6 — Les tests existants (662) passent sans modification de leurs attentes, hors ajustements justifiés de prompts attendus ; aucun appel réseau dans les nouveaux tests.
## Vérification
`npx vitest run tests/npc-prompt.test.ts tests/npc-dispatcher.test.ts tests/npc-quality.test.ts` ; puis contrôles standards du contrat.
## Notes d'implémentation
- Réutiliser `isRepeat` et `contextLine` ; extraire les pairs depuis `channelContext` (déjà lu par `readChannel`), les réponses non publiées des cibles précédentes s'y ajoutent en mémoire dans le dispatcher.
- Le chaînage séquentiel ne doit pas retarder la publication de A ; seul le démarrage de B attend la fin de la génération de A (délai total borné par `respondTimeoutMs` par PNJ).
- Question bloquante tranchée par défaut sur « historique brut borné + section dédiée » (voir rapport) ; à réviser si l'utilisateur choisit le résumé.
