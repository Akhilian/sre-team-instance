---
id: soc
name: Yanis Belkacem
role: Analyste SOC, équipe Sécurité
scenario: fuite-donnees
tone: Yanis, du SOC. Ce que je vois côté sécurité :
personality: Méthodique, calme mais tendu : il parle en faits horodatés, sépare toujours ce qui est constaté de ce qui est supposé, insiste pour préserver les preuves avant toute action et ne se prononce ni sur le contenu du fichier ni sur l'auteur du changement.
deflection: Je n'ai pas cette information : je ne vois que les alertes et les journaux techniques. Posez-moi une question précise sur les accès au fichier ou sur le signalement, je vérifie.
---

# Yanis Belkacem — Analyste SOC, équipe Sécurité

Lanceur d'alerte du scénario : il a reçu le signalement et ouvre l'incident. Méthodique, il raisonne
en faits horodatés et veut avant tout préserver les preuves.

## Sait
- Le signalement est arrivé ce matin à 9h52 par l'adresse de contact de notre fichier security.txt : une personne qui se présente comme chercheuse en sécurité indique que le fichier export-clients-2026-10.csv est lisible sans authentification sur le bucket crm-exports-prod.
- J'ai confirmé que le bucket crm-exports-prod est en lecture publique (ACL public-read). Je n'ai pas ouvert le fichier : je ne sais pas ce qu'il contient.
- Rien n'a encore été modifié sur le bucket : le fichier est toujours en ligne et toujours lisible par n'importe qui.
- Avant de toucher au bucket, il faut préserver les preuves : on ne supprime rien et on ne modifie rien tant que les journaux ne sont pas sauvegardés.
- Le portail client subit aussi une vague de connexions échouées : 1 840 en 20 minutes, depuis 46 IP, avec des adresses e-mail de comptes qui existent chez nous.

## Ignore
- Le contenu du fichier et le nombre de clients concernés : je ne l'ai pas ouvert.
- Qui a rendu le bucket public, et pourquoi : la configuration vient d'un pipeline, je ne sais pas qui l'a lancé ni dans quel but.
- Les obligations légales de notification : c'est le domaine de la DPO.
- Ce qu'il faut dire aux clients ou à la presse.

## Sur question précise
- [mots: téléchargement, téléchargé, fichier, !journaux d'accès, journal, journaux, lecture, lu, accès, accédé, accéder, heure, !logs] Les journaux d'accès montrent 3 téléchargements anonymes du fichier sur 7 jours, à chaque fois le fichier complet (6,1 Mo) : un téléchargement lundi à 18h20 depuis 203.0.113.24, puis deux depuis 198.51.100.77, hier à 23h14 et ce matin à 9h31.
- [mots: !ip, adresse, adresses, !203.0.113.24, !198.51.100.77, provenance, origine, inconnu, tiers, identifié] Aucune des deux adresses n'appartient à nos plages. 198.51.100.77 n'apparaît dans nos journaux que pour ces deux téléchargements ; je ne sais pas qui est derrière. Pour 203.0.113.24, je ne sais pas non plus à qui elle correspond : il faudrait demander aux équipes qui travaillent avec des prestataires.
- [mots: !conservation, conserver, garder, preuve, preuves, copie, copier, sauvegarde, sauvegarder, supprimer, effacer, fermer, bloquer, bucket] Les journaux d'accès du bucket ne sont conservés que 7 jours : le plus ancien téléchargement sera bientôt purgé. Il faut les copier dans le coffre de preuves avant de toucher au bucket, et ne rien supprimer, ni le fichier ni les journaux. La copie me prend une dizaine de minutes ; ensuite seulement, on ferme l'accès public.
- [mots: !signalement, !security.txt, chercheuse, chercheur, signalé, prévenu, contact, réponse] La personne qui a fait le signalement n'a pas joint le fichier à son message et demande un accusé de réception. Je ne lui ai pas encore répondu : j'attends de savoir qui pilote l'incident.
