# 026 — PNJ : édition en ligne d'une fiche dans `/admin`

## Pourquoi
La phase 2 (GOAL.md) repose sur des fiches de PNJ que l'animateur ajuste entre deux groupes. Avec 025, il faut encore un disque (`NPC_PERSONAS_DIR`) ou un rebuild, ce que Render free ne permet pas. Cette boucle permet de modifier une fiche depuis le navigateur, avec un effet immédiat.

## Périmètre
- **Couche de fiches modifiées** dans `server/utils/npc.ts`. Les fiches lues à la source (dossier ou embarquées) restent à part. Une table `path → PersonaFile` contient les fiches modifiées. Les fiches en service sont celles de la source, chacune remplacée par sa version modifiée si elle existe.
  - « Recharger les fiches » (025) relit la source, mais **les fiches modifiées restent prioritaires**. Une fiche modifiée dont l'original a disparu de la source reste en service.
  - **Persistance : en mémoire seulement**, les modifications sont perdues au redémarrage. Raisons :
    - sur Render free sans Redis, l'instantané 014 est lui-même en mémoire, donc cela ne change rien ;
    - l'instantané contient l'état du chat, et `reset` le vide ; y mettre les fiches mélangerait le contenu du jeu et son état ;
    - « Télécharger .md » couvre le besoin de garder une version modifiée.
  - L'UI le dit en clair (voir plus bas).
- **Routes animateur** (`x-facilitator-code`, 401 sinon) :
  - `PUT /api/admin/npc-personas/edit`, corps `{ path, markdown }` :
    - `path` doit être le chemin d'une fiche en service, sinon 404 : on ne crée pas de nouvelle fiche ;
    - `markdown` est une chaîne de 32 Ko au plus, sinon 413 ou 400 ;
    - la fiche passe le parseur, l'id et le scénario doivent correspondre à `path`, et le nom ne doit pas être déjà pris par une autre fiche en service ;
    - en cas d'échec, la route répond 422 `{ errors: [{ message, line? }] }` et rien ne change ;
    - en cas de succès, la route répond 200 avec la fiche (format `NpcPersonaFileSummary` + `modified: true`) et appelle `dispatcher.replacePersonas`.
  - `POST /api/admin/npc-personas/revert`, corps `{ path }` : supprime la version modifiée et remet la fiche de la source. Réponse 200 avec la fiche d'origine. Répond 404 si `path` n'a pas de version modifiée, ou 409 si l'original n'existe plus à la source.
  - `GET /api/admin/npc-personas` : chaque fiche reçoit `modified: boolean`.
- **Parseur** : quand une erreur porte sur une ligne précise (ligne de front-matter invalide, puce « Sur question précise » refusée), le message contient « ligne N » (numérotée à partir de 1, dans le texte d'origine), et `PersonaParseError` expose `line`. Les messages qui nomment un champ (« champ « name » manquant ») ne changent pas.
- **Limite de corps** : `00-body-limit` accepte jusqu'à 40 Ko (`PERSONA_EDIT_BODY_MAX_BYTES` dans `shared/utils/limits.ts`) **pour cette seule route**. Les autres routes restent à 16 Ko.
- **`/admin`, section « Fiches »** :
  - chaque fiche a un bouton « Modifier », qui ouvre une `<textarea>` pré-remplie avec son Markdown, puis des boutons « Valider et appliquer » et « Annuler » ;
  - les erreurs s'affichent en liste, une par ligne, en texte (sans `v-html`) ;
  - « Télécharger .md » propose le Markdown en cours de saisie, via un `Blob` et `<a download="<id>.md">` ;
  - une fiche modifiée porte un badge « Modifiée » et un bouton « Revenir à l'original » ;
  - une phrase indique : « Modifications en mémoire : perdues au redémarrage du serveur, téléchargez le .md pour les garder. »

## Hors périmètre
- La création d'un nouveau PNJ (« Nouvelle fiche »), le changement d'id ou de scénario d'une fiche, la suppression d'une fiche. Il faudra décider de son intégration au scénario et à `/api/direct`, ce qui fera une boucle à part.
- La persistance des modifications (instantané, Redis, disque), l'historique des versions et l'édition simultanée par plusieurs animateurs (la dernière écriture gagne).

## Critères d'acceptation
- [x] CA1 — Vitest (logique pure de la couche modifiée et du parseur) :
  - une modification valide remplace la fiche en service ;
  - sont refusés, sans rien changer : un `path` inconnu, un id différent du chemin, un nom pris par une autre fiche (casse ignorée) et un texte de plus de 32 Ko ;
  - une puce « Sur question précise » sans `[mots: …]` placée à la ligne 14 donne une erreur avec `line === 14` et « ligne 14 » dans le message ;
  - après un rechargement de la source, la version modifiée reste prioritaire, et `revert` remet l'original.
- [x] CA2 — `npm run test:http` :
  - `PUT …/edit` remplace la fiche `release-manager` par une version où une puce de « Sait » contient `MARQUEUR-EDIT` et répond 200 ; les PNJ étant activés, une mention de Julien Moreau qui vise ce marqueur reçoit une réponse qui le contient ;
  - `GET /api/admin/npc-personas` renvoie `modified: true` pour cette fiche seulement ;
  - `POST …/revert` remet la fiche d'origine, et une nouvelle mention ne renvoie plus `MARQUEUR-EDIT`.
- [x] CA3 — `npm run test:http`, refus :
  - un PUT sans code ou avec un code faux répond 401 ;
  - un `path` hors des fiches en service (`../etc/passwd`, `panne-checkout/inconnu.md`) répond 404 ;
  - une fiche sans `name` répond 422 et l'erreur nomme le champ ; la fiche en service ne change pas ;
  - un corps de 30 Ko valide est accepté ; un corps de plus de 40 Ko répond 413 ;
  - un POST de 20 Ko sur une autre route (`/api/channels`) répond toujours 413.
- [x] CA4 — Les tests `npm test` et `npm run test:http` existants passent, rechargement 025 compris.
- [x] CA5 — Dans Chrome (orchestrateur), sur `/admin` après validation du code :
  - « Modifier » ouvre la textarea pré-remplie ;
  - une erreur volontaire affiche le message avec sa ligne ou son champ ;
  - une version valide montre le badge « Modifiée » et la mention « en mémoire » ;
  - « Télécharger .md » produit un fichier qui contient la saisie ;
  - « Revenir à l'original » retire le badge ;
  - un texte qui contient `<img src=x onerror=alert(1)>` s'affiche en texte brut, sans boîte d'alerte.

## Vérification
```bash
npm test
npm run build && npm run test:http
grep -rn 'v-html' app/ || echo "aucun v-html"
# Manuel : node .output/server/index.mjs, puis /admin dans Chrome (code animateur), section PNJ > Fiches
```

## Notes d'implémentation
- Extraire la logique pure (validation d'une édition, fusion source + modifiées, revert) dans `server/npc/persona-source.ts` ou un nouveau `server/npc/persona-overrides.ts`. Réutiliser la validation de `validateCandidates` (taille, parseur, chemin) et y ajouter le contrôle du nom contre les autres fiches en service.
- `server/utils/npc.ts` : garder `sourceFiles` et `overrides` séparés, recalculer `loadedFiles`/`loadedPersonas` puis appeler `replacePersonas` après une édition, un revert ou un rechargement. Le rapport de rechargement reste celui de 025.
- Parseur : passer le numéro de ligne (index + 1, compté sur le texte normalisé `\r\n` → `\n`) à `PersonaParseError` ; mémoriser la ligne de début de chaque puce « précise ».
- Routes : `server/api/admin/npc-personas/edit.put.ts` et `revert.post.ts`. Le `path` n'est **jamais** utilisé comme chemin de fichier, seulement comme clé comparée aux fiches en service. Vérifier que `00-body-limit` couvre aussi les PUT et que le limiteur de débit lit le corps sans casser la limite propre à cette route.
- Types : ajouter `modified` à `NpcPersonaFileSummary` dans `shared/types/npc.ts`, et le type de la réponse 422.
