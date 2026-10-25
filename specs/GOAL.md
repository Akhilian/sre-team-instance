# Objectif

## Demande de l'utilisateur
> Recréer dans ce projet une sorte d'application qui ressemblerait à Teams de Microsoft. Je ne cherche pas à faire une application complètement fonctionnelle. Tu peux skipper certaines options. L'objectif est de simuler un environnement où des personnes peuvent discuter via chat d'un incident pour un exercice.

## Contexte
Support d'un atelier SRE : des participants simulent la gestion d'un incident en discutant dans un faux Teams, ouvert dans leur navigateur, pendant une séance de quelques heures.

## Périmètre visé (par ordre de priorité)
1. Interface au look « Teams » : barre latérale d'applications, liste d'équipes / canaux, zone de conversation, champ de saisie.
2. Identification légère : chaque participant choisit un nom d'affichage (pas de mot de passe, pas de compte).
3. Chat en canal : envoyer un message, voir ceux des autres en quasi temps réel (plusieurs navigateurs).
4. Plusieurs canaux, dont un canal d'incident pré-créé (ex. `#incident-…`), et création d'un canal par un participant.
5. Confort de discussion : réponses en fil, mentions `@nom`, réactions emoji, horodatage, avatars à initiales.
6. Outils d'exercice : message système / annonce d'un animateur, réinitialisation des conversations.

## Hors périmètre
Appels audio/vidéo, partage de fichiers, calendrier, authentification réelle, notifications push, application mobile.

## Contraintes
- Rester dans l'application Nuxt 4 existante (front `app/`, API `server/api/`), déployée sur Render en Web Service Node (une seule instance).
- Pas de base de données externe au départ : un stockage en mémoire côté serveur est acceptable (perte des messages au redémarrage tolérée pour un exercice). Un stockage fichier/clé-valeur peut venir plus tard si utile.
- Temps réel simple et compatible Render (polling court ou SSE ; WebSocket seulement si nécessaire).
- TypeScript ~6.0, `npm run typecheck` et `npm run build` doivent passer à chaque boucle.
- Avancer par petites features vérifiables, une par boucle.

## Définition de « terminé »
Plusieurs personnes, depuis des navigateurs différents, ouvrent l'URL déployée, choisissent un nom, rejoignent le canal d'incident et échangent des messages (avec fils, mentions et réactions) visibles par tous en quelques secondes, dans une interface qu'on reconnaît comme inspirée de Teams. Les points 1 à 5 du périmètre sont livrés ; le point 6 est un bonus.

---

# Phase 1.5 — Revue avant la phase 2

## Demande de l'utilisateur
> Entre la phase 1 et la phase 2, ajouter une petite phase de review du code : vérifier que les dépendances sont à jour et que, fonctionnellement, tout continue de fonctionner globalement. S'il y a des mises à jour importantes à faire, les faire d'abord avant de passer en phase 2.

## Contenu
- Audit des dépendances (`npm outdated`, `npm audit`) : appliquer les mises à jour de sécurité et les montées de version importantes compatibles (Nuxt, Vue, Nitro, Vitest…), en respectant le blocage TypeScript ~6.0 tant que `vue-tsc` ne supporte pas la 7.
- Revue du code de la phase 1 : correction des bugs, du code mort et des incohérences entre modules.
- Contrôle fonctionnel global de bout en bout, dans Chrome et par curl, sur le build : nom d'affichage, canaux, messages, fils, mentions, réactions, non-lus, présence, mobile, alertes, scénario, chronologie, persistance.
- Livrables : un rapport de revue dans `specs/`, puis des boucles correctives si nécessaire, une par lot cohérent.

## Définition de « terminé »
Les dépendances sont à jour ou leur retard est justifié, `npm audit` ne signale rien de haut ou critique sans explication, et le parcours de bout en bout passe. On passe ensuite à la phase 2.

---

# Phase 2 — Personnages non joueurs (PNJ)

## Demande de l'utilisateur
> Cadrer et initier une sous-partie du projet autour de quelques personnages qui pourraient être des PNJ (terme de jeu vidéo) : des personnages qui représentent des fonctions d'une entreprise (CEO, CFO, agence de com… d'autres au choix), peut-être dans d'autres équipes. Chacun détient une partie de l'information (sous la forme d'un RAG ou équivalent). Quand l'équipe démarre le scénario, elle peut s'adresser à ces personas, qui ont chacun une partie de l'info. Une personne centrale peut aussi signaler qu'il y a un incident.

## Intention pédagogique
L'information utile à la résolution est **répartie** : aucun PNJ ne sait tout, et chacun ne livre que ce qu'il sait, avec le ton et les priorités de sa fonction. L'équipe doit poser les bonnes questions aux bonnes personnes, recouper et décider. Un PNJ « lanceur d'alerte » (ex. support client ou NOC) ouvre l'incident.

## Distribution envisagée (à affiner en spec)
- **Lanceur d'alerte** : support client / NOC. Il signale l'incident dans le canal et connaît les symptômes côté clients.
- **CEO** : pression, impact business, demande des points de situation réguliers.
- **CFO** : coût par minute d'indisponibilité, engagements contractuels (SLA, pénalités).
- **Communication / agence de com** : messages publics, page de statut, presse et réseaux sociaux.
- **Équipe Release / Dev d'une autre équipe** : connaît le déploiement récent (l'indice technique).
- **Fournisseur de paiement (externe)** : état de son service, fenêtres de maintenance.
- (Option) **Juridique / DPO** : obligations de notification si des données sont touchées.

## Principes
- Chaque PNJ a une **fiche** (rôle, personnalité, ce qu'il sait, ce qu'il ignore, ce qu'il ne doit pas révéler sans question précise), liée à un scénario.
- Les PNJ répondent quand on les mentionne (`@Nom`) ou par message direct, dans l'interface existante. Leurs messages sont marqués comme venant d'un PNJ.
- Moteur de réponse **interchangeable** derrière une interface claire (ex. `NpcResponder` : fiche + extraits de connaissances + historique → réponse). Implémentations prévues, choisies par variable d'environnement :
  - `keywords` : repli déterministe par mots-clés, sans modèle (défaut, utilisé par les tests) ;
  - `openai-compatible` : tout serveur exposant `/v1/chat/completions` (Ollama, LM Studio, vLLM, llama.cpp… en local ou auto-hébergé), via `NPC_LLM_BASE_URL` et `NPC_LLM_MODEL` ;
  - `anthropic` : API Claude, via `ANTHROPIC_API_KEY` (optionnel).
  Ajouter un fournisseur ne doit toucher qu'un fichier d'adaptateur.
- Récupération (« RAG » simple) séparée du moteur, elle aussi derrière une interface (`KnowledgeRetriever`) : connaissances en fichiers par PNJ, sélection lexicale des extraits pertinents au départ, remplaçable plus tard par des embeddings.
- L'animateur active les PNJ avec le scénario, voit leurs échanges et peut les couper.

## Contraintes
- Mêmes contraintes que la phase 1 (Nuxt existant, mémoire ou stockage léger, typecheck et build verts).
- Aucune dépendance obligatoire à un fournisseur de modèle : l'application fonctionne sans modèle (repli `keywords`). Les secrets et URL éventuels (`ANTHROPIC_API_KEY`, `NPC_LLM_BASE_URL`…) sont déclarés en `sync: false` dans `render.yaml`, jamais commités. Réponses courtes, délai maximal et limitation du nombre d'appels par minute.

- Échelle : **15 participants au maximum**, qui ne parlent pas en permanence (précision de l'utilisateur, 2026-10-23). La performance n'est pas un enjeu : plafonds simples et généreux, pas de mécanisme sophistiqué.

## Définition de « terminé » (phase 2)
Lors d'un scénario lancé par l'animateur, le lanceur d'alerte ouvre l'incident. L'équipe peut interroger au moins 4 PNJ, qui répondent en quelques secondes dans le canal, chacun avec sa part d'information et sa personnalité. Il faut combiner les informations de plusieurs PNJ pour identifier la cause et la bonne communication.

---

# Phase 3 — Hébergement Kubernetes (local d'abord)

## Demande de l'utilisateur
> Propose-moi un plan d'implémentation pour héberger cette instance Teams et les scénarios ainsi que les services nécessaires dans Kubernetes. […] Pour le moment, implémente tout pour que ça marche en local avec un Colima Kubernetes ou une version K3S ou des choses dans ce genre-là.

## Plan retenu (validé dans la conversation du 2026-10-24)
- **Une seule instance de l'application** : l'état (scénario en cours, présence, PNJ, fiches modifiées, `rev`) vit en mémoire → `replicas: 1`, stratégie `Recreate`, pas d'HPA. Redis garde l'instantané des conversations.
- **Image** : `Dockerfile` multi-étapes `node:24-alpine`, utilisateur non root, port 3000, `.dockerignore`.
- **Chart Helm** `deploy/chart/` : application (Deployment, Service, Ingress optionnel), Redis optionnel (StatefulSet + PVC + mot de passe), Ollama optionnel (Deployment + PVC + pull du modèle), ConfigMap de configuration, Secret (`FACILITATOR_CODE`, `REDIS_URL`, `ANTHROPIC_API_KEY`), fiches de PNJ en ConfigMap montée sur `NPC_PERSONAS_DIR` (sans `subPath`, rechargeables depuis `/admin`), sondes sur `/api/health`, ressources, NetworkPolicy. Une release par équipe possible (namespace et code animateur propres).
- `render.yaml` reste en place : les deux cibles cohabitent.

## Contraintes locales
- Cluster : Colima (`colima start --kubernetes`, contexte kubectl `colima`, k3s v1.35, runtime Docker : une image construite par `docker build` est visible du cluster avec `imagePullPolicy: IfNotPresent`, sans registre). Pas d'Ingress controller (Traefik désactivé par Colima) ; `servicelb` de k3s disponible ; StorageClass `local-path`. Helm 4 et kubectl 1.37 installés. Mac 14 cœurs, VM Colima 6 CPU / 10 Gi.
- **Le cluster héberge d'autres projets (`code-escape`, `crossplane-system`…) : n'y toucher sous aucun prétexte.** Tout dans le namespace `sre-teams` (ou un namespace par équipe préfixé `sre-teams-`). Jamais de `kubectl delete` hors de ces namespaces, ni de ressource à portée cluster sans nécessité.
- Ports déjà pris sur le nœud : 3000, 5173, 5174, 5432, 9000, 9443.
- Aucun secret commité ; valeurs locales d'exemple dans un fichier `values-local.yaml` sans secret réel.

## Définition de « terminé » (phase 3)
Depuis un clone propre : une commande (script ou cible `make`/npm) construit l'image et installe le chart dans Colima ; l'application répond sur `http://localhost:<port>` ; un message survit à `kubectl rollout restart` (Redis) ; un scénario se joue avec ses PNJ ; une fiche modifiée dans la ConfigMap est prise en compte par « Recharger » ; Ollama est activable par une valeur du chart et les PNJ répondent via `openai-compatible` ; le README documente installation, accès, désinstallation.

## Qualité et réalisme des PNJ (2026-10-24)
Retour de test d'un scénario : les PNJ répondent à côté (ex. Julien Moreau répond « Je m'occupe du système de paiement » à « quelle version a été déployée ? » alors que sa fiche le dit), certaines questions n'ont aucune réponse (@PNJ d'un autre scénario, message sans mention), et les réponses arrivent presque instantanément, ce qui est irréaliste. Souhait de l'utilisateur : un meilleur modèle quitte à être plus lent, et des délais de réponse crédibles (quelques secondes à quelques minutes : le PNJ travaille sur autre chose).
Terminé : spec 040 (qualité des réponses, bug) et évolution de la spec 019 (rythme de réponse), vérifiées dans Chrome sur Colima. Contexte plus large : `specs/ROADMAP.md`.

## Métriques et SLI/SLO pour sre-teams (2026-10-24)
Demande de l'utilisateur : « Ajoute des métriques et des SLI/SLO pour sre-teams » (l'application de paging elle-même). Découpage : l'app expose des métriques Prometheus (`/metrics`) ; le câblage de collecte (ServiceMonitor/PodMonitor), les SLO (Sloth) et les dashboards vivent dans le dépôt `workshop-platform` (source de vérité de l'infra, voir `/Users/adrien/Desktop/projets/SRE/workshop-platform`), activables par valeur car la VM Colima (10 Gi) est juste.
Contraintes : pas de nouvelle dépendance lourde si évitable ; aucune métrique à forte cardinalité (pas d'identifiant de participant ou de message en label) ; `/metrics` ne doit révéler aucun secret ; kubectl uniquement dans les namespaces `sre-teams` / `sre-teams-*`.
Terminé : métriques exposées et testées, SLI/SLO définis et validés sans déploiement (sloth validate / helm template), dashboard, documentation ; l'objectif pédagogique est que ces SLI/SLO servent d'exemple dans la roadmap (`specs/ROADMAP.md`).

## Évolution 2026-10-25 — version dans /api/health
`GET /api/health` renvoie en plus `version` (chaîne lue depuis `package.json`), champs existants inchangés. Test dans `test:http`. Pas de Chrome, pas de redéploiement. Transverse : voir `SRE/specs/GOAL.md`.

## Évolution 2026-10-25 — chart d'application source de vérité
`deploy/chart` de teams devient la seule version du chart `paging` : y ramener les évolutions de `workshop-platform/charts/paging` (label `app.kubernetes.io/version` + `appVersion`, bloc `metrics`, ServiceMonitor, configmap vers le chart `llm`, retrait d'Ollama et de `ollama.yaml`). Garder le build de l'image et les fiches PNJ ici. Adapter scripts npm `k8s:*`, `local.sh`, README et contrat d'agents (redéploiement, instance). Aucun déploiement. Transverse : `SRE/specs/GOAL.md`. La plateforme retirera ensuite sa copie.

## Évolution 2026-10-25 — SLO Sloth du paging dans teams
Accueillir les SLO Sloth du paging (6 fichiers `paging-*.yaml`, actuellement dans `workshop-platform/observability/sloth/`) et, si pertinent, leurs dashboards ; la plateforme les consommera ensuite. Voir `SRE/specs/GOAL.md`. Aucun déploiement.

## Évolution 2026-10-25 — publication de l'image sur Docker Hub (akhilian)
Les deux dépôts de code publient leurs images sur le Docker Hub de l'utilisateur (`akhilian/*`). DocShare le fait déjà (`.github/workflows/image.yml` : `akhilian/docshare`, `akhilian/docshare-web`, secret `DOCKERHUB_TOKEN`). Teams n'a aucun workflow : ajouter la CI GitHub Actions qui, sur push `main` quand typecheck/tests sont verts, construit le `Dockerfile` et publie `akhilian/sre-teams` (tags : sha complet, version de `package.json`, `latest` ; multi-arch comme docshare), même secret `DOCKERHUB_TOKEN` à créer par l'utilisateur dans le dépôt GitHub. La plateforme consomme `akhilian/sre-teams` (`environments/eks/paging.yaml`). Aucun déploiement ; ne pas lancer le workflow depuis la session.
