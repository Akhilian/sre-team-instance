# 044 — SLO Sloth du paging dans teams
## Pourquoi
Les 6 SLO du paging dépendent des métriques `paging_*` de cette application (spec 041) : ils doivent vivre avec elle (GOAL, évolution 2026-10-25). La plateforme les consommera ensuite.
## Périmètre
- Copier à l'identique les 6 fichiers `paging-{availability,latency,llm-deadline,llm-throughput,npc-fallback,npc-generation}.yaml` depuis `workshop-platform/observability/sloth/` vers `observability/sloth/` de teams ; commentaires d'en-tête : chemin `kubectl apply -n sre-teams -f observability/sloth/<fichier>` valable depuis la racine de teams.
- Cohérence : chaque métrique `paging_*` (et chaque label/bucket `le`) citée dans les requêtes existe dans `server/utils/paging-metrics.ts` avec ce nom, ces labels et ce bucket ; corriger le YAML côté teams sinon et le signaler.
- Test vitest `tests/` qui lit `observability/sloth/paging-*.yaml` et vérifie les points ci-dessus (parse YAML via une dépendance déjà présente, sinon lecture par regex) ; mention dans le README (section métriques/SLO) et dans le contrat d'agents (emplacement des SLO).
- Dashboards `paging.json` et `paging-llm-compare.json` : décision = **laissés dans la plateforme** (dette explicite). Le générateur `generate.py` est partagé avec d'autres dashboards et `make validate` y régénère tout sans diff ; les déplacer exige de modifier la plateforme. À consigner dans PROGRESS comme dette : « dashboards paging à rapatrier si le générateur est scindé ».
## Hors périmètre
- Toute modification de `workshop-platform` (dont suppression des originaux, `core.sh`, `Makefile`, `SLOTH_SKELETONS`) et de `workshop-docshare`.
- Déplacement des dashboards ; changement d'objectifs, de seuils ou de requêtes (hors correction de cohérence) ; nouvelles métriques ; déploiement, `kubectl`.
## Critères d'acceptation
- [x] CA1 — `observability/sloth/` contient exactement 6 fichiers `paging-*.yaml`, de mêmes noms ; `diff` avec la plateforme ne montre que les lignes de commentaire d'en-tête (ou rien).
- [x] CA2 — Aucun commentaire de ces fichiers ne référence `workshop-platform` ; la commande `kubectl apply` citée désigne `observability/sloth/<son propre nom>`.
- [x] CA3 — `docker run --rm -v "$PWD/observability/sloth":/s ghcr.io/slok/sloth:v<SLOTH_VERSION> validate -i /s` termine en code 0 (docker absent ou arrêté : critère signalé non vérifié, pas FAIL).
- [x] CA4 — Un test vitest échoue si un SLO cite une métrique `paging_*` absente de `paging-metrics.ts` ; il passe sur les 6 fichiers.
- [x] CA5 — `npm run typecheck` et `npm test` passent ; `npm run build` inchangé.
- [x] CA6 — `specs/PROGRESS.md`/README mentionnent l'emplacement des SLO et la dette dashboards (le closer consigne la dette).
## Vérification
`SLOTH_VERSION` : `sed -n 's/^SLOTH_VERSION=//p' ../workshop-platform/scripts/lib.sh`. CA1 : `diff -r observability/sloth <(copie) ` ou `for f in observability/sloth/*.yaml; do diff $f ../workshop-platform/observability/sloth/$(basename $f); done`.
## Notes d'implémentation
Pas de Chrome, pas de redéploiement. Le chart `deploy/chart` n'est pas touché (ServiceMonitor existe déjà). Après cette boucle, la plateforme retirera ses copies et pointera vers `workshop-teams/observability/sloth/` (spec platform ultérieure).
