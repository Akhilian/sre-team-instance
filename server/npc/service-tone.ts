// Filtre de sortie des moteurs à modèle : retire les formules de service client (excuses, remerciements,
// salutations, « Comment puis-je vous aider ») que les petits modèles ajoutent malgré les consignes.
// Module pur et déterministe ; appliqué par les adaptateurs avant la troncature. Un texte réduit à des
// formules devient vide (traité comme une réponse vide : repli keywords).
import { normalizeText } from './lexical-retriever'

/** Formules de tête : excuses, remerciements, compassion, salutations (comparées sans accents ni casse) */
const LEADING_FORMULAS = [
  'je suis (?:vraiment |sincerement )?desole(?:e)?s?',
  'nous sommes desoles?',
  '(?:toutes )?(?:mes|nos) excuses',
  'je comprends (?:votre|ta) (?:frustration|inquietude|preoccupation)',
  'merci (?:pour|de) (?:votre|ton) (?:message|question|patience)',
  'bonjour(?: a tous| tout le monde)?',
  'comment puis-je (?:vous |t\')aider',
  'n\'hesitez pas',
]
/** Formules de fin : invitations de service client */
const TRAILING_FORMULAS = ['n\'hesitez pas', 'comment puis-je (?:vous |t\')aider']

// Jusqu'à trois mots avant la formule (« Je vous présente toutes mes excuses »), puis une frontière de mot
const LEADING_RE = new RegExp(`^(?:[a-z']+\\s+){0,3}?(?:${LEADING_FORMULAS.join('|')})\\b`)
const TRAILING_RE = new RegExp(`(?:${TRAILING_FORMULAS.join('|')})`)

/** Forme comparable : minuscules, sans accents, apostrophes droites, sans ponctuation de tête */
function comparable(text: string): string {
  return normalizeText(text).replace(/[’‘]/g, '\'').replace(/^[^a-z0-9']+/, '')
}

/** Phrases du texte (coupées après . ! ? … suivis d'une espace : « v2.41.0 » et « 1,2 » restent entiers) */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map(sentence => sentence.trim()).filter(sentence => sentence !== '')
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1)
}

/**
 * Phrase de tête : supprimée en entier si elle n'est que formule ; si une première proposition formule
 * est suivie d'une suite (« Bonjour, le pool est saturé »), seule cette suite est gardée.
 * undefined : la phrase n'est pas une formule.
 */
function stripLeadingSentence(sentence: string): string | undefined {
  if (!LEADING_RE.test(comparable(sentence))) return undefined
  const clause = /^(.*?[^\d]),\s+(\S.*)$/s.exec(sentence)
  if (clause && LEADING_RE.test(comparable(clause[1]!))) return capitalize(clause[2]!)
  return ''
}

/** Retire les formules de service client en tête et en fin de texte */
export function stripServiceTone(text: string): string {
  const parts = sentences(text)
  while (parts.length > 0) {
    const stripped = stripLeadingSentence(parts[0]!)
    if (stripped === undefined) break
    if (stripped === '') parts.shift()
    else {
      parts[0] = stripped
    }
  }
  while (parts.length > 0 && TRAILING_RE.test(comparable(parts.at(-1)!))) parts.pop()
  return parts.join(' ').trim()
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Préambule méta d'un modèle qui commente sa tâche (« Je vais reformuler en 1 à 2 phrases : », « Voici la reformulation : ») */
const META_PREAMBLE = /^\s*(?:je vais (?:donc )?(?:reformuler|r[ée]écrire)[^:\n]*|voici (?:une |la |ma )?(?:nouvelle )?reformulation[^:\n]*|reformulation|message reformul[ée]|intervention spontan[ée]e)\s*:\s*/i
/** Trace de la consigne dans une intervention spontanée : la sortie est inutilisable */
const INSTRUCTION_TRACE = /reformul|message de base|en 1 à [23] phrases|règles/i
const QUOTES: Record<string, string> = { '«': '»', '"': '"', '“': '”' }

/** Retire en tête `[HH:MM]` et `<nom complet|prénom> :` (le modèle imite le format de l'historique) */
function stripAuthorPrefix(text: string, name: string): string {
  const names = [name, name.split(/\s+/)[0] ?? name].filter(part => part !== '').map(escapeRegExp)
  const prefix = new RegExp(`^\\s*(?:\\[\\d{1,2}[:h]\\d{2}\\]\\s*)?(?:(?:${names.join('|')})(?:\\s*\\(toi\\))?\\s*:\\s*)?`, 'i')
  return text.replace(prefix, '')
}

/** Retire une paire de guillemets qui englobe tout le texte */
function stripQuotes(text: string): string {
  const trimmed = text.trim()
  const close = QUOTES[trimmed.charAt(0)]
  return close !== undefined && trimmed.length > 1 && trimmed.endsWith(close) ? trimmed.slice(1, -1).trim() : trimmed
}

/** Nombres d'un texte, sans espaces de milliers (« 1 200 » → « 1200 »), pour comparer reformulation et message de base */
function numbersOf(text: string): string[] {
  return (text.match(/\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)?/g) ?? []).map(value => value.replace(/[ \u00a0\u202f]/g, ''))
}

/** Garde-fou d'une reformulation : aucun nombre absent du message de base, et pas plus de deux fois plus longue */
function stayedWithinBase(text: string, base: string): boolean {
  const known = new Set(numbersOf(base))
  return numbersOf(text).every(value => known.has(value)) && text.length <= 2 * base.length
}

/**
 * Nettoyage complet de la sortie d'un moteur à modèle : préfixes `[HH:MM] Nom :`, préambule méta, guillemets
 * englobants, puis formules de service client. Vide si la sortie est inutilisable (repli keywords) : texte
 * vide, ou, pour une intervention spontanée, trace de la consigne.
 */
export function cleanModelOutput(text: string, options: { personaName: string, spontaneous?: boolean, base?: string }): string {
  let out = stripAuthorPrefix(text, options.personaName)
  out = out.replace(META_PREAMBLE, '')
  out = stripAuthorPrefix(stripQuotes(out), options.personaName)
  out = stripServiceTone(stripQuotes(out)).trim()
  if (options.spontaneous && INSTRUCTION_TRACE.test(out)) return ''
  if (options.spontaneous && options.base !== undefined && !stayedWithinBase(out, options.base)) return ''
  return out
}
