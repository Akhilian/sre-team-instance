// Au démarrage : résout le moteur des PNJ (avertissement si NPC_ENGINE est inconnu) et charge les fiches,
// pour qu'une fiche invalide apparaisse dans les logs avant le premier message.
export default defineNitroPlugin(() => {
  npcEngineName()
  void useNpcDispatcher()
})
