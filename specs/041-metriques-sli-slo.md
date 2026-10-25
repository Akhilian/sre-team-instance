# 041 — Métriques Prometheus et SLI/SLO de l'app de paging

## Pourquoi
Objectif « Métriques et SLI/SLO pour sre-teams » (GOAL.md) : l'app expose `/metrics`, et le dépôt `workshop-platform` porte la collecte, les SLO Sloth et le dashboard, activables par valeur (VM Colima de 10 Gi). Les SLO serviront d'exemple dans la roadmap.

## Périmètre
**A. App (`workshop-teams`)** : registre maison (pas de `prom-client`) et `GET /metrics` au format texte Prometheus 0.0.4. Désactivable par `METRICS_ENABLED=false` (404). Aucun secret, aucun id de participant, de message ou de canal en label.
Métriques (préfixe `paging_`) :
- `http_requests_total{method,route,status_class}` (2xx/3xx/4xx/5xx) et `http_request_duration_seconds{method,route}` (histogramme, buckets 0.01 0.05 0.1 0.25 0.5 1 2.5 5). `route` = motif normalisé (`/api/channels/:id/messages`), jamais l'URL brute ; routes inconnues → `other`. `/metrics` et `/api/health` exclus.
- `messages_posted_total{kind=human|npc|system}`.
- `active_clients` (gauge : participants vus par la présence dans la fenêtre existante ; l'app fait du polling, pas de SSE).
- `npc_replies_total{engine,outcome}` : `outcome` = `ok` | `fallback` (repli keywords après erreur moteur) | `timeout` | `rejected_repeat` (anti-répétition) | `capped` (réponse fixe au plafond) ; `engine` = keywords|openai-compatible|anthropic.
- `npc_generation_duration_seconds{engine}` (histogramme, buckets 0.25 0.5 1 2 5 10 15 30) : durée du seul appel moteur, délai de rythme exclu.
- `npc_engine_errors_total{engine,reason=timeout|http|invalid}`.
- `storage_operations_total{op=read|write,result=ok|error}` et `storage_operation_duration_seconds{op}` (même type de buckets que HTTP) ; `storage_up` (gauge 0/1 = dernier état connu).

**B. SLI/SLO (fenêtre 30 j, période globale du contrôleur Sloth ; 28 j initialement prévus, la changer toucherait aussi DocShare)** :
1. Disponibilité de la messagerie : `POST /api/channels/:id/messages` hors 5xx (4xx exclus du total, comme l'exemple DocShare) — 99,5 %.
2. Latence de publication : 95 % des mêmes requêtes en < 250 ms (bucket `le="0.25"`) — 95 %.
3. Réponses PNJ sans repli : `outcome="ok"` / (ok + fallback + timeout), `capped` et `rejected_repeat` exclus du total — 95 %.
4. Génération PNJ : 90 % des générations du moteur à modèle (engine ≠ keywords) en < 10 s — 90 %. Le rythme pédagogique (`NPC_PACE`) n'entre jamais dans la mesure.

**C. Dépôt `workshop-platform`** (tout désactivable, défaut `false`) :
- `charts/paging` : `metrics.enabled` (défaut false) → `templates/servicemonitor.yaml` (`monitoring.coreos.com/v1`, port `http`, path `/metrics`, intervalle `metrics.interval` 30s), rendu seulement si `metrics.enabled`. Pas d'impact sur la NetworkPolicy existante (l'ingress concerne Redis uniquement) : le vérifier.
- `observability/sloth/paging-*.yaml` : un `PrometheusServiceLevel` par SLO (4), même style que `upload-availability.yaml`.
- `observability/grafana/generate.py` : dashboard `paging.json` généré (trafic, latence p95, SLO, PNJ par outcome, stockage) ; README : option et coût mémoire.

## Hors périmètre
- Déploiement réel, Chrome, alertes Alertmanager personnalisées, traces, métriques Redis serveur (redis_exporter), authentification de `/metrics`.
- Câblage dans `setup.sh`/Makefile au-delà de `make lint`, `prom-client`.

## Critères d'acceptation
- [x] CA1 — Tests Vitest du registre : compteur, gauge, histogramme (buckets cumulatifs, `_sum`, `_count`, `+Inf`), échappement des labels, sortie conforme (`# HELP`/`# TYPE` une fois par métrique), et normalisation de route (ids → `:id`, inconnu → `other`).
- [x] CA2 — `GET /metrics` sur le build : 200, `text/plain; version=0.0.4`, contient `paging_http_requests_total` après une requête sur un canal ; une requête sur `/api/channels/<id-inventé>/messages` n'ajoute aucune série avec l'id ; avec `METRICS_ENABLED=false` : 404 ; la sortie ne contient ni le code animateur, ni `REDIS_URL`, ni clé d'API (le test fixe des valeurs sentinelles).
- [x] CA3 — Test HTTP/unitaire PNJ (moteur factice existant `scripts/fake-openai.mjs` ou injection) : une réponse `ok`, un repli après erreur, un timeout et un rejet anti-répétition incrémentent `paging_npc_replies_total` avec les bons `outcome` ; `paging_npc_generation_duration_seconds` ne dépend pas du délai de rythme (rythme `occupé` + moteur instantané → génération < 1 s).
- [x] CA4 — Stockage : test unitaire avec un stockage factice en échec → `storage_operations_total{result="error"}` augmente et `storage_up` passe à 0, puis 1 au retour.
- [x] CA5 — `workshop-platform` : `helm lint` et `helm template` de `charts/paging` : sans `metrics.enabled` aucun ServiceMonitor ; avec `--set metrics.enabled=true` un ServiceMonitor ciblant le port `http` et `/metrics` ; `make lint` passe.
- [x] CA6 — `workshop-platform` : les 4 fichiers Sloth sont des YAML valides (`sloth validate -i observability/sloth` si installé, sinon parse YAML + vérification que chaque `errorQuery`/`totalQuery` référence une métrique du CA2/CA3 et contient `{{.window}}`), et `paging.json` est du JSON valide régénéré par `generate.py` sans diff, ses requêtes n'utilisant que des métriques existantes.
- [x] CA7 — Documentation : README de l'app (variable `METRICS_ENABLED`, liste des métriques, 4 SLO avec objectif et fenêtre) et README `workshop-platform` (option, coût mémoire) mis à jour.

## Vérification
App : `npm run test`, `npm run build && npm run test:http`, `curl -s localhost:3000/metrics | head` après `node .output/server/index.mjs`.
Platform : `helm lint charts/paging -f values/local.yaml -f environments/local/paging.yaml --set metrics.enabled=true`, `helm template t charts/paging -f values/local.yaml -f environments/local/paging.yaml --set metrics.enabled=true | grep -c ServiceMonitor`, `make lint`, `python3 observability/grafana/generate.py /tmp/x && diff -r /tmp/x observability/grafana`, `sloth validate -i observability/sloth` (sinon `python3 -c "import yaml,glob;[list(yaml.safe_load_all(open(f))) for f in glob.glob('observability/sloth/paging-*.yaml')]"`).

## Notes d'implémentation
- Fichiers `workshop-teams` : `server/utils/metrics.ts` (registre pur), `server/middleware/02-metrics.ts` (hooks `afterResponse`/durée), `server/routes/metrics.get.ts`, `server/npc/dispatcher.ts` + moteurs (points d'instrumentation via `onError`/deps, sans casser la pureté), `server/utils/chat-persistence.ts`, `tests/metrics.test.ts`, `tests/http/metrics.test.ts`, `README.md`.
- Fichiers `workshop-platform` : `charts/paging/values.yaml`, `charts/paging/templates/servicemonitor.yaml`, `observability/sloth/paging-{availability,latency,npc-fallback,npc-generation}.yaml`, `observability/grafana/{generate.py,paging.json}`, `README.md`.
- Le contrôle de route normalisée s'appuie sur le motif Nitro/h3 (`event.context.matchedRoute?.route`), pas sur l'URL.
- Le serveur Prometheus de `workshop-platform` a `serviceMonitorSelectorNilUsesHelmValues: false` : pas de label `release` requis.

## Évolution 2026-10-24 — Performance des modèles de PNJ
Demande : métriques et SLI/SLO sur la performance des modèles (durée de réponse, time to first token, débit…). Les CA1 à CA7 ne changent pas ; les CA8 à CA14 s'y ajoutent.

### Périmètre (évolution)
**D. App : métriques par moteur et par modèle** (moteurs à modèle uniquement ; `keywords` n'émet rien ici). Labels `engine` et `model` ; `model` = valeur de `NPC_LLM_MODEL` / modèle Anthropic configuré (une valeur par instance, jamais une chaîne issue d'un message ; au-delà de 10 valeurs distinctes → `other`). Aucun texte de prompt ni de réponse en label ou en journal.
- `npc_llm_duration_seconds{engine,model,outcome}` : durée totale de l'appel (histogramme, buckets 0.5 1 2 5 10 15 30 60). Remplace pour les moteurs à modèle la mesure de `npc_generation_duration_seconds{engine}` sans la retirer (SLO 4 inchangé).
- ~~`npc_llm_ttft_seconds`~~ (écarté le 2026-10-24 : TTFT exige le streaming, hors périmètre).
- `npc_llm_effective_tokens_per_second{engine,model}` : **débit effectif** = tokens de sortie / durée totale de l'appel, observé seulement si ≥ 2 tokens de sortie (histogramme, buckets 0.5 1 2 5 10 20 40). Mesure bout en bout, traitement du prompt inclus : ce n'est pas le débit de génération pur (celui-ci vient de `llamacpp:predicted_tokens_seconds`). Remplace `output_tokens_per_second` (écarté avec le TTFT).
- `npc_llm_tokens_total{engine,model,direction=input|output}` (compteur) : lus dans `usage` de la réponse non-stream (OpenAI-compatible : `prompt_tokens`/`completion_tokens` ; Anthropic : `input_tokens`/`output_tokens`). Absent de l'API → rien n'est compté (jamais d'estimation inventée).
- `npc_llm_prompt_chars{engine,model}` (histogramme, buckets 500 1000 2000 4000 8000 16000) et `npc_llm_response_chars{engine,model}` (histogramme, buckets 50 100 200 400 800) : taille du prompt envoyé et de la réponse nettoyée.
- `npc_llm_queue_wait_seconds{engine,model}` : attente entre la décision de répondre (après le délai de rythme) et l'envoi effectif de la requête au modèle, s'il existe une file/sérialisation côté app ; sinon la métrique est omise (à signaler dans le rapport, ne pas en inventer une).
- `outcome` ∈ `ok` | `timeout` | `error` | `fallback` | `rejected_repeat`, cohérent avec `npc_replies_total` (le rejet anti-répétition est compté après l'appel, la durée reste celle de l'appel).

**E. ~~Streaming~~** (écarté le 2026-10-24 : TTFT exige le streaming, hors périmètre). Les moteurs restent en `stream: false`, aucun changement de comportement.

**F. SLI/SLO supplémentaires** (30 j, période globale du contrôleur Sloth ; moteurs à modèle, rythme toujours exclu ; objectifs calibrés sur qwen2.5:3b CPU : ≈ 0,2 s à chaud pour 60 tokens, ≈ 15 s de bout en bout ; le 7b à 104 s à froid ne les tiendrait pas, c'est assumé) :
5. ~~TTFT~~ (écarté le 2026-10-24 : TTFT exige le streaming, hors périmètre). La numérotation 6 et 7 est conservée.
6. Débit effectif : 90 % des appels avec débit effectif ≥ 1 token/s (`1 - bucket le="1"` de `npc_llm_effective_tokens_per_second`) — 90 %. Bout en bout, prompt processing inclus ; seuil prudent pour qwen2.5:3b CPU (≈ 40 tokens en 15 s de bout en bout ≈ 2,7 tokens/s), à recalibrer après mesure sur l'instance.
7. Réponse dans le temps imparti : `npc_llm_duration_seconds{outcome="ok"}` / (ok + timeout) avec `le="60"`, soit réponses terminées sous le plafond de 60 s (`NPC_LLM_TIMEOUT_MS` max) — 97 %. Distinct du SLO 4 (< 10 s, 90 %) qui reste le critère de confort.
(SLO 3, repli, est déjà couvert : pas de doublon.)

**G. Dépôt `workshop-platform`**
- `observability/sloth/paging-llm-{throughput,deadline}.yaml` : un `PrometheusServiceLevel` par SLO 6 et 7, même style que `paging-*.yaml`, requêtes agrégées par `sum(...)` sur `engine,model` retirés (SLO global) ; `{{.window}}`.
- `observability/grafana/generate.py` : rangée « Performance du modèle » dans `paging.json` (p50/p95 durée, débit effectif médian, tokens/s entrée+sortie, issues par modèle, taille du prompt) et un dashboard `paging-llm-compare.json` (mêmes panneaux, une série par `model`, variable `$model` multi-valeurs) pour comparer 3b/7b ou moteurs.
- Métriques llama.cpp (`charts/llm`) : ajouter `--metrics` aux args du serveur derrière `metrics.enabled` (défaut false) + `templates/servicemonitor.yaml` (port `http`, path `/metrics`) ; ne garder dans le dashboard que `llamacpp:prompt_tokens_seconds`, `llamacpp:predicted_tokens_seconds` (débit de prompt et de génération côté serveur), `llamacpp:requests_processing` / `llamacpp:requests_deferred` (files d'attente, saturation de `-np`) et `llamacpp:kv_cache_usage_ratio` (remplissage du KV cache). Ollama (chart de l'app) n'expose pas de /metrics natif : rien à scraper, les métriques de l'app suffisent. Aucun SLO sur les métriques llama.cpp (diagnostic seulement). Vérifier les noms exacts avec la version d'image fixée (context7 / `curl /metrics`) avant de les utiliser dans les requêtes.

### Hors périmètre (évolution)
- Streaming (interne ou visible) et TTFT, mesure de la qualité des réponses, estimation de tokens quand l'API n'en renvoie pas, alertes, GPU, exporter Ollama.

### Critères d'acceptation (évolution)
- ~~CA8 — Streaming OpenAI-compatible~~ (écarté le 2026-10-24 : TTFT exige le streaming, hors périmètre).
- ~~CA9 — Streaming Anthropic~~ (écarté le 2026-10-24 : TTFT exige le streaming, hors périmètre).
- [x] CA10 — Durée et débit effectif : `paging_npc_llm_duration_seconds` observé par `engine`/`model`/`outcome` à chaque appel, `paging_npc_llm_effective_tokens_per_second` observé seulement avec `usage` d'au moins 2 tokens de sortie. (TTFT : écarté.)
- [x] CA11 — Tokens et tailles : un faux serveur renvoyant `usage` (entrée 120, sortie 40) fait passer `paging_npc_llm_tokens_total{direction="input"|"output"}` à 120 et 40, pour les deux moteurs ; sans `usage`, aucune série de tokens n'est créée ; `prompt_chars` et `response_chars` sont observés.
- [x] CA12 — Labels et sécurité : `/metrics` ne contient `engine`/`model` que pour les valeurs configurées (test avec modèle sentinelle `m-test` ; plus de 10 modèles distincts → `other`), jamais de texte de message, de prompt, d'URL du modèle ni de clé d'API (sentinelles) ; issues `timeout`, `error`, `fallback`, `rejected_repeat` correctes sur `paging_npc_llm_duration_seconds` ; `keywords` n'émet aucune série `paging_npc_llm_*` ; rythme `occupé` n'augmente pas les durées observées.
- [x] CA13 — `workshop-platform` : 2 fichiers `paging-llm-{throughput,deadline}.yaml` valides (`sloth validate` ou parse YAML + chaque requête référence une métrique `paging_npc_llm_*` du CA10/CA11 et `{{.window}}`) ; `generate.py` régénère `paging.json` (rangée performance) et `paging-llm-compare.json` sans diff, requêtes limitées à des métriques existantes (app ou llama.cpp) ; `charts/llm` : `helm template` sans `metrics.enabled` ne contient ni `--metrics` ni ServiceMonitor, avec `--set metrics.enabled=true` les deux sont présents ; `helm lint` et `make lint` passent.
- [x] CA14 — Documentation : README de l'app (métriques `paging_npc_llm_*`, SLO 6 et 7 avec objectif/fenêtre/hypothèse CPU qwen2.5:3b, débit effectif bout en bout) et README `workshop-platform` (nouveaux fichiers Sloth, dashboard de comparaison, option `--metrics` llama.cpp et métriques retenues).

### Vérification (évolution)
App : `npm run test` (tests CA10 à CA12, sans réseau), `npm run build && npm run test:http` (faux serveur `scripts/fake-openai.mjs`), puis `curl -s localhost:3000/metrics | grep paging_npc_llm_`.
Platform : `sloth validate -i observability/sloth` (sinon parse YAML des `paging-llm-*.yaml`), `python3 observability/grafana/generate.py /tmp/x && diff -r /tmp/x observability/grafana`, `helm template t charts/llm --set metrics.enabled=true | grep -E -c "ServiceMonitor|--metrics"`, `helm lint charts/llm`, `make lint`.

### Notes d'implémentation (évolution)
- App : `server/npc/engines/{openai-compatible,anthropic}.ts` (mesures remontées par `onOutcome`), `ModelCallOutcome` étendu (durée, tokens, tailles) pour remonter les mesures sans importer le registre dans les moteurs, `server/npc/dispatcher.ts` / `server/utils/metrics.ts`, `tests/npc-llm-metrics.test.ts`, `tests/http/`, `README.md`.
- Platform : `observability/sloth/paging-llm-*.yaml`, `observability/grafana/{generate.py,paging.json,paging-llm-compare.json}`, `charts/llm/{values.yaml,templates/llm.yaml,templates/servicemonitor.yaml}`, `README.md`.
- À faire après l'implémentation de CA1 à CA7 (dépend du registre et de `onOutcome`) ; le chart Ollama de l'app (`deploy/chart`) n'est pas modifié.
