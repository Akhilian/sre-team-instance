# Objectif

## Demande de l'utilisateur
> Recréer dans ce projet une sorte d'application qui ressemblerait à Teams de Microsoft. Je ne cherche pas à faire une application complètement fonctionnelle. Tu peux skipper certaines options. L'objectif est de simuler un environnement où des personnes peuvent discuter via chat d'un incident pour un exercice.

## Contexte
Support d'un atelier SRE : des participants simulent la gestion d'un incident en discutant dans un faux Teams, ouvert dans leur navigateur, pendant une séance de quelques heures.

## Périmètre visé (par ordre de priorité)
1. Interface au look « Teams » : barre latérale d'applications, liste d'équipes / canaux, zone de conversation, champ de saisie.
2. Identification légère : chaque participant choisit un nom d'affichage (pas de mot de passe, pas de compte).
3. Chat en canal : envoyer un message, voir ceux des autres en quasi temps réel (plusieurs navigateurs).
4. Plusieurs canaux, dont un canal d'incident pré-créé (ex. `#incident-…`), et création d'un canal par un participant.
5. Confort de discussion : réponses en fil, mentions `@nom`, réactions emoji, horodatage, avatars à initiales.
6. Outils d'exercice : message système / annonce d'un animateur, réinitialisation des conversations.

## Hors périmètre
Appels audio/vidéo, partage de fichiers, calendrier, authentification réelle, notifications push, application mobile.

## Contraintes
- Rester dans l'application Nuxt 4 existante (front `app/`, API `server/api/`), déployée sur Render en Web Service Node (une seule instance).
- Pas de base de données externe au départ : un stockage en mémoire côté serveur est acceptable (perte des messages au redémarrage tolérée pour un exercice). Un stockage fichier/clé-valeur peut venir plus tard si utile.
- Temps réel simple et compatible Render (polling court ou SSE ; WebSocket seulement si nécessaire).
- TypeScript ~6.0, `npm run typecheck` et `npm run build` doivent passer à chaque boucle.
- Avancer par petites features vérifiables, une par boucle.

## Définition de « terminé »
Plusieurs personnes, depuis des navigateurs différents, ouvrent l'URL déployée, choisissent un nom, rejoignent le canal d'incident et échangent des messages (avec fils, mentions et réactions) visibles par tous en quelques secondes, dans une interface qu'on reconnaît comme inspirée de Teams. Les points 1 à 5 du périmètre sont livrés ; le point 6 est un bonus.

---

# Phase 1.5 — Revue avant la phase 2

## Demande de l'utilisateur
> Entre la phase 1 et la phase 2, ajouter une petite phase de review du code : vérifier que les dépendances sont à jour et que, fonctionnellement, tout continue de fonctionner globalement. S'il y a des mises à jour importantes à faire, les faire d'abord avant de passer en phase 2.

## Contenu
- Audit des dépendances (`npm outdated`, `npm audit`) : appliquer les mises à jour de sécurité et les montées de version importantes compatibles (Nuxt, Vue, Nitro, Vitest…), en respectant le blocage TypeScript ~6.0 tant que `vue-tsc` ne supporte pas la 7.
- Revue du code de la phase 1 : correction des bugs, du code mort et des incohérences entre modules.
- Contrôle fonctionnel global de bout en bout, dans Chrome et par curl, sur le build : nom d'affichage, canaux, messages, fils, mentions, réactions, non-lus, présence, mobile, alertes, scénario, chronologie, persistance.
- Livrables : un rapport de revue dans `specs/`, puis des boucles correctives si nécessaire, une par lot cohérent.

## Définition de « terminé »
Les dépendances sont à jour ou leur retard est justifié, `npm audit` ne signale rien de haut ou critique sans explication, et le parcours de bout en bout passe. On passe ensuite à la phase 2.

---

# Phase 2 — Personnages non joueurs (PNJ)

## Demande de l'utilisateur
> Cadrer et initier une sous-partie du projet autour de quelques personnages qui pourraient être des PNJ (terme de jeu vidéo) : des personnages qui représentent des fonctions d'une entreprise (CEO, CFO, agence de com… d'autres au choix), peut-être dans d'autres équipes. Chacun détient une partie de l'information (sous la forme d'un RAG ou équivalent). Quand l'équipe démarre le scénario, elle peut s'adresser à ces personas, qui ont chacun une partie de l'info. Une personne centrale peut aussi signaler qu'il y a un incident.

## Intention pédagogique
L'information utile à la résolution est **répartie** : aucun PNJ ne sait tout, et chacun ne livre que ce qu'il sait, avec le ton et les priorités de sa fonction. L'équipe doit poser les bonnes questions aux bonnes personnes, recouper et décider. Un PNJ « lanceur d'alerte » (ex. support client ou NOC) ouvre l'incident.

## Distribution envisagée (à affiner en spec)
- **Lanceur d'alerte** : support client / NOC. Il signale l'incident dans le canal et connaît les symptômes côté clients.
- **CEO** : pression, impact business, demande des points de situation réguliers.
- **CFO** : coût par minute d'indisponibilité, engagements contractuels (SLA, pénalités).
- **Communication / agence de com** : messages publics, page de statut, presse et réseaux sociaux.
- **Équipe Release / Dev d'une autre équipe** : connaît le déploiement récent (l'indice technique).
- **Fournisseur de paiement (externe)** : état de son service, fenêtres de maintenance.
- (Option) **Juridique / DPO** : obligations de notification si des données sont touchées.

## Principes
- Chaque PNJ a une **fiche** (rôle, personnalité, ce qu'il sait, ce qu'il ignore, ce qu'il ne doit pas révéler sans question précise), liée à un scénario.
- Les PNJ répondent quand on les mentionne (`@Nom`) ou par message direct, dans l'interface existante. Leurs messages sont marqués comme venant d'un PNJ.
- Moteur de réponse **interchangeable** derrière une interface claire (ex. `NpcResponder` : fiche + extraits de connaissances + historique → réponse). Implémentations prévues, choisies par variable d'environnement :
  - `keywords` : repli déterministe par mots-clés, sans modèle (défaut, utilisé par les tests) ;
  - `openai-compatible` : tout serveur exposant `/v1/chat/completions` (Ollama, LM Studio, vLLM, llama.cpp… en local ou auto-hébergé), via `NPC_LLM_BASE_URL` et `NPC_LLM_MODEL` ;
  - `anthropic` : API Claude, via `ANTHROPIC_API_KEY` (optionnel).
  Ajouter un fournisseur ne doit toucher qu'un fichier d'adaptateur.
- Récupération (« RAG » simple) séparée du moteur, elle aussi derrière une interface (`KnowledgeRetriever`) : connaissances en fichiers par PNJ, sélection lexicale des extraits pertinents au départ, remplaçable plus tard par des embeddings.
- L'animateur active les PNJ avec le scénario, voit leurs échanges et peut les couper.

## Contraintes
- Mêmes contraintes que la phase 1 (Nuxt existant, mémoire ou stockage léger, typecheck et build verts).
- Aucune dépendance obligatoire à un fournisseur de modèle : l'application fonctionne sans modèle (repli `keywords`). Les secrets et URL éventuels (`ANTHROPIC_API_KEY`, `NPC_LLM_BASE_URL`…) sont déclarés en `sync: false` dans `render.yaml`, jamais commités. Réponses courtes, délai maximal et limitation du nombre d'appels par minute.

- Échelle : **15 participants au maximum**, qui ne parlent pas en permanence (précision de l'utilisateur, 2026-10-23). La performance n'est pas un enjeu : plafonds simples et généreux, pas de mécanisme sophistiqué.

## Définition de « terminé » (phase 2)
Lors d'un scénario lancé par l'animateur, le lanceur d'alerte ouvre l'incident. L'équipe peut interroger au moins 4 PNJ, qui répondent en quelques secondes dans le canal, chacun avec sa part d'information et sa personnalité. Il faut combiner les informations de plusieurs PNJ pour identifier la cause et la bonne communication.
