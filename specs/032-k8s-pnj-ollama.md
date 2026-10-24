# 032 — Kubernetes : fiches de PNJ en ConfigMap, Ollama optionnel, NetworkPolicy, README

## Pourquoi
Dernière boucle de la phase 3 de `specs/GOAL.md` : il reste à remplir trois points de la définition de « terminé ». Une fiche modifiée dans la ConfigMap doit être prise en compte par « Recharger », les PNJ doivent pouvoir répondre via Ollama (`openai-compatible`) activé par une valeur du chart, et le README doit documenter le déploiement.

## Périmètre
- **Fiches** : `deploy/local.sh up` copie `server/npc/personas/` dans `deploy/chart/files/personas/` (gitignoré, remplacé à chaque `up`). Le chart génère une ConfigMap `<release>-personas` via `.Files.Glob "files/personas/*/*.md"`, avec des clés plates `<scénario>_<id>.md`. Elle est montée **sans `subPath`** sur `/etc/sre-teams/personas`, avec `items[].path: <scénario>/<id>.md`, et `NPC_PERSONAS_DIR` pointe sur ce dossier. Sans fichier copié (chart rendu depuis un clone propre), il n'y a ni ConfigMap ni `NPC_PERSONAS_DIR`, et les fiches embarquées sont utilisées. La ConfigMap des fiches n'entre pas dans les `checksum/*` du pod.
- **Ollama** (`ollama.enabled`, défaut `false`) : un Deployment `ollama/ollama` (tag figé, `Recreate`), un PVC `local-path` de 10Gi monté sur `/root/.ollama` et un Service `ClusterIP` sur le port 11434. Un initContainer (même image) lance `ollama serve` en arrière-plan puis `ollama pull {{ .Values.ollama.model }}`. Variables `OLLAMA_KEEP_ALIVE=24h` et ressources : requests 2 CPU / 2Gi, limit mémoire 4Gi. Modèle par défaut : **`qwen2.5:1.5b`** (Q4, environ 1 Go sur disque, environ 1,5 Go en RAM, bon français, rapide sur CPU). L'alternative `qwen2.5:3b` (environ 1,9 Go) est documentée. Quand Ollama est activé, la ConfigMap de l'app reçoit `NPC_ENGINE=openai-compatible`, `NPC_LLM_BASE_URL=http://<release>-ollama:11434/v1`, `NPC_LLM_MODEL=<modèle>` et `NPC_LLM_TIMEOUT_MS=45000`.
- **Délais côté code** : le plafond de `NPC_LLM_TIMEOUT_MS` passe de 14 s à 60 s (`server/npc/engines/openai-compatible.ts`). Le délai du dispatcher devient `max(15 s, délai du modèle + 2 s)` quand le moteur appelle un modèle, pour que le repli keywords reste possible. Le README (tableau des variables) est mis à jour.
- **NetworkPolicy** (`networkPolicy.enabled`, défaut `true`), en entrée seulement : l'application accepte tout, Redis et Ollama n'acceptent que les pods de l'application de la même release. Aucune règle de sortie : le pull du modèle a besoin d'Internet.
- **Script** : `deploy/local.sh up --ollama` (et `npm run k8s:up:ollama`) ajoute `--set ollama.enabled=true` et porte `--timeout` à 20m (le premier pull de l'image et du modèle peut être long). Ensuite, il fait un appel de chauffe au modèle (`kubectl -n sre-teams exec … ollama run <modèle> "Bonjour"`). `down` supprime aussi le PVC d'Ollama, via la suppression du namespace.
- **README** : section « Kubernetes local (Colima) » avec prérequis, `npm run k8s:up` / `k8s:up:ollama`, accès `http://localhost:8088` et code animateur de démo, modification d'une fiche (`kubectl -n sre-teams edit configmap sre-teams-personas`, délai de synchronisation du kubelet d'environ 1 min, puis « Recharger » dans `/admin` ; écrasée au prochain `up`), activation d'Ollama et choix du modèle, `npm run k8s:down`.

## Hors périmètre
- Ingress, release par équipe, GPU, registre d'images, règles de sortie (egress), modification de `render.yaml`.
- Écriture des modifications faites dans `/admin` vers la ConfigMap : elles restent en mémoire.

## Critères d'acceptation
- [x] CA1 — Après copie des fiches dans `deploy/chart/files/personas/`, `helm template` (avec `values-local.yaml`) rend une ConfigMap `sre-teams-personas` de 11 clés, un volume dont les `items[].path` sont `<scénario>/<id>.md`, aucun `subPath`, `NPC_PERSONAS_DIR=/etc/sre-teams/personas`, et des NetworkPolicy pour Redis et l'application. Dossier vide : ni ConfigMap de fiches ni `NPC_PERSONAS_DIR`. `helm lint` passe dans les deux cas. Aucune ressource à portée cluster.
- [x] CA2 — `helm template … --set ollama.enabled=true` rend un Deployment, un PVC et un Service Ollama, un initContainer qui fait `ollama pull qwen2.5:1.5b`, une NetworkPolicy Ollama, ainsi que `NPC_ENGINE=openai-compatible`, `NPC_LLM_BASE_URL=http://sre-teams-ollama:11434/v1` et `NPC_LLM_TIMEOUT_MS=45000` dans la ConfigMap de l'app. Sans ce flag, aucune ressource Ollama et `NPC_ENGINE=keywords`. `npm test` passe, avec un test qui montre que `NPC_LLM_TIMEOUT_MS=45000` est retenu (plus plafonné à 14000) et qu'au-delà de 60000 la valeur est ramenée à 60000.
- [x] CA3 — Après `npm run k8s:up`, `GET /api/admin/npc-personas` renvoie `source: "dir"` et les 11 fiches. On patche la ConfigMap pour changer la réponse `[mots: … !verdier]` de `panne-checkout_cfo.md` (texte témoin, ex. « TEMOIN-032 »). Une fois le fichier à jour dans le pod (`kubectl -n sre-teams exec deploy/sre-teams -- cat /etc/sre-teams/personas/panne-checkout/cfo.md`, à interroger en boucle jusqu'à 120 s), on appelle `POST /api/admin/npc-personas/reload`, on active les PNJ (`POST /api/admin/npcs {"enabled":true}`) et on poste « @Marc Lefort et le contrat Verdier ? » dans le canal d'incident. La réponse du PNJ contient « TEMOIN-032 ».
- [x] CA4 — La NetworkPolicy est appliquée. Depuis un pod jetable dans `sre-teams` (`kubectl -n sre-teams run np-test --rm -i --restart=Never --image=busybox -- nc -zvw3 sre-teams-redis 6379`), la connexion échoue. `curl http://localhost:8088/api/health` répond toujours `"storage":"redis"`, et un message survit encore à `rollout restart`. Si k3s n'appliquait pas les NetworkPolicy, l'implémenteur le prouve et le note dans le README ; ce critère devient alors bloquant pour l'utilisateur.
- [x] CA5 — `deploy/local.sh up --ollama` se termine avec succès (le premier passage peut durer plus de 10 min). Le pod Ollama est `Ready`, `kubectl -n sre-teams exec deploy/sre-teams-ollama -- ollama list` liste `qwen2.5:1.5b`, et `/api/health` indique `npcEngine` `openai-compatible`. Un `@PNJ` dans le canal d'incident reçoit une réponse, et `GET /api/admin/npcs` montre ensuite `lastModelCall.ok: true`.
- [x] CA6 — Le README contient la section Kubernetes (installation, accès, modification d'une fiche, Ollama, désinstallation). `npm run k8s:down` supprime le namespace `sre-teams`, PVC compris. `kubectl get ns` liste toujours `code-escape`, `crossplane-system`, `monitoring`, `argocd` et `sandboxes`. Le script ne contient aucune commande `kubectl`/`helm` sans `-n sre-teams`.

## Vérification
```sh
kubectl config current-context   # colima, sinon on s'arrête
npm test
rm -rf deploy/chart/files/personas && helm lint deploy/chart -f deploy/values-local.yaml
mkdir -p deploy/chart/files && cp -R server/npc/personas deploy/chart/files/personas
helm template sre-teams deploy/chart -n sre-teams -f deploy/values-local.yaml | grep -nE 'kind:|subPath|path: .*\.md|NPC_PERSONAS_DIR'
helm template sre-teams deploy/chart -n sre-teams -f deploy/values-local.yaml --set ollama.enabled=true | grep -nE 'kind:|ollama pull|NPC_ENGINE|NPC_LLM'
npm run k8s:up
H='x-facilitator-code: demo-animateur'; U=http://localhost:8088
curl -s -H "$H" $U/api/admin/npc-personas | grep -o '"source":"[a-z]*"'
# CA3 : kubectl -n sre-teams get cm sre-teams-personas -o json | (modifier la clé panne-checkout_cfo.md) | kubectl -n sre-teams apply -f -
#       attendre le fichier dans le pod, puis reload, activer les PNJ, poster @Marc Lefort, relire GET /api/channels/<canal>/messages (attendre ~5 s)
kubectl -n sre-teams run np-test --rm -i --restart=Never --image=busybox -- nc -zvw3 sre-teams-redis 6379   # doit échouer
bash deploy/local.sh up --ollama   # timeout du shell >= 25 min (lancer en arrière-plan si besoin)
kubectl -n sre-teams exec deploy/sre-teams-ollama -- ollama list
curl -s $U/api/health; curl -s -H "$H" $U/api/admin/npcs | grep -o '"lastModelCall":{[^}]*}'
npm run k8s:down && kubectl get ns
```

## Notes d'implémentation
- **Interdiction absolue** de toucher aux autres namespaces ou aux ressources à portée cluster. Tout se fait en `-n sre-teams`. Si un critère semble l'exiger, on s'arrête et on le signale.
- `readPersonaDir` ignore les noms cachés (`..data`, `..2026_…`) et compare des chemins réels sous la racine `realpath`. Les liens symboliques d'un volume ConfigMap restent donc à l'intérieur du dossier. Vérifier que les fiches de la ConfigMap sont bien chargées, sans erreur « hors de NPC_PERSONAS_DIR ».
- Ajouter `deploy/chart/files/personas/` à `.gitignore` et un `.helmignore` si besoin. Le Deployment et le Service Ollama doivent avoir des sélecteurs propres à la release (`app.kubernetes.io/instance`).
- Sur CPU, la première réponse inclut le chargement du modèle : l'appel de chauffe du script et `OLLAMA_KEEP_ALIVE` évitent un repli keywords au premier `@PNJ`. Si `lastModelCall` affiche `timeout`, relancer une fois avant de conclure.
- Le moteur `openai-compatible` borne déjà la réponse à 300 tokens. Garder `temperature` à 0,3 et ne pas toucher au moteur `anthropic`, sauf pour le plafond partagé de `timeoutFromEnv`.
