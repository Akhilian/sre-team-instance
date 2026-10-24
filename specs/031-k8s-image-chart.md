# 031 — Kubernetes : image Docker et chart Helm (application + Redis)

## Pourquoi
Phase 3 de `specs/GOAL.md` : héberger l'instance dans le Kubernetes local Colima en une commande, avec des conversations qui survivent à un redémarrage du pod grâce à Redis.

## Périmètre
- `Dockerfile` multi-étapes `node:24-alpine` (`npm ci` + `npm run build`, puis image finale avec `.output/` seul), utilisateur non root, `EXPOSE 3000`, `HOST=0.0.0.0` ; `.dockerignore` (`node_modules`, `.output`, `.nuxt`, `.git`, `specs`, `.env*`…).
- Chart `deploy/chart/` : Deployment de l'application (`replicas: 1`, `strategy: Recreate`, `imagePullPolicy: IfNotPresent`, sondes readiness/liveness sur `/api/health`, ressources), Service `LoadBalancer` (servicelb de k3s) sur le port **8088** → 3000, ConfigMap (`NODE_ENV`, `NPC_ENGINE`…), Secret (`FACILITATOR_CODE`, `REDIS_URL` construit avec le mot de passe Redis, `ANTHROPIC_API_KEY` optionnel).
- Redis optionnel dans le chart (`redis.enabled`, défaut `true`) : StatefulSet `redis:7-alpine` avec `--requirepass` et `--appendonly yes`, PVC `local-path`, Service `ClusterIP` uniquement (le port 6379 est déjà pris sur le nœud).
- `deploy/values-local.yaml` : valeurs d'exemple, aucun secret réel (code animateur et mot de passe Redis de démonstration, commentés comme tels).
- Script `deploy/local.sh` (ou `scripts/k8s-local.sh`) avec deux sous-commandes : `up` (`docker build -t sre-teams:local .`, `helm upgrade --install sre-teams deploy/chart -n sre-teams --create-namespace -f deploy/values-local.yaml --wait`, puis attente de `/api/health` sur `http://localhost:8088`) et `down` (`helm uninstall` dans `sre-teams`, puis suppression du namespace `sre-teams` uniquement, PVC compris). Exposé aussi en `npm run k8s:up` / `npm run k8s:down`.

## Hors périmètre
- Ollama, fiches de PNJ en ConfigMap montée sur `NPC_PERSONAS_DIR`, NetworkPolicy, Ingress, release par équipe, README : boucle 032 et suivantes.
- Modification de `render.yaml` (les deux cibles cohabitent) ; registre d'images.

## Critères d'acceptation
- [x] CA1 — `docker build -t sre-teams:local .` réussit ; `docker run --rm sre-teams:local id -u` affiche un uid différent de 0 ; `docker run -d -p 3999:3000 sre-teams:local` puis `curl -s localhost:3999/api/health` renvoie `"status":"ok"`.
- [x] CA2 — `helm lint deploy/chart -f deploy/values-local.yaml` passe sans erreur ; `helm template` (avec `values-local.yaml`) produit un Deployment `replicas: 1` / `Recreate` avec sondes sur `/api/health`, un Service `LoadBalancer` port 8088, un StatefulSet Redis avec `volumeClaimTemplates`, et aucune ressource à portée cluster (pas de `ClusterRole`, `Namespace`, `PersistentVolume`…). Avec `--set redis.enabled=false`, aucune ressource Redis et pas de `REDIS_URL`.
- [x] CA3 — `npm run k8s:up` depuis l'état « rien d'installé » se termine avec succès ; `kubectl -n sre-teams get pods` montre l'application et Redis `Running`/`Ready` ; `curl -s http://localhost:8088/api/health` renvoie `"status":"ok"`, `"storage":"redis"` et `"facilitatorCode":"env"`. Relancer `npm run k8s:up` est idempotent.
- [x] CA4 — Un message posté via `POST http://localhost:8088/api/channels/<canal d'incident>/messages` est toujours renvoyé par `GET …/messages` après `kubectl -n sre-teams rollout restart deployment/<app>` et `rollout status`. Il survit aussi à `kubectl -n sre-teams delete pod <redis-0>` (PVC).
- [x] CA5 — Les pages `/` et `/admin` répondent 200 sur `http://localhost:8088` et le code animateur de `values-local.yaml` est accepté par une route `/api/admin/*` (401 avec un mauvais code).
- [x] CA6 — `npm run k8s:down` supprime la release et le namespace `sre-teams` ; ensuite `kubectl get ns sre-teams` échoue, et `kubectl get ns` liste toujours `code-escape`, `crossplane-system`, `monitoring`, `argocd`, `sandboxes` inchangés. Le script ne contient aucune commande `kubectl`/`helm` sans `-n sre-teams` (hors `get ns`).

## Vérification
```sh
docker build -t sre-teams:local . && docker run --rm sre-teams:local id -u
helm lint deploy/chart -f deploy/values-local.yaml
helm template sre-teams deploy/chart -n sre-teams -f deploy/values-local.yaml | grep -E 'kind:|replicas|type: Recreate|/api/health|8088'
helm template sre-teams deploy/chart -n sre-teams -f deploy/values-local.yaml --set redis.enabled=false | grep -ci redis
kubectl config current-context   # doit afficher colima
npm run k8s:up && kubectl -n sre-teams get pods && curl -s http://localhost:8088/api/health
# CA4 : poster un message (nom du canal via GET /api/channels), rollout restart, rollout status, relire
npm run k8s:down && kubectl get ns
```
`npm run test:http` lance son propre serveur depuis `.output/` : il n'est pas pointé sur l'instance dans cette boucle (curl suffit).

## Notes d'implémentation
- **Interdiction absolue** de toucher aux autres namespaces (`code-escape`, `crossplane-system`, `monitoring`, `argocd`, `sandboxes`, `kube-system`…) : tout se fait avec `-n sre-teams`, le script vérifie que le contexte est `colima` avant d'agir, jamais de `delete` ailleurs ni de ressource à portée cluster.
- Port 8088 choisi après essai : les Services LoadBalancer de servicelb sont bien joignables depuis le Mac sur `localhost:<port>` (testé sur un service existant) ; 8080, 3000, 3001, 5173, 5174, 5432, 5555, 6379, 9000, 9443 sont déjà pris. Port surchargeable par valeur.
- `REDIS_URL` = `redis://:<mot de passe>@<release>-redis:6379` ; un `checksum/config` en annotation du pod pour redémarrer si ConfigMap/Secret changent.
- Personas : rester sur les serverAssets embarqués (pas de `NPC_PERSONAS_DIR` cette boucle) ; moteur `keywords` par défaut.
- Vérifier que `.output/` est autonome (ioredis embarqué dans `.output/server/node_modules`) pour ne pas copier `node_modules` dans l'image finale.
