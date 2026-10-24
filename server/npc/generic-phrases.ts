// Phrases génériques des PNJ (hors fiche) : réponse fixe « sollicité » et accusés « je regarde ». Elles ne sont
// jamais réinjectées dans l'historique envoyé au modèle (il les recopierait), ni comptées comme réponse à répéter.

/** Réponse publiée sans moteur quand un PNJ ne peut plus répondre faute de place dans les plafonds */
export const NPC_BUSY_REPLY = 'Je suis sollicité de toutes parts, je reviens vers vous dans une minute.'

/** Accusés d'un PNJ occupé avant sa vraie réponse */
export const NPC_ACK_TEXTS: readonly string[] = [
  'Je regarde, je reviens vers vous.',
  'Une minute, je vérifie et je vous dis.',
  'Je suis sur autre chose, je reviens vers vous dès que je peux.',
]
