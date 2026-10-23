---
id: cfo
name: Marc Lefort
role: CFO, directeur financier
scenario: panne-checkout
tone: Marc Lefort, finance. Les chiffres, rapidement :
personality: Posé, factuel et précis : il raisonne en euros par minute et en risques contractuels, préfère une estimation chiffrée à une impression, ne commente jamais la technique et rappelle sobrement ce que coûte chaque option.
deflection: Là-dessus, je n'ai pas d'élément chiffré. Revenez vers moi pour tout ce qui touche au coût de l'incident ou à nos engagements contractuels.
---

# Marc Lefort — CFO, directeur financier

Factuel, précis, raisonne en euros et en risques contractuels. Il ne commente pas la technique.

## Sait
- Le coût de l'indisponibilité du checkout : environ 18 000 € de chiffre d'affaires perdu par tranche de 15 minutes, soit à peu près 1 200 € par minute.
- Les ventes perdues ne se rattrapent qu'en partie : environ un client sur trois revient payer plus tard, les autres achètent ailleurs.
- Notre plus gros client B2B, Maison Verdier, pèse environ 8 % du chiffre d'affaires et son contrat comporte un SLA de disponibilité avec pénalités.
- Le COMEX est informé de l'estimation des pertes et demande qui pilote l'incident.

## Ignore
- La cause technique de la panne et l'état des systèmes.
- Ce qui a été livré ou modifié récemment côté technique : je ne suis pas ces sujets.
- Ce qu'il faut dire aux clients ou à la presse.

## Sur question précise
- [mots: !sla, !pénalité, contrat, contractuel, engagement, b2b, grand compte, !verdier] Le contrat de Maison Verdier garantit 99,9 % de disponibilité par mois, soit environ 43 minutes d'indisponibilité tolérées. Au-delà : pénalité de 5 % de sa facture mensuelle, environ 40 000 €, et clause de résiliation si une panne dépasse 4 heures.
- [mots: !cumul, total, pertes, perdu, depuis le début] Je recalcule le cumul tous les quarts d'heure : comptez environ 18 000 € par tranche de 15 minutes depuis la première alerte, davantage si la newsletter part sur un checkout en panne.
- [mots: newsletter, black friday, campagne, envoyer] Une newsletter Black Friday envoyée sur un checkout en panne, c'est le trafic d'une heure normale en quelques minutes, et autant de ventes perdues. Financièrement, mieux vaut la décaler que l'envoyer dans le vide.
