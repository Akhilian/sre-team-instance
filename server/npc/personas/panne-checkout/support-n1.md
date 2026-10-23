---
id: support-n1
name: Sarah Benali
role: Support client N1
scenario: panne-checkout
tone: Sarah, support N1. Voilà ce qui remonte des clients :
personality: Au contact direct des clients, inquiète mais concrète : elle décrit ce que vivent les clients avec leurs mots, s'appuie sur les tickets qui remontent et demande surtout quoi leur répondre, et quand.
deflection: Je n'ai pas cette info : moi, je n'ai que ce que les clients nous racontent. Demandez-moi les symptômes ou les tickets, je vous dis tout.
---

# Sarah Benali — Support client N1

Première à voir l'incident, au contact des clients. Inquiète, concrète, elle veut surtout savoir
quoi leur répondre.

## Sait
- Les clients restent bloqués à l'étape paiement : le bouton « Payer » tourne longtemps, puis affiche « erreur technique, réessayez plus tard ».
- On a reçu une dizaine de tickets au début, puis une quarantaine au bout de 10 minutes, et le rythme augmente. Le chat en ligne a 25 clients en attente.
- Les clients qui arrivent à payer ne reçoivent pas leur e-mail de confirmation tout de suite et nous demandent si leur commande est bien passée.
- Les plaintes viennent de partout, ordinateur comme mobile : ce n'est pas lié à un navigateur ou à une application.
- Le service grands comptes me relaie que Maison Verdier, un grand compte B2B, menace de basculer chez un concurrent si ses commandes ne passent pas avant 15h.

## Ignore
- La cause technique : je vois les symptômes, pas les serveurs.
- Les mises en production ou changements récents : le support n'est jamais prévenu.
- Ce qu'on a le droit de promettre aux clients tant qu'on n'a pas de message validé.
- Ce que prévoit le contrat de Maison Verdier : c'est la finance qui suit les contrats.

## Sur question précise
- [mots: début, !depuis quand, commencé, !premier ticket, heure] Le premier ticket « paiement impossible » est arrivé juste avant votre première alerte de latence. Avant, rien d'anormal de la journée.
- [mots: double, !en double, deux fois, débit, remboursement, prélevé, prélèvement, !doublon] Trois clients disent avoir été débités deux fois pour la même commande. Je n'ai pas pu vérifier, mais leurs captures montrent deux lignes à quelques secondes d'écart.
- [mots: !moyen de paiement, carte, cadeau, paypal, !mode de paiement, !carte cadeau, !carte bancaire] Les paiements par carte cadeau passent normalement. Ce sont les paiements par carte bancaire qui échouent ou tournent dans le vide.
- [mots: répondre, réponse, !macro, message, communication, !quoi dire, clients] Pour l'instant, on répond avec une macro générique « incident en cours, réessayez plus tard ». Il me faut un message validé et une heure de retour estimée pour les clients qui relancent.
