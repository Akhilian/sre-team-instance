# Roadmap — parcours à paliers (incident, SLI/SLO, monitoring)

Cadrage du 2026-10-24. Aucune spec ni développement lancé : c'est une vision, à découper en boucles plus tard.

Source d'outillage : dépôt voisin `workshop-docshare` (DocShare, atelier SLI/SLO) — FastAPI, Vue, Helm, Prometheus/Sloth/Grafana/Tempo, k6, 6 pannes injectables via `POST /admin/faults`. Voir l'analyse en bas de fichier.

## Principe directeur
- **L'alerting n'est pas le produit, c'est une leçon.** Au début, aucun alerting : les équipes détectent par l'observation ou par des « plaintes utilisateurs » simulées. L'alerting arrive tard, d'abord technique et bruyant, puis remplacé par du burn rate. Alertmanager reste optionnel.
- **Même appli (DocShare) et mêmes pannes à chaque palier** ; ce sont les compétences demandées qui changent (le même incident se vit en aveugle, avec des métriques, puis avec un SLO).
- **Trois axes, un fil rouge** : incident (rôles, communication, diagnostic, décision, postmortem), SLI/SLO (choisir, mesurer, objectif, budget d'erreur), monitoring (métriques, dashboards, traces, puis alertes).

## Paliers

| Palier | Titre | Incident | SLI/SLO | Monitoring |
|---|---|---|---|---|
| 0 | Découvrir le service | Rôles et vocabulaire (socle d'onboarding existant) | Ressentir le service comme utilisateur | Aucun outil |
| 1 | Voir | Premier incident simple, guidé, sans outillage de diagnostic | Notion de signal | Dashboards bruts, catalogue des métriques, tutoriel PromQL |
| 2 | Mesurer | Incident détecté sur dashboard, journal d'incident | Définir un SLI par parcours (disponibilité, latence) | Requêtes, heatmaps, exemplars, traces |
| 3 | S'engager | Incident où le SLO tranche (gravité, priorité) | Poser un SLO, lire le budget d'erreur, un SLO complété par équipe | Vue burn rate, vue animateur multi-équipes |
| 4 | Alerter avec discernement | Mini-astreinte : réception, accusé, escalade | Burn rate multi-fenêtres vs seuil technique | Alertmanager simple (webhook vers l'app Nuxt), comparaison des deux approches |
| 5 | Piloter | Incident complexe multi-pannes, postmortem sans blâme, actions correctives | Revue de SLO, arbitrage fiabilité / rythme de livraison | Observabilité de l'observabilité (angles morts) |

Difficulté des incidents : P1 panne franche (`upload_error_rate`, `upload_latency`) ; P2-P3 panne dégradée (`worker_slow`) ; P3-P5 pannes silencieuses (`stale_index`, `notifier_drop`) invisibles aux alertes techniques, révélées seulement par le bon SLI.

## Chantiers transverses
1. **Orchestrateur de scénarios (Nuxt)** : timeline de pannes par équipe, déclenchement manuel par l'animateur, reset en un clic, journal des actions. Pièce centrale (aujourd'hui les pannes s'activent à la main).
2. **Fusion d'outillage** : `workshop-teams` pilote `workshop-docshare` par API, sans copier le code (recommandé).
3. **Pannes d'infrastructure** : crash, OOM, Redis/Postgres indisponible, déploiement cassé, saturation CPU (illustrent l'alerting technique du palier 4 et ses limites).
4. **Accessoires pédagogiques** : fiches de rôle, runbooks volontairement incomplets, modèle de postmortem, journal d'incident, grille d'évaluation par palier.
5. **Pupitre animateur** : état des équipes, pannes actives, progression par palier, minuteur.

## Autres sujets de formation envisageables
Communication de crise (page de statut, parties prenantes) ; revue de postmortem (causes racines, facteurs contributifs) ; capacity et saturation (signaux dorés, quotas, autoscaling) ; gestion du changement (déploiement qui casse, rollback vs correctif) ; chaos léger (panne tirée au hasard) ; dette de monitoring (dashboards qui mentent, métriques manquantes) ; coûts et cardinalité Prometheus ; astreinte durable (fatigue, rotation, passation).

## Décisions ouvertes
1. Cible : un atelier unique multi-paliers ou des modules indépendants (une demi-journée par palier) ?
2. Public : niveau d'entrée, nombre d'équipes (le `workshop-docshare` en gère 4), durée par palier.
3. ~~Licence~~ — close (2026-10-24) : le dépôt `workshop-docshare` et les images `akhilian/*` appartiennent à l'utilisateur ; réutilisation libre, pas de contrainte de licence. L'infra est centralisée dans le dépôt `workshop-platform`.
4. Alertmanager : palier 4 seulement, ou jamais ? (optionnel par défaut)
5. `/admin/faults` sans authentification : à sécuriser avant tout accès distant par l'orchestrateur.

## Ordre conseillé
1. Orchestrateur de scénarios + reset.
2. Paliers 1 à 3 (réutilisent `workshop-docshare` presque tel quel) + cadrage pédagogique et accessoires d'incident.
3. Pupitre animateur.
4. Palier 4 (Alertmanager + webhook Nuxt).
5. Palier 5 (pannes d'infra + postmortem).
6. Sujets annexes selon les retours des premières sessions.

## Annexe — analyse du dépôt `workshop-docshare` (2026-10-24)
- **Archi** : FastAPI hexagonal, une image, rôles `ROLE=api|worker|notifier|standalone` (standalone = en mémoire, sans Redis/Postgres) ; flux api → Redis → worker (OCR simulé) → notifier ; module optionnel Kafka + OpenTelemetry/Tempo. Web Vue 3 + nginx, pupitre de pannes `FaultConsole.vue` (`?admin`).
- **Déploiement** : chart Helm `deploy/helm/docshare/`, monitoring partagé `deploy/monitoring/` (kube-prometheus-stack 92.3.0, Sloth 0.16.0, Tempo 3.2.0), Terraform EKS, `setup.sh`/`teardown.sh` idempotents, un namespace `team-<nom>` et un kubeconfig par équipe.
- **Pannes** (`app/adapters/faults.py`, état dans le hash Redis `faults`, isolées par équipe) : `upload_latency`, `upload_error_rate`, `worker_slow`, `stale_index`, `notifier_drop`, `consumer_lag`.
- **Trafic** : Job k6 à débit constant (≈1 upload/s, 2 recherches/s, 3 h).
- **Observabilité** : métriques `/metrics`, 4 dashboards Grafana générés (`observability/grafana/generate.py`), SLO Sloth (1 complet + 5 squelettes avec solutions). Alertmanager désactivé.
- **Points d'attention** : `/admin/faults` sans auth ; ajouter une panne touche faults.py, chart, doc, generate.py et specs ; ~30 fichiers modifiés non commités dans `workshop-docshare` (touchent les pannes, non inspectés) ; dimensionnement ≈ 4 vCPU / 7 Gi pour 4 équipes ; images publiées sous le compte Docker Hub `akhilian` (compte de l'utilisateur).
