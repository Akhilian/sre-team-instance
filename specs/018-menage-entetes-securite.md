# 018 — Ménage avant la phase 2 : en-têtes de sécurité, doublons, reprise de persistance

## Pourquoi
C'est le dernier lot du rapport `specs/015-revue-phase1.md` (gravité basse) avant les PNJ. On garde ce qui protège l'URL publique (B11) et ce qui supprime des doublons ou incohérences que la phase 2 va toucher (B1, B2, B4, B7).

## Périmètre
- B11 : en-têtes de sécurité sur toutes les réponses, et une CSP à nonce sur les pages HTML du build.
- B1 : les limites côté front (`Composer.vue`, `ReplyComposer.vue`, `ChannelList.vue`, `admin.vue`, `useDisplayName.ts`) reprennent `shared/utils/limits.ts`.
- B2 : un seul `processEnv()`, dans `server/utils/env.ts`.
- B4 : à la reprise après une panne de lecture, l'instantané n'est pas importé si le store contient un canal créé pendant la panne.
- B7 : `/admin` recharge la liste des canaux quand la fenêtre reprend le focus.

## Hors périmètre
- B3 `canWrite` : on le garde, il sert aux tests et au diagnostic. `resetPresenceStore` est déjà branché (017).
- B5 comparaison en temps constant : le code généré fait 12 caractères sur 31 symboles, et une attaque temporelle par le réseau via le proxy Render n'est pas réaliste.
- B6, B8 : réglés en 017 (`mentionsMeById`, `totalCount` monotone).
- B9 `encodeURIComponent` : l'id est un slug `[a-z0-9-]` validé au setup, aucun risque.
- B10 échappement du Markdown : seul l'animateur lit le fichier exporté. On en reparlera si les PNJ y écrivent du contenu externe.
- Pas de module `nuxt-security` : pas de nouvelle dépendance.

## Critères d'acceptation
- [x] CA1 — Sur le build, `GET /channels/incident-en-cours` et `GET /admin` renvoient `Content-Security-Policy` avec au moins `default-src 'self'`, `script-src 'self' 'nonce-<n>'` (sans `'unsafe-inline'` ni `'unsafe-eval'` dans `script-src`), `style-src 'self' 'unsafe-inline'`, `connect-src 'self'`, `img-src 'self' data:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` et `frame-ancestors 'none'`. Chaque `<script>` inline de la page (importmap et `window.__NUXT__`) porte `nonce="<n>"`, et le nonce change d'une requête à l'autre (test:http).
- [x] CA2 — Toutes les réponses, pages comme `/api/*`, y compris les erreurs (404, 413), portent `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` et `X-Frame-Options: DENY` (test:http sur `/channels/incident-en-cours`, `/api/health`, `/api/channels/inconnu/messages` et un POST de 20 Ko).
- [x] CA3 — Chrome (orchestrateur), sur le build : la console n'affiche aucune erreur ni violation CSP sur `/` (redirection), `/channels/incident-en-cours` et `/admin`. L'hydratation fonctionne : on envoie un message, on ajoute une réaction, et « Valider le code » réussit dans `/admin`.
- [x] CA4 — `grep -rnE "= (2000|50)\b" app/` ne renvoie plus que des délais (`TYPING_THROTTLE_MS`, `SCENARIO_POLL_INTERVAL_MS`) et aucune limite de longueur. `grep -rn "function processEnv" server/` renvoie exactement une ligne, dans `server/utils/env.ts`.
- [x] CA5 — Vitest (`tests/chat-persistence.test.ts`) : première lecture en échec, puis création d'un canal non par défaut sans message, puis lecture rétablie avec un instantané non vide. Le canal créé est conservé, l'instantané n'est pas importé, et une sauvegarde suit. Le cas « store vierge » (aucun message, canaux par défaut seulement) importe toujours l'instantané.
- [x] CA6 — Chrome (orchestrateur) : `/admin` reste ouvert, on crée un canal dans un autre onglet, puis on revient sur `/admin` : le canal apparaît dans les listes déroulantes, sans recharger la page.

## Vérification
```
npm test
npm run build && npm run test:http
grep -rnE "= (2000|50)\b" app/
grep -rn "function processEnv" server/
FACILITATOR_CODE=animateur PORT=3000 node .output/server/index.mjs &
curl -sI http://localhost:3000/channels/incident-en-cours | grep -iE "content-security|nosniff|referrer|x-frame"
curl -s http://localhost:3000/channels/incident-en-cours | grep -o '<script[^>]*>' 
curl -sI http://localhost:3000/api/health | grep -iE "nosniff|referrer|x-frame"
```
Puis Chrome, pour CA3 et CA6.

## Notes d'implémentation
- Plugin Nitro `server/plugins/security-headers.ts`. Hook `request` : en-têtes communs sur toutes les réponses (CA2). Hook `render:html` : nonce (`crypto.getRandomValues`, en base64) ajouté aux `<script` des fragments `head`/`bodyAppend`/`bodyPrepend`, puis en-tête CSP posé sur `event`. CSP désactivée sous `import.meta.dev` (HMR Vite).
- `style-src 'unsafe-inline'` reste nécessaire : Nuxt met le CSS en ligne (`<style>`) et les `:style` sont rendus en attributs côté serveur.
- B1 : importer `~~/shared/utils/limits` depuis les composants et les pages, comme `[id].vue` le fait déjà. Pas d'import depuis `app/utils` (casse le build Nitro, voir 017).
- B4 : remplacer `storeHasMessages()` par « aucun message et aucun canal hors `DEFAULT_CHANNELS` » dans `server/utils/chat-persistence.ts`.
- B7 : écouteurs `focus` et `visibilitychange` posés dans `onMounted` et retirés au démontage, qui appellent `refreshChannels()`, sans écraser le canal sélectionné.
