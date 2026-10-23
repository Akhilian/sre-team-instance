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
