# 038 — Onboarding des participants et rôles d'incident

## Pourquoi
Un participant qui arrive dans le faux Teams doit savoir quel rôle il tient, comment marche l'outil, ce qu'il peut faire ou non et comment se déroule l'exercice, pour ne pas être perdu quand les alertes tombent. Rien du scénario ne doit être dévoilé.

## Périmètre
- **Rôles** (`shared/onboarding/roles.ts`, liste ordonnée) : `incident-commander` « Responsable d'incident », `investigation` « Investigation technique », `communication` « Communication », `scribe` « Scribe », `equipier` « Équipier » (défaut). Chaque rôle a un libellé court pour le badge et une fiche : mission (1 à 2 phrases), 3 ou 4 réflexes, à qui parler (fonctions génériques : le responsable, l'équipe, « les collègues des autres services »). Plusieurs personnes peuvent avoir le même rôle.
- **Store en mémoire** `server/utils/role-store.ts` (pur, comme `presence-store.ts`) : rôle par nom de participant, plafond `PRESENCE_ENTRIES_MAX` (au-delà, l'affectation la plus ancienne est écartée), perdu au redémarrage comme la présence ; non touché par les resets.
- **API** : `POST /api/roles` `{ name, role }` → 200 `{ name, role }`, 400 si nom ou rôle invalide (choix du participant). `POST /api/presence` renvoie en plus `roles: Record<nom, roleId>` pour les participants présents (tous canaux). `GET /api/admin/participants` (code animateur) → `{ participants: [{ name, channelId, role }], hasIncidentCommander }` pour les présents ; `POST /api/admin/roles` `{ name, role }` (code animateur) → 200, 400 rôle invalide, 401 sans code valide.
- **Client** : rôle en `localStorage` ; le rôle renvoyé par le serveur fait foi (réattribution par l'animateur) ; si le serveur n'en a pas pour soi (redémarrage, changement de nom), le client renvoie son rôle local par `POST /api/roles`.
- **Parcours d'onboarding** `app/components/OnboardingDialog.vue`, contenu dans `shared/onboarding/steps.ts` (titre + paragraphes + listes, texte brut). Ouvert automatiquement après le choix du nom à la première connexion (indicateur `localStorage`), rejouable par un bouton « Aide » (icône « ? », `aria-label="Aide"`) dans la barre du haut. Étapes, dans cet ordre : 1. Contexte (exercice fictif, entreprise d'e-commerce fictive, des collègues d'autres services joués par l'outil) ; 2. L'outil (canaux, fils, mentions `@` avec autocomplétion, nommer quelqu'un en clair suffit, conversations directes, réactions, cartes d'alerte à acquitter puis résoudre, présence) ; 3. Possible / impossible (pas d'accès aux vrais systèmes, tableaux de bord ni journaux : l'information s'obtient en interrogeant les bonnes personnes ; chacun ne sait que ce que sa fonction justifie et ne livre pas tout sans question précise ; pas de pièce jointe ni d'appel) ; 4. Déroulé (l'incident démarre quand l'animateur lance, les alertes arrivent dans « Incident en cours » ; bonnes pratiques : désigner un responsable, points de situation réguliers, tracer les décisions dans le canal) ; 5. Votre rôle (choix par boutons radio, fiche du rôle sélectionné affichée ; au rejeu, rôle courant présélectionné et modifiable). Boutons Précédent / Suivant / Passer (Passer = rôle courant ou Équipier), « Étape n sur 5 ».
- **Affichage du rôle** : badge à côté de son propre nom dans la barre du haut, dans l'infobulle et l'`aria-label` des avatars de présence (« Nom — Rôle »), et badge à côté de l'auteur des messages des participants dont le rôle est connu (jamais pour Alerting, Animateur ni les collègues joués par l'outil).
- **`/admin`** : section « Participants et rôles » (code animateur) : liste des présents (nom, canal, sélecteur de rôle qui appelle `POST /api/admin/roles`), bouton « Actualiser », avertissement visible « Aucun responsable d'incident désigné » si `hasIncidentCommander` est faux.

## Hors périmètre
- Rôle stocké dans les messages ou dans la chronologie, persistance Redis des rôles, droits différents selon le rôle.
- Parcours d'onboarding pour l'animateur (cf. 037), contenu dépendant du scénario, traduction.

## Critères d'acceptation
- [x] CA1 — Test sans fuite (`tests/onboarding.test.ts`) : le texte concaténé des étapes et des fiches de rôle ne contient (insensible à la casse et aux accents) ni « PNJ », ni le nom complet ni le prénom d'aucune fiche de `server/npc/personas/*/`, ni le titre d'un scénario de `SCENARIOS`, ni le nom d'un canal autre que « Général » et « Incident en cours », ni aucun de `checkout`, `paiement`, `v2.41`, `rollback`, `pool`, `Paiemio`, `Routilo`, `#482`, `fuite`, `données personnelles`, ni aucun nombre d'au moins 2 chiffres. Il vérifie aussi : 5 étapes dans l'ordre du périmètre, 5 rôles avec mission, 3 à 4 réflexes et « à qui parler » non vides, `equipier` par défaut. L'ajout de « Paiemio » à une étape fait échouer le test.
- [x] CA2 — Test unitaire du store (`tests/role-store.test.ts`) : affectation, réaffectation, rôle invalide refusé, plafond (la plus ancienne écartée), `hasIncidentCommander` calculé sur les seuls présents, deux participants avec le même rôle.
- [x] CA3 — HTTP sur le build (`tests/http/roles.test.ts`) : `POST /api/roles` valide → 200, rôle `chef` → 400 ; un battement `POST /api/presence` de ce nom renvoie `roles[nom]` ; `GET /api/admin/participants` sans code ou mauvais code → 401, avec code → le participant et son rôle, `hasIncidentCommander: false` ; `POST /api/admin/roles` sans code → 401, rôle invalide → 400, valide (`incident-commander`) → 200, puis le battement suivant et `GET /api/admin/participants` reflètent le nouveau rôle et `hasIncidentCommander: true`.
- [x] CA4 — SSR : `curl -s http://localhost:3000/channels/incident-en-cours` (build) renvoie 200, contient le bouton `aria-label="Aide"` et ne contient pas le dialogue d'onboarding (rendu côté client seulement, aucun avertissement d'hydratation) ; `grep -rn "v-html" app/` ne renvoie rien ; pas de nouvelle dépendance dans `package.json`.
- [x] CA5 — Chrome (orchestrateur), instance Colima `http://localhost:8088` redéployée, profil vierge : après le nom, le parcours s'ouvre (focus sur le titre de l'étape, navigation au clavier, Échap ferme seulement s'il a déjà été suivi) ; choisir « Scribe » affiche sa fiche ; à la fin, le badge « Scribe » apparaît dans la barre du haut et à côté de ses messages ; le bouton « Aide » rouvre le parcours avec Scribe présélectionné ; rechargement : pas de réouverture automatique. Lisible à 375 px de large (plein écran, pas de défilement horizontal).
- [x] CA6 — Chrome : dans `/admin` (code `demo-animateur`), la section « Participants et rôles » liste le participant avec « Scribe » et affiche « Aucun responsable d'incident désigné » ; le passer en « Responsable d'incident » fait disparaître l'avertissement, et en quelques secondes son badge change côté participant.

## Vérification
```
npm test
npm run build && npm run test:http
node .output/server/index.mjs & sleep 2; curl -s http://localhost:3000/channels/incident-en-cours | grep -c 'aria-label="Aide"'
grep -rn "v-html" app/ ; git diff --stat HEAD -- package.json
npm run k8s:up   # puis Chrome sur http://localhost:8088 et /admin, code demo-animateur
```

## Notes d'implémentation
- Contenu éditable en TS structuré (`shared/onboarding/roles.ts`, `steps.ts`), rendu par interpolation ; ne pas dépendre du `MarkdownBlocks` de 037 ; ne pas lister les collègues joués par l'outil (ni noms ni fonctions précises du scénario).
- Validation du rôle partagée (`isRoleId` dans `shared/onboarding/roles.ts`) ; `POST /api/roles` reste soumis au limiteur (seul `/api/presence` est exclu) ; corps ≤ 16 Ko comme ailleurs.
- `roles` de la présence : rôles des noms présents dans n'importe quel canal (`presence-store` expose la liste des présents) ; le changement de nom (DisplayNameDialog) renvoie le rôle sous le nouveau nom.
- Dialogue : `role="dialog"`, `aria-modal`, `aria-labelledby`, radios natives dans un `fieldset`/`legend`, piège de focus simple ; plein écran sous 600 px ; style des dialogues existants.
- Section admin dans `app/pages/admin.vue` (ou composant `AdminParticipants.vue`), à côté du panneau Scénario ; ne pas toucher aux fichiers de 037 (`AdminGuide.vue`, `MarkdownBlocks.vue`, `docs/guide-animateur/`).
