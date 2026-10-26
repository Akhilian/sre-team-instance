# 050 — Chart : annotations et sources autorisées du Service (exposition sur EKS)
## Pourquoi
Sur EKS, le Service `LoadBalancer` de l'app est géré par le contrôleur AWS (NLB) et sort en **interne** par défaut (DNS résolu en 10.0.x.x, inaccessible depuis Internet) ; le chart n'a aucun moyen de poser les annotations (`service.beta.kubernetes.io/aws-load-balancer-scheme`) ni de limiter les sources. Décision utilisateur 2026-10-26 : rendre l'application accessible publiquement sur le cluster de test.
## Périmètre
- `deploy/chart/templates/service.yaml` : rendre `metadata.annotations` depuis `.Values.service.annotations` (map, défaut `{}`, aucune annotation rendue si vide) et `spec.loadBalancerSourceRanges` depuis `.Values.service.loadBalancerSourceRanges` (liste, défaut `[]`, rien rendu si vide).
- `deploy/chart/values.yaml` : clés `service.annotations` et `service.loadBalancerSourceRanges` documentées (exemple NLB public : `service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing`). Valeurs par défaut inchangées côté rendu (local k3s inchangé).
- README : paragraphe « Exposition sur EKS » (annotation `internet-facing`, option de restriction d'IP, rappel que `FACILITATOR_CODE` protège les routes d'animation).
## Hors périmètre
Plateforme, déploiement, Ingress/TLS, changement du type de Service.
## Critères d'acceptation
- [x] CA1 — `helm template` avec `deploy/values-local.yaml` : rendu du Service identique à avant (aucune annotation, aucun `loadBalancerSourceRanges`) ; diff nul hors éventuel bloc vide.
- [x] CA2 — `helm template --set 'service.annotations.service\.beta\.kubernetes\.io/aws-load-balancer-scheme=internet-facing' --set 'service.loadBalancerSourceRanges[0]=1.2.3.4/32'` rend l'annotation et la liste attendues.
- [x] CA3 — `helm lint deploy/chart` passe ; `npm run typecheck`, `npm test`, `npm run build`, `npm run test:http` passent.
- [x] CA4 — README et `values.yaml` documentent les deux clés.
## Vérification
helm template avant/après (HEAD dans un dossier temporaire) et diff ; helm lint ; contrôles du contrat.
