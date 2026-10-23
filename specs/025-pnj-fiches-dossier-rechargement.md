# 025 — PNJ : fiches lues depuis un dossier et rechargées depuis `/admin`

## Pourquoi
La phase 2 (GOAL.md) repose sur des fiches de PNJ que l'animateur doit pouvoir ajuster entre deux groupes. Aujourd'hui, elles sont embarquées au build : il faut un rebuild à chaque retouche. Cette boucle pose la brique de base : une source de fiches remplaçable, une lecture dans `/admin` et un rechargement à chaud. L'édition en ligne viendra dans une boucle suivante.

## Périmètre
- **Source des fiches** : `NPC_PERSONAS_DIR` est optionnelle.
  - Si elle est définie, les fiches sont lues au démarrage dans `<dir>/<scénario>/<id>.md`, sur un seul niveau de sous-dossier.
  - Sinon, ce sont les fiches embarquées (`assets:npc`), comme aujourd'hui.
  - Si le dossier est absent, illisible ou ne contient aucune fiche valide au démarrage, on revient aux fiches embarquées, avec un avertissement d'une ligne.
  - Les validations actuelles restent : parseur, id et scénario cohérents avec le chemin, nom unique.
- **Garde-fous de lecture** :
  - le chemin vient uniquement de la variable d'environnement, aucune requête ne peut l'influencer ;
  - les noms de dossier et de fichier doivent respecter `^[a-z0-9-]+$` (plus `.md` pour les fichiers) ;
  - le chemin réel (`realpath`) doit rester sous le chemin réel du dossier, sinon le fichier est refusé (cas d'un lien symbolique qui sort du dossier) ;
  - une fiche fait au plus 32 Ko, et on lit au plus 50 fiches.
- **Remplacement à chaud** : le dispatcher reçoit une méthode `replacePersonas(personas)`.
  - Elle conserve l'état activé ou coupé, ainsi que le scénario courant tant que ce scénario a encore des fiches.
  - Les réponses déjà planifiées ne sont pas annulées.
  - `findLoadedNpcPersona` voit les nouvelles fiches.
- **Routes animateur** (protégées par `x-facilitator-code`, 401 sinon) :
  - `GET /api/admin/npc-personas` renvoie `{ source: "dir" | "embedded", personas: [{ path, id, name, role, scenarioId, markdown }] }`. `markdown` est le texte source de la fiche chargée.
  - `POST /api/admin/npc-personas/reload` ignore le corps de la requête et relit la source en cours (le dossier, ou les fiches embarquées). Il renvoie `{ source, loaded: [path], errors: [{ path, message }], kept: [path] }` :
    - les fiches valides remplacent les fiches en cours ;
    - une fiche en erreur garde sa version précédente, si elle existe (elle est alors listée dans `kept`) ;
    - une fiche supprimée du dossier disparaît ;
    - si le rechargement ne produit aucune fiche valide, rien n'est remplacé et la route répond 422 avec le même rapport.
- **`/admin`, section « Personnages (PNJ) »** :
  - la section indique la source des fiches ;
  - chaque fiche se déplie (`<details>`) et affiche son Markdown en lecture seule (`<pre>`, sans `v-html`) ;
  - un bouton « Recharger les fiches » affiche le rapport, avec une ligne par fiche en erreur ;
  - le README et `render.yaml` déclarent `NPC_PERSONAS_DIR` (`sync: false`). Le README précise qu'un disque persistant est nécessaire sur Render.

## Hors périmètre
- L'édition en ligne d'une fiche dans `/admin` (textarea, enregistrement en mémoire, export `.md`), prévue en 026.
- L'écriture sur disque, l'ajout de scénario par l'interface, la surveillance automatique du dossier (watch), le changement de `NPC_PERSONAS_DIR` à chaud.

## Critères d'acceptation
- [x] CA1 — Vitest (lecture de dossier, dans un dossier temporaire) :
  - deux fiches valides sont chargées avec leur `markdown` ;
  - sont refusés, chacun avec une erreur nommant son chemin : un fichier de plus de 32 Ko, un fichier `Bad_Name.md`, un lien symbolique vers une fiche hors du dossier, une fiche dont l'id diffère du nom de fichier et un doublon de nom ;
  - un dossier inexistant donne une erreur, sans exception non gérée.
- [x] CA2 — Vitest (fusion et dispatcher) :
  - une fiche en erreur garde sa version précédente (listée dans `kept`), une fiche supprimée disparaît, et un rechargement sans aucune fiche valide ne remplace rien ;
  - après `replacePersonas`, `isEnabled()` et `scenarioId()` sont inchangés, et `findByName` trouve un nom ajouté mais plus un nom retiré.
- [x] CA3 — `npm run test:http`, avec le build lancé sur `NPC_PERSONAS_DIR` = une copie temporaire de `server/npc/personas`, dans laquelle une puce de « Sait » de `release-manager.md` contient le marqueur `MARQUEUR-A` :
  - `GET /api/admin/npc-personas` renvoie `source: "dir"` et 6 fiches, et l'une d'elles a un `markdown` qui contient `MARQUEUR-A` ;
  - les PNJ étant activés, une mention de Julien Moreau dont la question vise ce marqueur reçoit une réponse qui contient `MARQUEUR-A` ;
  - sans code, ou avec un code faux, les deux routes répondent 401.
- [x] CA4 — `npm run test:http`, suite du même serveur :
  - on remplace `MARQUEUR-A` par `MARQUEUR-B` et on rend `cfo.md` invalide (champ `name` supprimé), puis on appelle `POST …/reload` (avec un corps `{ "dir": "/etc" }`, qui doit être ignoré) ;
  - la réponse est 200 : `release-manager` figure dans `loaded`, une entrée de `errors` porte sur `cfo.md` et nomme le champ, et `cfo` figure dans `kept` ;
  - une nouvelle mention de Julien Moreau renvoie `MARQUEUR-B`, et le CFO répond toujours ;
  - si on vide le dossier, le rechargement répond 422 et les 6 PNJ restent listés par `GET /api/npcs`.
- [x] CA5 — Sans `NPC_PERSONAS_DIR`, ou avec un dossier inexistant (avertissement présent dans la sortie d'erreur), le build démarre avec les 6 fiches embarquées, `source` vaut `"embedded"`, et les tests `test:http` existants passent.
- [x] CA6 — Dans Chrome (orchestrateur), sur `/admin` après validation du code :
  - la section PNJ affiche la source et chaque fiche, qui se déplie et montre son Markdown ;
  - « Recharger les fiches » affiche le rapport, avec la fiche en erreur nommée ;
  - un Markdown qui contient `<img src=x onerror=alert(1)>` s'affiche en texte brut.

## Vérification
```bash
npm test
npm run build && npm run test:http
grep -n 'NPC_PERSONAS_DIR' render.yaml README.md server/utils/npc.ts
# Manuel : NPC_PERSONAS_DIR=$(mktemp -d) avec une copie de server/npc/personas, node .output/server/index.mjs, puis /admin dans Chrome
```

## Notes d'implémentation
- Extraire la lecture du dossier dans un module testable, par exemple `server/npc/persona-source.ts`. On lui injecte `fs/promises`, et la source embarquée y figure comme alternative. `server/utils/npc.ts` garde l'état (fiches, texte source, source active) et appelle `dispatcher.replacePersonas`.
- Conserver le texte source par chemin, à côté de `NpcPersona`, sans modifier le type partagé exposé à `/api/npcs`.
- `dispatcher.ts` : `personas` devient une variable réassignable. Si le scénario courant n'a plus aucune fiche, on se rabat sur le scénario de la première fiche.
- Ajouter `NPC_PERSONAS_DIR` à `CLEARED` dans `tests/http/server.ts`, et donner aux routes des noms distincts de `npcs.get.ts`/`npcs.post.ts` (`npc-personas…`).
