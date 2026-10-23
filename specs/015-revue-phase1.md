# 015 — Revue de la phase 1 (phase 1.5)

Audit fait le 2026-10-23 sur `main` (12f1cc2), sans toucher au code. État de départ : `npm run typecheck` OK, `npm test` OK (13 fichiers, 201 tests), `npm run build` OK (2,8 Mo). Il n'existe toujours aucun test HTTP automatisé.

## 1. Dépendances

| Paquet | Actuelle | Dernière | Montée | Recommandation |
| --- | --- | --- | --- | --- |
| nuxt | 4.6.2 | 4.6.2 | — | À jour. |
| vue | 3.5.44 | 3.5.44 | — | À jour. |
| vue-router | 5.4.0 | 5.4.0 | — | À jour. |
| vitest | 5.0.5 | 5.0.5 | — | À jour. |
| vue-tsc | 3.3.13 | 3.3.13 | — | À jour. |
| typescript | 6.0.3 | 7.0.2 | major | **Ne pas faire.** Le blocage tient toujours. TS 7 (portage natif) n'expose plus l'API JS classique : ses `exports` se limitent à `./lib/version.cjs` et `./unstable/*`. `@volar/typescript` 2.4.30, sur lequel repose vue-tsc, déclare `peerDependencies: { typescript: "<7" }`. Le peer `>=5.0.0` de vue-tsc ne suffit donc pas à garantir la compatibilité. On garde `~6.0`. |
| ioredis | 5.11.1 | 6.0.0 | major | **Ne pas faire.** `unstorage@1.17.6` déclare le peer `ioredis ^5.4.2`, et nitropack 2.13.5 embarque aussi la 5. On attendra qu'unstorage passe à la 6. |
| unstorage | 1.17.6 | 2.0.0-beta.0 | major (bêta) | **Ne pas faire.** C'est une bêta, et Nitro 2 est construit sur unstorage 1. |

**`npm audit`** : 7 vulnérabilités hautes, 0 critique, 0 modérée. Elles forment **une seule chaîne** : `node-forge@1.4.0` (GHSA-86w9-cpqp-85rv, CVSS 7.5, la vérification de signature RSA PKCS#1 accepte des éléments imbriqués en trop), qui arrive par `listhen@1.10.1`, puis `nitropack@2.13.5`, `@nuxt/nitro-server`, et enfin `nuxt` (les autres entrées de `@nuxt/*` ne font que relayer l'alerte).
- **Pas de correctif.** La plage vulnérable est `<=1.4.0`, et 1.4.0 est la dernière version publiée. La « correction » que propose npm consiste à **rétrograder** nuxt en 4.1.3 (une major vers le bas), ce qui est absurde. `overrides` ne sert à rien tant qu'aucune version corrigée n'existe.
- **Dev seulement.** listhen est le serveur de `nuxt dev`, qui utilise node-forge pour les certificats HTTPS locaux. Ni `node-forge` ni `listhen` ne figurent dans `.output/` (vérifié avec grep sur le build). Le runtime de prod sur Render n'est donc pas touché.
- Conclusion : retard justifié, à réexaminer quand node-forge ou listhen sortira une nouvelle version.

## 2. Revue du code de la phase 1

Les points ont été confirmés sur le build (`node .output/server/index.mjs`) avec curl :
- un corps JSON de 50 Mo est lu en entier puis refusé en 400 (en 42 ms) ;
- 50 `POST /api/channels` d'affilée renvoient 50 fois 201 ;
- 30 noms de présence bidon sont acceptés ;
- `POST /api/admin/reset` avec le code par défaut `animateur` renvoie 200.

### Gravité haute
| # | Fichier:ligne | Constat | Correctif proposé |
| --- | --- | --- | --- |
| H1 | `server/api/channels/[id]/messages.post.ts:8` (et tous les `readBody` : `channels/index.post.ts:3`, `presence.post.ts:3`, `admin/*.post.ts:9`, `…/reactions.post.ts:6`, `…/alert-status.post.ts:6`) | Aucune limite de taille du corps : h3 lit et parse le JSON en entier avant la validation (2000 caractères). Quelques requêtes de 50 Mo suffisent à saturer la RAM d'une instance free de 512 Mo. | Middleware `server/middleware/` qui renvoie 413 sur les POST `/api/` sans `content-length` ou au-delà de 16 Ko. |
| H2 | `server/utils/chat-store.ts:186` (`addMessage`), `:357` (`addChannel`), `server/utils/presence-store.ts:68` | Rien n'est borné : nombre de messages par canal, nombre de canaux, entrées de présence (jamais purgées, une par nom distinct, même expiré), auteurs par réaction. Le tout vit en mémoire et part dans l'instantané persisté. Les PNJ de la phase 2 vont accélérer la croissance. | Plafonds dans le store (ex. 2000 messages par canal en FIFO ou 409, 30 canaux, purge des présences expirées dans `recordPresence`) et limiteur de débit simple par IP sur les POST. |
| H3 | `server/utils/facilitator.ts:14` | Si `FACILITATOR_CODE` n'a pas été saisi sur Render, le code de prod est `animateur`, connu de tous. N'importe qui peut alors réinitialiser, publier des alertes ou lancer un scénario (vérifié : reset en 200). | En prod (`NODE_ENV=production`), refuser toutes les routes `/api/admin/*` (503 ou 401) quand la variable est absente, et le journaliser au démarrage. Garder `animateur` seulement en dev. |

### Gravité moyenne
| # | Fichier:ligne | Constat | Correctif proposé |
| --- | --- | --- | --- |
| M1 | `app/pages/channels/[id].vue:168` | Chaque client fait 3 requêtes toutes les 3 s : présence, liste **complète** des messages (texte et réactions) et liste des canaux. Il n'y a ni `since`, ni ETag, ni pause quand l'onglet est caché, ni ralentissement en cas d'erreur. La charge croît en O(clients × messages). | Ajouter `?after=<id>` ou un ETag/304 sur `GET …/messages`, suspendre le polling sur `document.hidden`, ralentir après une erreur. |
| M2 | `server/utils/chat-store.ts:286` (`clearMessages`), `server/api/admin/reset.post.ts:7` | Le reset garde tous les canaux, et aucune route ne permet d'en supprimer un. Les canaux de spam ou de test restent donc pour toujours (et sont persistés). La présence n'est pas remise à zéro non plus. | Option `resetChannels: true` au reset (retour à `DEFAULT_CHANNELS`) et `resetPresenceStore()` dans le reset. |
| M3 | `server/utils/chat-store.ts:394-395, 417` | `importSnapshot` ne valide ni le contenu des réactions ni celui des alertes. Une réaction sans `authors` fait planter `copyMessage` au lieu de renvoyer `false`. L'exception remonte à `.catch` dans `server/plugins/chat-persistence.ts:12`, qui coupe alors **toute** la persistance (aucune sauvegarde ensuite). | Valider `reactions[]` (`emoji` dans la liste, `authors` tableau de chaînes) et `alert` (sévérité, statut), puis entourer l'import d'un `try` qui renvoie `false`. |

### Gravité basse
| # | Fichier:ligne | Constat | Correctif proposé |
| --- | --- | --- | --- |
| B1 | `app/components/Composer.vue:14`, `ReplyComposer.vue:13`, `app/pages/admin.vue:21`, `ChannelList.vue:25`, `app/composables/useDisplayName.ts:4` | Les limites (2000, 50) sont recopiées à la main au lieu de reprendre `TEXT_MAX_LENGTH` / `AUTHOR_MAX_LENGTH` / `CHANNEL_NAME_MAX_LENGTH`, qui vivent dans `server/utils/chat-store.ts:13-15`. | Les déplacer dans `shared/utils/limits.ts` et les importer des deux côtés. |
| B2 | `server/utils/facilitator.ts:8` et `server/utils/chat-persistence.ts:25` | `processEnv()` est écrit deux fois. | Un seul helper, dans `server/utils/env.ts`. |
| B3 | `server/utils/chat-persistence.ts:104, 230` (`canWrite`), `server/utils/presence-store.ts:32` (`resetPresenceStore`) | Exports utilisés seulement par les tests (code mort en prod). `resetPresenceStore` deviendrait utile avec M2. | Brancher `resetPresenceStore` dans le reset ; garder `canWrite`, ou le retirer s'il ne sert pas au diagnostic. |
| B4 | `server/utils/chat-persistence.ts:160` | Au retour de la lecture après une panne, l'instantané est importé si le store n'a aucun message. Les canaux créés pendant la panne sont alors écrasés. | Ne compter « store vierge » que s'il n'y a ni message ni canal hors canaux par défaut. |
| B5 | `server/utils/facilitator.ts:15` | La comparaison du code n'est pas en temps constant. | `timingSafeEqual` sur des buffers de même longueur. |
| B6 | `app/components/MessageList.vue:91, 96, 126, 131` | `mentionsMe` (donc `splitMentions`) tourne 2 fois par message à chaque rendu ; tout est recalculé à chaque poll, car le tableau est remplacé. | Un `computed` qui fait `Map<id, boolean>` une fois par liste. |
| B7 | `app/pages/admin.vue:25` | La liste des canaux de `/admin` est chargée une seule fois : un canal créé ensuite n'apparaît pas dans les listes déroulantes. | `refresh()` au focus de la fenêtre, ou un bouton « Actualiser ». |
| B8 | `app/utils/unread.ts:25` | Après un reset, si un canal non courant dépasse son ancien compteur avant le poll suivant, les non-lus sont sous-estimés (la baisse n'a pas été vue). | Comparer aussi `lastMessageAt`, ou faire passer un « numéro d'époque » de reset dans `GET /api/channels`. |
| B9 | `app/pages/channels/[id].vue:103, 112, 122, 133` | `channelId` est inséré dans l'URL sans `encodeURIComponent`. Sans danger aujourd'hui (slug `[a-z0-9-]`, et 404 au setup). | `encodeURIComponent(channelId.value)`. |
| B10 | `shared/utils/timeline.ts:85` | Seuls `\|` et les retours à la ligne sont échappés. Du HTML ou des liens Markdown saisis par un participant passent tels quels dans le `.md` exporté. | Échapper aussi `<`, `>` et `[`. |
| B11 | Global (`nuxt.config.ts`) | Aucun en-tête de sécurité (CSP, `X-Frame-Options`, `X-Content-Type-Options`). | `routeRules: { '/**': { headers: { … } } }`. |
| Info | Store en général | N'importe quel client peut écrire, réagir ou acquitter sous n'importe quel nom : c'est voulu (aucune authentification dans un atelier). XSS : aucun `v-html`, tout passe par l'interpolation Vue, et les couleurs viennent de tables fixes. Pas de souci. | — |

## 3. Découpage proposé en boucles correctives

1. **016 — Durcissement de l'API (indispensable avant la phase 2)** : H1 (limite de corps, 413), H2 (plafonds sur messages, canaux, présences et réactions, purge des présences, limiteur de débit simple), H3 (code animateur obligatoire en prod), M3 (validation stricte de `importSnapshot`). Ajouter les premiers tests HTTP (`$fetch` sur le serveur de build, ou `@nuxt/test-utils`) pour 413, 429 et 401. La phase 2 va injecter des messages automatiquement : sans ces bornes, le moindre bug d'un PNJ remplit la mémoire.
2. **017 — Polling incrémental et reset complet (fortement conseillé avant la phase 2)** : M1 (`?after=`/ETag, pause quand l'onglet est caché, ralentissement), M2 (reset des canaux et de la présence), B6, B8.
3. **018 — Ménage (peut attendre)** : B1, B2, B3, B4, B5, B7, B9, B10, B11.

Dépendances : rien à monter maintenant. Les trois majors (TS 7, ioredis 6, unstorage 2) sont bloquées pour des raisons justifiées, et l'alerte `npm audit` ne concerne que le dev et n'a pas encore de correctif.
