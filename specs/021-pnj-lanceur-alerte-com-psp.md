# 021 — PNJ : lanceur d'alerte, Communication et prestataire de paiement, information répartie

## Pourquoi
La définition de « terminé » de la phase 2 (GOAL.md) demande qu'un lanceur d'alerte PNJ ouvre l'incident et qu'il faille recouper plusieurs PNJ pour trouver la cause et la bonne communication. Aujourd'hui, le scénario livre la cause dans une alerte (t=620), et le moteur `keywords` livre une information précise sur un seul mot.

## Périmètre
- **Étape `npc-message`** dans `shared/types/scenario.ts` : `{ at, channelId, kind: 'npc-message', npcId, text }`. `npcId` est l'id d'une fiche, cherché parmi toutes les fiches chargées. La publication passe par `addNpcMessage` : message racine, auteur = nom de la fiche, champ `npc`, badge « PNJ ». L'étape est publiée même si les PNJ sont coupés. Si la fiche est introuvable, l'étape passe en `failed`. Les fiches sont chargées avant `startScenario`, pour que l'étape `at: 0` les trouve. `ScenarioRunStep.label` vaut `Nom : début du texte`, et `/admin` affiche « PNJ » pour ces étapes.
- **`panne-checkout`** :
  - t=0 : Sarah Benali (`support-n1`) ouvre l'incident dans `incident-en-cours` en décrivant les premiers symptômes clients. Les alertes techniques arrivent ensuite, la première à t ≥ 20.
  - Les annonces qui correspondent à un PNJ deviennent des `npc-message` de ce PNJ : `[Support N1]` → `support-n1`, `[Direction e-commerce]` → `ceo`, `[Community management]` → nouveau PNJ Communication, `[Finance]` → `cfo`.
  - Les annonces `[CTO]`, `[Service client grands comptes]` et `[Animateur]` restent des annonces.
  - L'alerte de t=620 devient un indice neutre : « un déploiement de checkout-api a eu lieu peu avant la première alerte, voir avec l'équipe Release ». Elle ne donne ni version, ni changelog, ni paramètres, ni rollback.
- **`demo-express`** : t=0, message de Sarah (`support-n1`) dans `incident-en-cours` ; t=3 et t=6, les deux alertes de démonstration.
- **Nouvelle fiche `communication.md`** (par exemple « Inès Garnier », responsable communication, agence externe) :
  - elle gère la page de statut (encore « tout est opérationnel »), les réseaux sociaux (mentions en hausse, un compte influent), une demande de journaliste avec heure limite, et l'envoi technique de la newsletter (pause possible) ;
  - elle veut un message validé, avec l'impact en mots simples, une heure de retour, la validation de la CEO et aucune promesse de remboursement ;
  - elle ignore la cause technique et les coûts.
- **Nouvelle fiche `psp.md`** (par exemple « Thomas Keller », responsable technique de compte chez le prestataire de paiement, « PayNova ») :
  - son service est sain : p95 d'environ 180 ms côté PSP, aucune maintenance aujourd'hui (la prochaine est à une autre date), aucun incident ouvert ;
  - sur question précise :
    - les appels du client arrivent lentement à s'établir, avec jamais plus de 10 connexions simultanées ouvertes depuis vos IP (contre environ 80 d'habitude) ; l'attente a donc lieu avant l'envoi, chez vous ;
    - la même demande de paiement arrive 2 à 3 fois à quelques secondes d'écart, ce qui explique les doubles débits signalés par Sarah ;
  - il ignore vos déploiements et vos versions.
- **Répartition de l'information** :
  - seule la fiche `release-manager` contient `v2.41.0` et `v2.40.3` ;
  - les paramètres du client HTTP (pool de 10, retries, timeout) ne figurent que dans les entrées « Sur question précise » de `release-manager` ;
  - « 10 connexions » ne figure que dans les fiches `release-manager` et `psp` ;
  - aucune autre fiche ni aucune étape de scénario ne contient ces éléments.
- **Moteur `keywords` / retriever** :
  - une entrée « Sur question précise » n'est éligible que si la question contient **au moins 2 déclencheurs distincts** de l'entrée, ou **un déclencheur spécifique** ;
  - un déclencheur spécifique est préfixé de `!` dans la fiche (`[mots: déploiement, version, !changelog, !v2.40.3]`), et le parseur retire le `!` ;
  - le parseur refuse une entrée qui n'a ni déclencheur spécifique ni au moins 2 déclencheurs ;
  - les 6 fiches sont annotées en conséquence ;
  - les puces « Sait » ne changent pas.

## Hors périmètre
- Messages directs aux PNJ, adaptateur `anthropic`, PNJ CTO, Juridique ou grands comptes, embeddings, réglage des PNJ depuis `/admin`.

## Critères d'acceptation
- [x] CA1 — Vitest (scénarios) :
  - `panne-checkout.steps[0]` vaut `{ at: 0, kind: 'npc-message', npcId: 'support-n1', channelId: 'incident-en-cours' }`, et la première alerte arrive à `at > 0` ;
  - les étapes `npc-message` comprennent `ceo`, `cfo` et `communication` ;
  - aucune annonce ne commence par `[Support`, `[Direction`, `[Community` ou `[Finance` ;
  - chaque `npcId` (des deux scénarios) correspond à une fiche existante ;
  - aucune étape ne contient `v2.41.0`, `v2.40.3`, `10 connexions` ni `rollback` ;
  - `demo-express` publie à 0, 3 et 6 s, et l'étape 0 est un `npc-message` de `support-n1`.
- [x] CA2 — Vitest (runner) :
  - une étape `npc-message` appelle la publication avec la fiche résolue et passe en `published` ;
  - avec un `npcId` inconnu, elle passe en `failed`, sans bloquer les étapes suivantes ;
  - `label` commence par le nom du PNJ.
- [x] CA3 — Vitest (fiches) :
  - les 6 fiches se chargent, avec les ids `ceo, cfo, communication, psp, release-manager, support-n1` ;
  - le parseur refuse `[mots: carte] …`, mais accepte `[mots: !carte] …` et `[mots: carte, paypal] …` ;
  - les règles de répartition sont tenues : `v2.41.0` et `v2.40.3` uniquement dans `release-manager`, `10 connexions` uniquement dans `release-manager` et `psp`, et dans `release-manager` uniquement dans les entrées précises.
- [x] CA4 — Vitest (`keywords` + retriever) :
  - Julien, « Quel déploiement récent ? » : la réponse contient `v2.41.0` mais ni `10 connexions` ni `v2.40.3` ;
  - Julien, « Quel est le changelog de la release ? » : la réponse contient `10 connexions` (déclencheur spécifique) ;
  - Julien, « Quelle configuration du pool et des timeouts ? » : la réponse contient `10` (2 déclencheurs) ;
  - Sarah, « Et la carte ? » : la réponse ne contient pas `carte cadeau` ;
  - Sarah, « Des clients débités deux fois ? » : la réponse contient `deux fois`.
- [x] CA5 — Vitest (nouveaux PNJ, moteur `keywords`) :
  - Thomas, « Vous avez une maintenance ou un incident en cours ? » : la réponse contient `aucune maintenance` (insensible à la casse) ;
  - Thomas, « Combien de connexions ouvrons-nous chez vous ? » : la réponse contient `10` ;
  - Inès, « Que publie-t-on sur la page de statut ? » : la réponse contient `valid`.
- [x] CA6 — `npm run test:http` :
  - après `POST /api/admin/scenarios/demo-express/start`, `incident-en-cours` contient en moins de 2 s un message racine d'auteur `Sarah Benali`, avec `npc.id = "support-n1"`, créé avant la première alerte de la démo ;
  - après `reset` puis lancement de `panne-checkout`, le premier message de `incident-en-cours` est celui de Sarah, et `run.steps[0]` vaut `{ kind: "npc-message", status: "published" }` ;
  - `@Thomas Keller y a-t-il une maintenance ?` reçoit une réponse PNJ en fil.
- [x] CA7 — Chrome (orchestrateur), sur le build :
  - le lancement de `demo-express` depuis `/admin` affiche dans `incident-en-cours` le message de Sarah Benali avec le badge « PNJ », avant l'alerte ;
  - la liste des PNJ de `/admin` montre les 6 PNJ ;
  - aucune erreur en console ni violation CSP.

## Vérification
```bash
npm test
npm run build && npm run test:http
FACILITATOR_CODE=animateur NPC_REPLY_DELAY_MS=200 node .output/server/index.mjs &
curl -s -X POST localhost:3000/api/admin/scenarios/demo-express/start -H 'x-facilitator-code: animateur'
sleep 1; curl -s localhost:3000/api/channels/incident-en-cours/messages | grep -o '"author":"Sarah Benali"[^}]*'
grep -rn 'v2.41.0\|10 connexions' server/npc/personas server/scenarios
```

## Notes d'implémentation
- `publishScenarioStep` (`server/utils/scenario-runner.ts`) : il faut un accès synchrone aux fiches. Exposer depuis `server/utils/npc.ts` une recherche par id sur les fiches déjà chargées, et faire `await useNpcDispatcher()` dans `start.post.ts` avant `startScenario`.
- Retriever : `server/npc/lexical-retriever.ts` (`triggerPresent` existe déjà ; compter les déclencheurs distincts et lire un drapeau `specific`). Type : `NpcPreciseEntry` dans `shared/types/npc.ts`. Parseur : `persona-parser.ts`.
- Mettre à jour `tests/scenarios.test.ts`, `tests/npc-personas.test.ts`, `tests/npc-keywords.test.ts`, et la prise en compte de `kind` dans `admin.vue` et `timeline.ts`, qui n'ont pas besoin de cas `npc-message` : c'est un message `npc` ordinaire.
- La CA1 de 020 (« Quel déploiement récent ? » → `v2.41.0` dans le prompt) reste vraie grâce à la puce « Sait ».
