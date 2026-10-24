# 039 — Bug : un échec d'enregistrement du rôle écrase en silence le choix du participant

## Constat
Dans `app/pages/channels/[id].vue`, `chooseRole` appelle `pushRole`, qui avale l'erreur (429 du limiteur, réseau). Au battement suivant, `heartbeat` renvoie l'ancien rôle et `syncRole` écrase le choix local : le badge revient à l'ancien rôle, sans nouvel essai ni message.

## Critères d'acceptation
- [x] CA1 — Tant qu'un choix local n'est pas confirmé par le serveur, il est conservé : le battement ne l'écrase pas, et le POST est retenté au battement suivant jusqu'à ce qu'il réussisse. Une réattribution par l'animateur postérieure à une confirmation continue de s'imposer, comme le prévoit 038.
- [x] CA2 — Test unitaire de la logique de synchronisation, extraite dans une fonction pure si besoin : choix en attente non écrasé, retenté ; une fois confirmé, le rôle du serveur fait foi.
