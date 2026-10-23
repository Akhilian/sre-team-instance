# 013 — Export de la chronologie de l'incident pour le post-mortem

## Pourquoi
L'atelier SRE se termine par un post-mortem : l'animateur doit pouvoir récupérer, depuis `/admin`, la chronologie horodatée de ce qui s'est dit et fait dans les canaux (messages, annonces, alertes et leurs acquittements/résolutions) sans recopier l'écran.

## Périmètre
- Fonction pure `buildTimeline(channels, messagesByChannel)` dans `shared/utils/timeline.ts` → liste d'événements triés par date croissante (à égalité : ordre d'origine), chaque événement `{ at (ISO), channelId, channelName, author, type, text, parentId? }` avec `type` parmi `message` | `reply` | `announcement` | `alert` | `alert-acknowledged` | `alert-resolved`. Une alerte produit 1 à 3 événements : création (auteur « Alerting », texte `[SEV1] titre — service : description`), puis acquittement et résolution (auteur = `acknowledgedBy` / `resolvedBy`, à `acknowledgedAt` / `resolvedAt`, texte rappelant le titre de l'alerte).
- Fonction pure `timelineToMarkdown(events, { title, timeZone = 'Europe/Paris', generatedAt })` : titre `# …`, ligne « Générée le … », puis un tableau Markdown `| Heure | Canal | Auteur | Type | Texte |` (heure `HH:MM:SS` dans le fuseau donné, type en français : Message / Réponse / Annonce / Alerte / Acquittement / Résolution). Les `|` et retours à la ligne du texte sont échappés (`\|`, espace) pour ne pas casser le tableau. Chronologie vide → le tableau est remplacé par « _Aucun événement._ ».
- Route `GET /api/admin/timeline?channelId=<id>&format=md|json` protégée par `x-facilitator-code` (401 vérifié en premier) : `channelId` absent = tous les canaux ; canal inconnu → 404 ; `format` absent = `json` ; autre valeur → 400. `json` → `{ events }` ; `md` → `content-type: text/markdown; charset=utf-8` et `content-disposition: attachment; filename="chronologie-<channelId|tous>.md"`.
- `/admin` : section « Chronologie (post-mortem) » (`data-testid="timeline-panel"`) : choix du canal (option « Tous les canaux » + canaux existants), bouton « Afficher » (aperçu Markdown dans un `<pre>` défilant, `data-testid="timeline-preview"`) et bouton « Télécharger .md » (récupère le Markdown avec le header du code animateur puis déclenche le téléchargement via un `Blob`).
- Dette 012 : la liste des scénarios n'est plus rechargée à chaque frappe du code animateur ; elle l'est au montage si un code est mémorisé, et sur un bouton « Valider le code » (ou Entrée dans le champ).

## Hors périmètre
- Réactions emoji et présence / « en train d'écrire » dans la chronologie.
- Autres formats (CSV, PDF), édition ou annotation de la chronologie, gabarit complet de post-mortem.
- Persistance : la chronologie reflète l'état en mémoire (vidée par la réinitialisation).

## Critères d'acceptation
- [x] CA1 — Tests Vitest de `buildTimeline` : messages de deux canaux fusionnés et triés par date ; une réponse a `type: "reply"` et son `parentId` ; une annonce a `type: "announcement"` ; une alerte acquittée puis résolue par deux personnes différentes produit 3 événements dans l'ordre, avec les bons auteurs et horodatages ; une alerte seulement déclenchée n'en produit qu'un.
- [x] CA2 — Tests Vitest de `timelineToMarkdown` : en-tête du tableau présent, heure formatée dans le fuseau demandé (ex. `2026-10-23T08:05:09Z` → `10:05:09` en `Europe/Paris`), libellés de type en français, un texte contenant `|` et un retour à la ligne reste sur une seule ligne de tableau avec `\|` ; chronologie vide → « _Aucun événement._ ».
- [x] CA3 — Via HTTP : sans code → 401 ; `channelId=inconnu` → 404 ; `format=pdf` → 400 ; après publication d'un message, d'une réponse, d'une annonce et d'une alerte acquittée puis résolue dans `incident-en-cours`, `?channelId=incident-en-cours` (json) renvoie 6 événements triés avec les types attendus ; sans `channelId`, un message posté dans `general` apparaît aussi.
- [x] CA4 — Via HTTP : `?channelId=incident-en-cours&format=md` → 200, `content-type` commençant par `text/markdown`, `content-disposition` contenant `chronologie-incident-en-cours.md`, corps contenant `| Heure | Canal | Auteur | Type | Texte |` et les lignes « Acquittement » et « Résolution » avec leurs auteurs.
- [x] CA5 — Vérification dans Chrome (orchestrateur) : dans `/admin`, saisir le code ne déclenche aucune requête `/api/admin/scenarios` avant « Valider le code » (onglet Réseau) ; la section chronologie affiche l'aperçu pour « Tous les canaux » puis pour `incident-en-cours` ; « Télécharger .md » produit un fichier `chronologie-….md` ; aucune erreur console ; pas de défilement horizontal de la page à 375 px (l'aperçu défile dans son propre cadre).

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
PORT=10133 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; F='x-facilitator-code: animateur'; B=localhost:10133/api; C=incident-en-cours
curl -s -o /dev/null -w '%{http_code}\n' "$B/admin/timeline"                                        # 401
curl -s -o /dev/null -w '%{http_code}\n' "$B/admin/timeline?channelId=inconnu" -H "$F"              # 404
curl -s -o /dev/null -w '%{http_code}\n' "$B/admin/timeline?format=pdf" -H "$F"                     # 400
ROOT=$(curl -s -X POST $B/channels/$C/messages -H "$J" -d '{"author":"Alice","text":"Je regarde | les logs"}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST $B/channels/$C/messages -H "$J" -d "{\"author\":\"Bob\",\"text\":\"ok\",\"parentId\":\"$ROOT\"}" >/dev/null
curl -s -X POST $B/admin/announcements -H "$J" -H "$F" -d "{\"channelId\":\"$C\",\"text\":\"Point dans 10 min\"}" >/dev/null
AL=$(curl -s -X POST $B/admin/alerts -H "$J" -H "$F" -d "{\"channelId\":\"$C\",\"severity\":\"SEV1\",\"title\":\"5xx checkout\",\"service\":\"checkout-api\",\"text\":\"Taux 5xx > 20 %\"}" | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -s -X POST $B/channels/$C/messages/$AL/alert-status -H "$J" -d '{"name":"Alice","status":"acknowledged"}' >/dev/null
curl -s -X POST $B/channels/$C/messages/$AL/alert-status -H "$J" -d '{"name":"Chloé","status":"resolved"}' >/dev/null
curl -s -X POST $B/channels/general/messages -H "$J" -d '{"author":"Dan","text":"hello"}' >/dev/null
curl -s "$B/admin/timeline?channelId=$C" -H "$F"                                                    # 6 événements triés
curl -s "$B/admin/timeline" -H "$F" | grep -c '"general"'                                            # >= 1
curl -s -D - "$B/admin/timeline?channelId=$C&format=md" -H "$F"                                      # en-têtes + tableau
```
(Si l'extraction d'id par `sed` échoue sur le JSON renvoyé, utiliser `node -e` ou `jq` ; vérifier les noms de champs dans les routes 007 et 011.) Puis CA5 dans Chrome.

## Notes d'implémentation
- `shared/utils/timeline.ts` (pur, sans import serveur) + type `TimelineEvent` dans `shared/types/` ; tests dans `tests/timeline.test.ts` ; formatage d'heure via `Intl.DateTimeFormat('fr-FR', { timeZone, hour12: false })`.
- Route `server/api/admin/timeline.get.ts` : `listChannels()` + `listMessages()` du store, `setHeader` pour `content-type` / `content-disposition` en `md`.
- `/admin` : le téléchargement passe par `$fetch(..., { responseType: 'text' })` + `URL.createObjectURL(new Blob(...))` (un simple lien ne transmettrait pas le header du code).
- Dette 012 : remplacer le `watch(code, …)` qui appelle `loadScenarios` par un appel explicite (bouton / Entrée / montage) ; ne pas casser les autres formulaires qui lisent `code`.
