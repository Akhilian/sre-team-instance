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
/** Nombre maximal de canaux d'équipe, canaux pré-créés compris (conversations directes exclues) : 409 au-delà */
export const CHANNELS_MAX = 30
/** Nombre maximal de conversations directes participant ↔ PNJ (40 participants × 6 PNJ, avec marge) : 409 au-delà */
export const DIRECT_CHANNELS_MAX = 300
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

// PNJ (phase 2) : réponses courtes et bornées, quel que soit le moteur (keywords ou, plus tard, un modèle)
/** Longueur maximale d'une réponse de PNJ : tronquée au-delà */
export const NPC_REPLY_MAX_LENGTH = 600
/** PNJ distincts qui répondent à un même message (mentions suivantes ignorées) */
export const NPC_MENTIONS_PER_MESSAGE_MAX = 3
/** Réponses d'un même PNJ dans un même canal par minute glissante : il s'y tait au-delà */
export const NPC_REPLIES_PER_NPC_PER_MINUTE = 6
/** Réponses de tous les PNJ dans un même canal par minute glissante : ils s'y taisent au-delà */
export const NPC_REPLIES_PER_MINUTE = 20
/** Réponses de tous les PNJ dans les canaux d'équipe, par minute glissante : borne les appels au modèle */
export const NPC_REPLIES_GLOBAL_PER_MINUTE = 60
/**
 * Réponses de tous les PNJ dans les conversations directes, par minute glissante : budget séparé de celui
 * des canaux d'équipe, pour que des participants qui interrogent les PNJ en direct n'étouffent pas les
 * réponses dans #incident-en-cours. Dimensionnement simple et généreux : un atelier compte au plus ~15
 * participants, qui ne parlent pas en permanence. Chaque conversation reste bornée par
 * NPC_REPLIES_PER_NPC_PER_MINUTE (un seul PNJ par conversation). Pire cas : 60 + 120 appels au modèle par minute.
 */
export const NPC_DIRECT_REPLIES_GLOBAL_PER_MINUTE = 120
