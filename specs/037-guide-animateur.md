# 037 — Guide animateur par scénario

## Pourquoi
L'animateur doit mener `panne-checkout` et `fuite-donnees` sans relire le code : savoir ce qui arrive et quand, qui sait quoi, quoi attendre de l'équipe, comment la relancer et comment débriefer. Le guide doit rester juste quand les étapes ou les fiches évoluent, et se lire depuis `/admin`.

## Périmètre
- `docs/guide-animateur/panne-checkout.md` et `fuite-donnees.md`, écrits à partir de `server/scenarios/*.ts` et `server/npc/personas/<scénario>/*.md`, avec ces sections `##`, dans cet ordre : **Pitch** (à lire aux participants, sans cause ni solution) ; **Vérité terrain** (cause, chronologie réelle, chiffres clés) ; **Chronologie des injections** (tableau `| t | Canal | Auteur | Résumé |`, `t` au format `m:ss` tiré de `at` en secondes, auteur = nom du PNJ, `Alerting` ou `Animateur`) ; **PNJ** (tableau : nom, rôle, ce qu'il sait, bonnes questions, ce qu'il ne livre que sur question précise, interventions spontanées) ; **Recoupement et décisions attendus** ; **Relances si l'équipe bloque** (3 niveaux, du plus léger au plus explicite) ; **Débrief** (grille appuyée sur l'export de la chronologie de `/admin`) ; **Préparation** (Render ou Colima `npm run k8s:up[:ollama]`, code animateur `FACILITATOR_CODE`, reset messages/tout, choix et limites des moteurs `keywords` / `openai-compatible` / `anthropic`, interrupteur des interventions spontanées).
- `docs/guide-animateur/demo-express.md` : quelques lignes (but, 3 étapes en 6 s, PNJ coupés), section Chronologie incluse.
- Guides embarqués dans le build (serverAssets Nitro `guides`), servis par `GET /api/admin/guides/:scenarioId` (code animateur) → `{ scenarioId, markdown }`.
- Rendu Markdown sans dépendance ni `v-html` : parseur pur en blocs (titres, paragraphes, listes, tableaux ; gras et `code` en ligne), rendu par un composant Vue en interpolation de texte.
- Panneau `<details>` « Guide animateur » dans `/admin`, fermé par défaut, sélection du scénario (les 3 scénarios), chargé à l'ouverture et au changement de scénario, sur le modèle d'`AdminArchitecture.vue`.

## Hors périmètre
- Édition du guide depuis `/admin`, guide généré automatiquement depuis le code.
- Cohérence avec des fiches modifiées à chaud (ConfigMap, édition `/admin`) : le test porte sur les fichiers du dépôt.
- Liens, images, Markdown imbriqué au-delà d'un niveau de liste, export PDF.

## Critères d'acceptation
- [x] CA1 — Test de cohérence (`tests/guides.test.ts`) : pour chaque scénario de `SCENARIOS`, le guide existe ; chaque étape a une ligne de la chronologie avec le même `t` (`m:ss` de `at`) et le même auteur ; pour `panne-checkout` et `fuite-donnees`, chaque fiche du scénario a sa ligne (nom exact) dans le tableau PNJ ; chaque heure (`\d{1,2}h\d{2}`) et chaque nombre d'au moins 2 chiffres de la section « Vérité terrain » figure dans le texte des étapes ou des fiches du scénario (espaces fines/insécables normalisées). Le test échoue si l'on change le `at` d'une étape ou un chiffre d'une fiche cité dans le guide.
- [x] CA2 — Les pitchs ne livrent pas la cause : celui de `panne-checkout` ne contient ni `v2.41.0`, ni `rollback`, ni `pool` ; celui de `fuite-donnees` ni `#482`, ni `Routilo`, ni `48 210` (vérifié par le test de CA1).
- [x] CA3 — Test du parseur Markdown (`tests/markdown-blocks.test.ts`) : titres `#`/`##`/`###`, paragraphes, listes `-` et `1.`, tableau avec en-tête, `**gras**` et `` `code` `` produisent les blocs attendus ; `<script>alert(1)</script>` et `<b>x</b>` restent du texte littéral.
- [x] CA4 — HTTP sur le build (`tests/http/guides.test.ts`) : `GET /api/admin/guides/panne-checkout` sans code ou avec un mauvais code → 401 ; avec le bon code → 200 et `markdown` commence par `# ` et contient `Chronologie des injections` ; scénario inconnu → 404.
- [x] CA5 — `grep -rn "v-html" app/` ne renvoie rien ; `package.json` n'a pas de nouvelle dépendance.
- [x] CA6 — Chrome (orchestrateur), instance Colima `http://localhost:8088/admin` redéployée, code `demo-animateur` : le panneau « Guide animateur » est fermé par défaut ; ouvert, il affiche le guide de `panne-checkout` (titres, tableau de chronologie, gras rendus, aucun `**` ni `|` brut) ; choisir `fuite-donnees` affiche son guide ; sans code valide, message d'erreur et aucun contenu.

## Vérification
```
npm test
npm run build && npm run test:http
grep -rn "v-html" app/ ; git diff --stat HEAD -- package.json
npm run k8s:up   # puis Chrome sur http://localhost:8088/admin, code demo-animateur
```

## Notes d'implémentation
- `nuxt.config.ts` : ajouter `{ baseName: 'guides', dir: '../docs/guide-animateur' }` (dir relatif à `server/`) ; route `server/api/admin/guides/[scenarioId].get.ts` lit `useStorage('assets:guides').getItem('<id>.md')`, 404 si scénario absent de `SCENARIOS`.
- Parseur pur `shared/utils/markdown-blocks.ts` (blocs + segments en ligne `text|strong|code`), composant `app/components/MarkdownBlocks.vue`, panneau `app/components/AdminGuide.vue` (prop `code`), inséré dans `app/pages/admin.vue` près d'`AdminArchitecture`.
- Le test lit guides et fiches via `fs` (comme `tests/npc-helpers.ts`) ; auteur attendu : `persona.name` pour `npc-message`, `ALERT_AUTHOR` / `ANNOUNCEMENT_AUTHOR` de `chat-store.ts` sinon.
- Contenu : demo-express utilise Sarah Benali (fiches de panne-checkout) ; recoupements de référence dans l'en-tête de `fuite-donnees.ts` et les fiches Release + PSP pour `panne-checkout` ; ne citer en « Vérité terrain » que des chiffres présents dans le code.
- Ajouter une ligne au README pointant vers `docs/guide-animateur/`.
