// Parcours d'accueil des participants : cinq étapes en texte brut (titre, paragraphes, listes).
// Rien du scénario ici : seul le fonctionnement de l'outil et la façon de mener l'exercice sont décrits.

export interface OnboardingStep {
  id: 'contexte' | 'outil' | 'limites' | 'deroule' | 'role'
  title: string
  paragraphs: string[]
  lists: { title?: string, items: string[] }[]
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'contexte',
    title: 'Bienvenue dans l\'exercice',
    paragraphs: [
      'Vous participez à un exercice de gestion d\'incident. Tout est fictif : l\'entreprise, ses clients, ses systèmes et les événements que vous allez voir. Aucune de vos actions ne touche un vrai service.',
      'Vous faites partie de l\'équipe d\'astreinte d\'une entreprise d\'e-commerce imaginaire. Quand les alertes tomberont, vous devrez comprendre ce qui arrive, décider et coordonner l\'équipe, comme dans une vraie situation.',
      'Vous n\'êtes pas seul : des collègues d\'autres services peuvent être sollicités. Ils sont joués par l\'outil, qui leur fait répondre à vos messages. Traitez-les comme de vrais collègues.',
    ],
    lists: [],
  },
  {
    id: 'outil',
    title: 'Comment fonctionne l\'outil',
    paragraphs: [
      'L\'interface ressemble à Microsoft Teams. Voici ce dont vous aurez besoin.',
    ],
    lists: [
      {
        items: [
          'Les canaux, dans la colonne de gauche : « Général » pour discuter librement, « Incident en cours » où se déroule l\'exercice. Une pastille indique les messages non lus.',
          'Les fils : le bouton de réponse d\'un message ouvre un fil, pour garder une discussion groupée sans noyer le canal.',
          'Les mentions : tapez @ pour obtenir une liste de personnes et choisissez-en une. Si votre message ne contient pas déjà de @mention, écrire le nom de quelqu\'un en clair suffit aussi à l\'interpeller.',
          'Les conversations directes : quand des collègues sont disponibles, la section « Conversations » permet de leur écrire en tête à tête, à l\'abri du canal.',
          'Les réactions : un emoji sous un message pour approuver ou signaler que vous avez vu, sans ajouter de bruit.',
          'Les cartes d\'alerte : une alerte arrive sous forme de carte. Acquittez-la pour dire que vous la prenez en charge, puis résolvez-la quand le problème est réglé.',
          'La présence : les avatars en haut du canal montrent qui est là. Passez dessus pour voir le nom et le rôle de chacun.',
        ],
      },
    ],
  },
  {
    id: 'limites',
    title: 'Ce que vous pouvez faire, et ce que vous ne pouvez pas faire',
    paragraphs: [
      'Il n\'y a aucun accès aux vrais systèmes, ni tableau de bord, ni journaux à consulter. Toute l\'information s\'obtient en interrogeant les bonnes personnes.',
    ],
    lists: [
      {
        title: 'Ce que vous pouvez faire',
        items: [
          'Poser des questions à vos collègues, dans le canal ou en conversation directe.',
          'Demander des vérifications : vos collègues peuvent regarder de leur côté et vous répondre.',
          'Prendre des décisions et les annoncer à l\'équipe.',
        ],
      },
      {
        title: 'Ce qu\'il faut savoir',
        items: [
          'Chacun ne connaît que ce que sa fonction justifie : un interlocuteur n\'a pas la vue d\'ensemble.',
          'Personne ne livre tout sans question. Plus votre question est précise (quoi, depuis quand, sur quoi), plus la réponse sera utile.',
          'Il n\'y a ni pièce jointe ni appel : tout passe par l\'écrit.',
        ],
      },
    ],
  },
  {
    id: 'deroule',
    title: 'Comment se déroule l\'exercice',
    paragraphs: [
      'L\'incident démarre quand l\'animateur le lance. Les alertes arrivent alors dans le canal « Incident en cours ». D\'ici là, vous pouvez vous familiariser avec l\'outil dans « Général ».',
      'Quelques bonnes pratiques pour bien gérer la situation :',
    ],
    lists: [
      {
        items: [
          'Désignez un responsable d\'incident dès le début : une seule personne qui coordonne et tranche.',
          'Faites des points de situation réguliers : ce que l\'on sait, ce que l\'on ignore, ce qui est en cours.',
          'Tracez les décisions dans le canal : qui décide quoi, et à quelle heure.',
          'Répartissez les tâches plutôt que de chercher tous au même endroit.',
        ],
      },
    ],
  },
  {
    id: 'role',
    title: 'Votre rôle',
    paragraphs: [
      'Choisissez le rôle que vous tiendrez dans l\'exercice. Plusieurs personnes peuvent avoir le même, et vous pourrez le changer à tout moment avec le bouton « Aide ».',
      'Votre rôle s\'affiche à côté de votre nom pour que l\'équipe sache qui fait quoi. Il ne donne aucun droit particulier.',
    ],
    lists: [],
  },
]
