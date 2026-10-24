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

case "${1:-}" in
  up)
    docker build -t sre-teams:local .
    helm upgrade --install "$RELEASE" deploy/chart -n "$NS" --create-namespace -f deploy/values-local.yaml --wait --timeout 3m
    # L'image :local peut avoir été reconstruite : on relance l'application pour la prendre en compte
    kubectl -n "$NS" rollout restart "deployment/$RELEASE"
    kubectl -n "$NS" rollout status "deployment/$RELEASE" --timeout=3m
    for _ in $(seq 1 60); do
      if curl -fs "$URL/api/health" | grep -q '"status":"ok"'; then
        echo "Instance prête sur $URL"
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
    echo "Usage: $0 up|down" >&2
    exit 2
    ;;
esac
