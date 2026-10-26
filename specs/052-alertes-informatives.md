# 052 — Alertes informatives (retrait de l'acquittement et de la résolution)
## Pourquoi
Les boutons « Acquitter » et « Résoudre » d'une alerte n'ont aucune conséquence dans le jeu (pas de réaction de PNJ, pas d'effet sur le scénario) et n'expliquent pas leur rôle ; l'utilisateur les juge inutiles (2026-10-26, option A retenue). L'alerte devient un message informatif, plus compact. Ajustement de 011 (alertes bot).
## Périmètre
- `app/components/AlertCard.vue` : retirer les boutons, le badge de statut (« Déclenchée / Acquittée / Résolue »), les lignes « Acquittée/Résolue par X », la gestion d'erreur associée. Garder sévérité (SEV1/2/3), titre, service, texte. Carte compacte.
- `app/pages/channels/[id].vue` (`setAlertStatus`, `applyLocal` lié) et `app/components/MessageList.vue` : retirer les branchements du statut.
- Serveur : supprimer la route `server/api/channels/[id]/messages/[messageId]/alert-status.post.ts`, la mise à jour de statut dans `server/utils/chat-store.ts`, les transitions de `shared/utils/alerts.ts` (statuts, `acknowledgedBy/At`, `resolvedBy/At`) et les champs de type associés.
- Chronologie (`shared/utils/timeline.ts`) : retirer les entrées « Acquittement » et « Résolution » ; l'apparition de l'alerte reste.
- Compatibilité : un état persisté contenant les anciens champs de statut se charge sans erreur (champs ignorés).
- Tests : mettre à jour/supprimer ceux qui portent sur le statut (grep `alert-status`, `acknowledged`, `resolved`, `alert-ack`, `alert-resolve`).
## Hors périmètre
- Création des alertes (scénarios, formulaire animateur), réaction des PNJ aux alertes (proactivité, spec suivante), contenu des scénarios, déploiement et `kubectl`.
## Critères d'acceptation
- [x] CA1 — Une alerte affichée dans le canal n'a aucun bouton ni badge de statut ; elle montre sévérité, titre, service et texte (test de composant).
  - Écart accepté 2026-10-26 : vérifié par analyse du texte du template d'`AlertCard.vue` (pas d'outillage de test de composant).
- [x] CA2 — La route `alert-status` n'existe plus (404) ; aucune référence résiduelle à `acknowledged`/`resolved` d'alerte dans `app/`, `server/`, `shared/` (grep).
- [x] CA3 — La chronologie ne contient plus d'entrée « Acquittement » ni « Résolution » ; l'apparition de l'alerte y figure toujours.
- [x] CA4 — Un canal persisté avec d'anciens champs de statut d'alerte se charge et s'affiche sans erreur (test).
- [x] CA5 — Les alertes des scénarios et du formulaire animateur sont toujours publiées et affichées.
- [x] CA6 — typecheck, tests, build et `test:http` du contrat passent.
## Vérification
Contrôles standards du contrat ; `grep -rn "alert-status\|acknowledgedBy\|resolvedBy" app server shared tests` ne renvoie rien d'attendu.
