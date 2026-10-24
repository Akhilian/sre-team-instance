# 040 — Qualité des réponses des PNJ (bug)

Retour de test du 2026-10-24 (voir `specs/GOAL.md`). Cause établie : `qwen2.5:1.5b` ignore l'extrait de fiche, recopie les phrases de l'historique et les `STYLE_EXAMPLES`. Le routage par mention laisse aussi des questions sans réponse.
Fichiers : `server/npc/prompt.ts`, `server/npc/engines/openai-compatible.ts`, `server/npc/lexical-retriever.ts`, `server/npc/dispatcher.ts`, `server/npc/spontaneous.ts`, `server/npc/personas/*/*.md`, `deploy/` (modèle Ollama), `npm run k8s:up:ollama`.

## Critères d'acceptation
- [x] CA1 — Modèle Ollama par défaut du chart et de `k8s:up:ollama` : `qwen2.5:3b` (requests 3Gi / limits 4Gi, `OLLAMA_KEEP_ALIVE=24h`, sondes tolérantes). Note : le 7b a mesuré 104 s au 1er appel et saturé la VM Colima de 10 Gi ; 7b possible si RAM Colima ≥ 14 Gi (commande dans le README). Plafond `NPC_LLM_TIMEOUT_MS` de 60 s conservé.
- [x] CA2 — L'extrait de fiche retenu par le retriever est donné dans le tour utilisateur (« Fait à utiliser : … »), pas seulement dans le system prompt. Vitest sur le prompt construit.
- [x] CA3 — Les `STYLE_EXAMPLES` ne peuvent plus être recopiés tels quels (retirés ou rendus génériques sans contenu métier) ; test qu'aucune phrase d'exemple n'apparaît dans les prompts.
- [x] CA4 — Anti-répétition : une réponse identique (après normalisation) à l'une des 3 dernières du même PNJ est rejetée ; on retombe sur l'extrait du retriever, puis sur le repli `keywords`. Les phrases génériques déjà dites ne sont plus injectées dans l'historique envoyé au modèle. Vitest.
- [x] CA5 — Cas de référence en Vitest (moteur factice) : « quelle version a été déployée ? » à Julien Moreau ressort v2.41.0 ; « Concerne tous les utilisateurs ou une partie ? » à Sarah ressort « partout, ordinateur comme mobile » ; « mise en prod récente ? » aussi (synonymes ajoutés aux fiches `panne-checkout`, déclencheurs « ensemble/partie/tous/utilisateurs », « mise en prod/dernière »). Le seuil de déclencheurs est abaissé pour les questions courtes.
- [x] CA6 — Dispatcher : `@NomInconnu` (PNJ absent du scénario actif) → message système court dans le fil (« X n'est pas dans ce scénario ») ; mention sans texte (« @Julien ? ») → reprend la dernière question du même auteur dans le canal ; message sans mention dans un canal d'incident → inchangé (aucune réponse), documenté dans le guide animateur. Vitest.
- [x] CA7 — Interventions spontanées : une reformulation identique ou quasi identique à un message récent du même PNJ n'est pas publiée. Vitest.
- [x] CA8 — Test réel (Chrome, Colima avec Ollama) : rejouer « @Julien Moreau Qu'est-ce qui a été déployé récemment, quelle version ? » → la réponse cite v2.41.0 et le rollback v2.40.3 ; la question de Sarah sur la portée obtient une réponse issue de sa fiche ; hors-sujet (« Donne-moi une idée de repas ») → le PNJ reste dans son rôle.
- [x] CA9 — `npm run typecheck`, tests unitaires et `npm run test:http` passent.
