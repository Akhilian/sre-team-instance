# 010 — Interface utilisable sur petit écran (portable, tablette)

## Pourquoi
Pendant l'atelier, une partie des participants suit l'incident depuis un téléphone ou une tablette : aujourd'hui `.teams { min-width: 900px }` impose un défilement horizontal et la palette de réactions déborde (dette 007). Rendre l'interface utilisable sous 768 px garantit que « plusieurs personnes depuis des navigateurs différents » (GOAL) inclut les petits écrans. On solde au passage la dette « annonce avec `{}` → 404 ».

## Périmètre
- Point de rupture unique : `@media (max-width: 767px)` (« étroit »). Au-dessus, rendu inchangé ; `min-width: 900px` supprimé (ou limité au mode large).
- En-tête : bouton `data-testid="channel-panel-toggle"` (icône menu, `aria-label="Canaux"`, `aria-expanded`, `aria-controls` vers le panneau), rendu au SSR mais masqué en mode large ; en mode étroit, recherche et libellé « SRE Team Instance » masqués, nom d'affichage réduit à l'avatar.
- Panneau des canaux (`ChannelList`) en mode étroit : tiroir `position: fixed` à gauche (largeur ≤ 85 vw) au-dessus du contenu, fermé par défaut, avec voile semi-transparent ; se ferme au clic sur le voile, sur Échap et à la navigation vers un canal. Création de canal et pastilles de non-lus y restent utilisables.
- Barre d'applications réduite en mode étroit : 48 px de large, icônes seules (libellés masqués).
- En-tête du canal : onglets « Publications / Fichiers / Wiki » masqués, nom du canal tronqué avec ellipsis, avatars de présence conservés.
- Fil : bulles jusqu'à 100 % de la largeur disponible (au lieu de 70 %) ; bouton d'ajout de réaction toujours visible sur écran tactile (`@media (hover: none)`) ; palette de réactions ancrée **au-dessus** du bouton et alignée à droite en mode étroit, sans sortir de l'écran.
- Dette : `POST /api/admin/announcements` avec `channelId` absent, non-chaîne ou vide → 400 (avant la recherche du canal) ; commentaire de la route corrigé.

## Hors périmètre
- Page `/admin` et dialogue de nom en dehors d'un contrôle de non-débordement à 375 px.
- Barre d'applications en bas d'écran, gestes de balayage, PWA / application mobile.
- Autres points de rupture (tablette paysage dédiée, etc.).

## Critères d'acceptation
- [x] CA1 — Via HTTP (code `animateur`) : `POST /api/admin/announcements` avec `{}` → 400, avec `{"channelId":"","text":"x"}` → 400, avec `{"channelId":"nope","text":"x"}` → 404, avec `{"channelId":"general","text":"x"}` → 201.
- [x] CA2 — Le HTML SSR de `GET /channels/general` contient exactement un `data-testid="channel-panel-toggle"` portant `aria-expanded="false"` ; le CSS construit (`.output/public/_nuxt/*.css` ou styles inlinés) contient `max-width: 767px` (ou `max-width:767px`) et ne contient plus `min-width: 900px`/`min-width:900px`.
- [x] CA3 — Vérification visuelle (orchestrateur, Chrome) à 375 px puis 768 px de large sur `incident-en-cours` : `document.documentElement.scrollWidth <= innerWidth` dans les deux cas, y compris avec un message long sans espace et la palette de réactions ouverte sur un message ; à 768 px et plus, le rendu est identique à avant (panneau des canaux visible, bouton menu absent).
- [x] CA4 — À 375 px : la liste des canaux est cachée au chargement ; un clic sur le bouton menu l'ouvre (`aria-expanded="true"`) par-dessus le fil ; un clic sur un autre canal y navigue et referme le panneau ; Échap et un clic sur le voile le referment aussi ; la création d'un canal fonctionne depuis le panneau.
- [x] CA5 — À 375 px : barre d'applications ≤ 48 px de large sans libellés, onglets du canal masqués, bulles plus larges que 70 % de la zone du fil pour un message long ; la palette de réactions s'affiche entièrement dans la fenêtre (son `getBoundingClientRect()` a `left >= 0` et `right <= innerWidth`) et ajouter une réaction fonctionne ; envoi d'un message et réponse en fil fonctionnent ; aucune erreur console ni avertissement d'hydratation.

## Vérification
```bash
npm ci && npm run test && npm run typecheck && npm run build
grep -l 'max-width: *767px' -r .output/public/_nuxt .output/server | head -1   # au moins un fichier
grep -rl 'min-width: *900px' .output/public/_nuxt .output/server | wc -l         # 0
PORT=10130 node .output/server/index.mjs &   # arrêter après le bloc
J='content-type: application/json'; F='x-facilitator-code: animateur'; A=localhost:10130/api/admin/announcements
for d in '{}' '{"channelId":"","text":"x"}' '{"channelId":"nope","text":"x"}' '{"channelId":"general","text":"x"}'; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $A -H "$J" -H "$F" -d "$d"; done          # 400 400 404 201
curl -s localhost:10130/channels/general | grep -o 'data-testid="channel-panel-toggle"[^>]*' # 1 ligne, aria-expanded="false"
```
Puis CA3 à CA5 dans Chrome (fenêtre redimensionnée à 375 et 768 px, mesure `document.documentElement.scrollWidth <= innerWidth` dans la console).

## Notes d'implémentation
- État `channelPanelOpen` dans `[id].vue` (fermé au SSR), passé à `ChannelList` (prop + événement `close`) ; `watch(channelId)` le referme ; voile = élément frère rendu seulement si ouvert ; Échap via écouteur `keydown` monté côté client.
- Styles responsive dans chaque composant (`<style scoped>` + `@media (max-width: 767px)`) : `[id].vue`, `AppBar.vue`, `ChannelList.vue`, `MessageList.vue` (bulle 70 % → 100 %, `overflow-wrap: anywhere`), `MessageReactions.vue` (palette `bottom: calc(100% + 4px); right: 0; left: auto`).
- Ajouter `<meta name="viewport" content="width=device-width, initial-scale=1">` si absent (vérifier `nuxt.config.ts` / `app.vue`).
- Annonce : valider `typeof channelId === 'string' && channelId.trim() !== ''` dans la route avant `addAnnouncement`, sans changer la signature du store.
