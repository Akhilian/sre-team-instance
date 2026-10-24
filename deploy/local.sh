#!/usr/bin/env bash
# Installe / retire l'instance dans le Kubernetes local Colima. Tout reste dans le namespace sre-teams.
set -euo pipefail
cd "$(dirname "$0")/.."

NS=sre-teams
RELEASE=sre-teams
URL=http://localhost:8088

ctx=$(kubectl -n "$NS" config current-context)
if [ "$ctx" != "colima" ]; then
  echo "Contexte kubectl '$ctx' : colima attendu, abandon." >&2
  exit 1
fi

OLLAMA=false
TIMEOUT=3m
if [ "${2:-}" = "--ollama" ]; then
  OLLAMA=true
  TIMEOUT=20m # premier pull de l'image et du modèle
fi

case "${1:-}" in
  up)
    docker build -t sre-teams:local .
    # Fiches de PNJ : copie fraîche dans le chart (dossier gitignoré), rendue en ConfigMap
    rm -rf deploy/chart/files/personas
    mkdir -p deploy/chart/files
    cp -R server/npc/personas deploy/chart/files/personas
    # Code animateur : FACILITATOR_CODE de l'environnement, sinon celui de démonstration de values-local.yaml
    code_args=()
    if [ -n "${FACILITATOR_CODE:-}" ]; then code_args=(--set-string "facilitatorCode=$FACILITATOR_CODE"); fi
    helm upgrade --install "$RELEASE" deploy/chart -n "$NS" --create-namespace -f deploy/values-local.yaml \
      --set "ollama.enabled=$OLLAMA" ${code_args[@]+"${code_args[@]}"} --force-conflicts --wait --timeout "$TIMEOUT"
    # L'image :local peut avoir été reconstruite : on relance l'application pour la prendre en compte
    kubectl -n "$NS" rollout restart "deployment/$RELEASE"
    kubectl -n "$NS" rollout status "deployment/$RELEASE" --timeout=3m
    if [ "$OLLAMA" = true ]; then
      # Chauffe : charge le modèle en mémoire pour que le premier @PNJ ne retombe pas sur keywords
      model=$(helm get values "$RELEASE" -n "$NS" -a -o json | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')
      kubectl -n "$NS" exec "deploy/$RELEASE-ollama" -- ollama run "$model" "Bonjour" >/dev/null 2>&1
    fi
    for _ in $(seq 1 60); do
      if curl -fs "$URL/api/health" | grep -q '"status":"ok"'; then
        echo "Instance prête sur $URL (animateur : $URL/admin, code ${FACILITATOR_CODE:-de deploy/values-local.yaml})"
        exit 0
      fi
      sleep 2
    done
    echo "L'instance ne répond pas sur $URL/api/health" >&2
    exit 1
    ;;
  down)
    helm uninstall "$RELEASE" -n "$NS" --ignore-not-found || true
    kubectl -n "$NS" delete namespace "$NS" --ignore-not-found
    ;;
  *)
    echo "Usage: $0 up [--ollama]|down" >&2
    exit 2
    ;;
esac
