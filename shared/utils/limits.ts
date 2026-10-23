// Plafonds de l'API, regroupés ici : l'instance free (512 Mo) doit rester bornée quoi qu'envoient
// les participants ou, en phase 2, les PNJ. Module pur, partagé par le serveur et les tests.

/** Longueur maximale d'un auteur (et d'un nom de présence ou d'acquittement) */
export const AUTHOR_MAX_LENGTH = 50
/** Longueur maximale du texte d'un message, d'une annonce ou d'une alerte */
export const TEXT_MAX_LENGTH = 2000
/** Longueur maximale du nom d'un canal */
export const CHANNEL_NAME_MAX_LENGTH = 50

/** Taille maximale (octets, content-length) du corps d'un POST /api/* : 413 au-delà */
export const BODY_MAX_BYTES = 16_384
/** Messages conservés par canal : au-delà, les plus anciens sont retirés (FIFO) */
export const CHANNEL_MESSAGES_MAX = 2000
/** Nombre maximal de canaux, canaux pré-créés compris : 409 au-delà */
export const CHANNELS_MAX = 30
/** Entrées de présence actives (une par nom) : 429 pour un nouveau nom au-delà */
export const PRESENCE_ENTRIES_MAX = 200
/** Auteurs distincts par réaction (emoji d'un message) : 409 pour un nouvel auteur au-delà */
export const REACTION_AUTHORS_MAX = 100

// Débit d'écriture (POST /api/* hors /api/presence et /api/admin/*), mesuré sur le front : un
// participant actif envoie au plus ~10 écritures par 10 s (messages, réponses, réactions, acquittements),
// la présence (battement 3 s + frappe ≤ 1 / 2 s, ~8 par 10 s) est exclue. Un atelier met 30 à 40
// participants derrière une seule IP (NAT) : la clé fine est IP + auteur, le plafond par IP est large.
/** Écritures autorisées par fenêtre pour une même IP et un même auteur (ou nom) */
export const WRITE_RATE_LIMIT = 120
/** Écritures autorisées par fenêtre pour une IP, tous auteurs confondus : 40 participants × 10, avec 50 % de marge */
export const WRITE_RATE_IP_LIMIT = 600
/** Durée de la fenêtre fixe du limiteur de débit */
export const WRITE_RATE_WINDOW_MS = 10_000
