#!/usr/bin/env bash
# Installe / retire l'instance dans le Kubernetes local Colima. Tout reste dans le namespace sre-war-room.
set -euo pipefail
cd "$(dirname "$0")/.."

NS=sre-war-room
RELEASE=sre-war-room
URL=http://localhost:8088

case "${1:-}" in up|down) [ "$#" -eq 1 ] || { echo "Usage: $0 up|down" >&2; exit 2; } ;; *) echo "Usage: $0 up|down" >&2; exit 2 ;; esac
TIMEOUT=3m

ctx=$(kubectl -n "$NS" config current-context)
if [ "$ctx" != "colima" ]; then
  echo "Contexte kubectl '$ctx' : colima attendu, abandon." >&2
  exit 1
fi


case "${1:-}" in
  up)
    docker build -t sre-war-room:local .
    # Fiches de PNJ : copie fraîche dans le chart (dossier gitignoré), rendue en ConfigMap
    npm run -s k8s:personas
    # Code animateur : FACILITATOR_CODE de l'environnement, sinon celui de démonstration de values-local.yaml
    code_args=()
    if [ -n "${FACILITATOR_CODE:-}" ]; then code_args=(--set-string "facilitatorCode=$FACILITATOR_CODE"); fi
    helm upgrade --install "$RELEASE" deploy/chart -n "$NS" --create-namespace -f deploy/values-local.yaml \
      ${code_args[@]+"${code_args[@]}"} --force-conflicts --wait --timeout "$TIMEOUT"
    # L'image :local peut avoir été reconstruite : on relance l'application pour la prendre en compte
    kubectl -n "$NS" rollout restart "deployment/$RELEASE"
    kubectl -n "$NS" rollout status "deployment/$RELEASE" --timeout=3m
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
    echo "Usage: $0 up|down" >&2
    exit 2
    ;;
esac
