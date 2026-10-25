# 049 — Références au dossier workshop-war-room
## Pourquoi
Le dossier local `workshop-teams` est renommé `workshop-war-room`. Des documents et métadonnées de ce dépôt citent encore l'ancien nom.
## Périmètre
- `CLAUDE.md` (chemins absolus `/Users/adrien/Desktop/projets/SRE/workshop-teams`, mentions d'orchestration), `README.md`, `deploy/chart/Chart.yaml` (description), `deploy/chart/values.yaml` (commentaires), `specs/ROADMAP.md` et tout fichier vivant du dépôt qui cite `workshop-teams` : remplacer par `workshop-war-room`. Ne pas toucher aux specs numérotées ni à PROGRESS (historique) ; tout fichier du dépôt cité par erreur doit être justifié dans le rapport.
## Hors périmètre
Plateforme, docshare, GitHub, Render.
## Critères d'acceptation
- [x] CA1 — `grep -rIn "workshop-teams"` hors `specs/0*.md`, `specs/PROGRESS.md`, `specs/GOAL.md`, `node_modules`, `.output`, `.git` ne renvoie rien (ou chaque occurrence est justifiée dans le rapport).
- [x] CA2 — `npm run typecheck`, `npm test`, `npm run build`, `npm run test:http` passent ; `helm lint deploy/chart` et `helm template` passent.
## Vérification
grep, contrôles du contrat, helm.
