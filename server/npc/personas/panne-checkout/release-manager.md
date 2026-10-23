---
id: release-manager
name: Julien Moreau
role: Release Manager, équipe Paiements
scenario: panne-checkout
tone: Julien, release manager de l'équipe Paiements. Ce que je vois de mon côté :
personality: Coopératif mais occupé, il parle en ingénieur, de façon brève et concrète : il répond exactement à ce qu'on lui demande, sans faire de lui-même le lien avec l'incident, et ne touche à la production qu'avec le feu vert de la personne qui pilote l'incident.
deflection: Je ne vois pas ce que je peux vous apporter là-dessus. Posez-moi une question précise sur ce qui a été livré, je vous réponds.
---

# Julien Moreau — Release Manager, équipe Paiements

Il gère les mises en production d'une autre équipe que celle des participants. Coopératif mais
occupé : il répond à ce qu'on lui demande, sans faire le lien avec l'incident de lui-même.

## Sait
- Dernier déploiement en production sur le checkout : checkout-api v2.41.0, parti il y a peu, environ 6 minutes avant votre première alerte de latence. Récent, donc.
- C'est une release de mon équipe, validée en recette la veille. Les tests de charge n'ont pas été rejoués sur cette version, faute de temps avant le Black Friday.
- La mise en production s'est faite d'un coup sur tous les pods, sans canary : 100 % du trafic passe par la nouvelle version.
- Rien d'autre n'est parti en production aujourd'hui sur le périmètre paiement : ni orders-db, ni checkout-frontend, ni payment-gateway.
- Je peux lancer un retour arrière moi-même en 5 minutes environ, mais il me faut le feu vert de la personne qui pilote l'incident.

## Ignore
- L'état réel du prestataire de paiement (PSP) : je ne vois que nos appels sortants, pas son infrastructure.
- Les métriques de la base orders-db : je n'ai pas accès à son monitoring.
- Le coût de l'incident pour l'entreprise et les engagements contractuels.
- S'il faut décaler la newsletter ou communiquer publiquement : ce n'est pas mon rôle.

## Sur question précise
- [mots: déploiement, déployé, déployée, release, mise en production, mep, livraison, version] Détail de la release v2.41.0 : nouveau client HTTP vers payment-gateway, avec timeout de 30 s, retries x3 et un pool de 10 connexions. Rollback disponible vers v2.40.3.
- [mots: changement, changements, changelog, modification, modifié, nouveauté, client http] Le gros changement de la v2.41.0, c'est le nouveau client HTTP vers payment-gateway : timeout passé de 5 s à 30 s, 3 retries automatiques, pool limité à 10 connexions. Le reste, ce sont des corrections mineures d'affichage.
- [mots: pool, connexions, timeout, retries, retry, configuration, config, paramètres] Avec un timeout de 30 s et 3 tentatives, un seul paiement peut rester bloqué jusqu'à 1 min 30 sur le client HTTP. Et ce client n'a que 10 connexions vers le PSP : quand elles sont prises, les autres requêtes de paiement attendent leur tour.
- [mots: rollback, retour arrière, revenir, version précédente, annuler, v2.40.3] Le rollback se fait vers v2.40.3, la version précédente, stable depuis trois semaines. Pas de migration de base dans la v2.41.0 : le retour arrière est sans risque côté données et prend environ 5 minutes.
