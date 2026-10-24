// Mini-parseur Markdown pour les guides de l'animateur : blocs (titres, paragraphes, listes, tableaux) et
// segments en ligne (texte, gras, code). Module pur, sans HTML : le rendu se fait en interpolation de texte
// (MarkdownBlocks.vue), donc `<script>` ou `<b>` restent du texte littéral. Hors périmètre : liens, images,
// listes imbriquées, citations.

export interface InlineSegment {
  type: 'text' | 'strong' | 'code'
  text: string
}

export type MarkdownBlock =
  | { type: 'heading', level: 1 | 2 | 3, content: InlineSegment[] }
  | { type: 'paragraph', content: InlineSegment[] }
  | { type: 'list', ordered: boolean, items: InlineSegment[][] }
  | { type: 'table', header: InlineSegment[][], rows: InlineSegment[][][] }

/** `code` et **gras** ; un marqueur non fermé reste du texte */
export function parseInline(source: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let text = ''
  const flush = () => {
    if (text !== '') segments.push({ type: 'text', text })
    text = ''
  }
  let index = 0
  while (index < source.length) {
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2)
      if (end > index + 2) {
        flush()
        segments.push({ type: 'strong', text: source.slice(index + 2, end) })
        index = end + 2
        continue
      }
    }
    if (source[index] === '`') {
      const end = source.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        segments.push({ type: 'code', text: source.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }
    text += source[index]
    index++
  }
  flush()
  return segments
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const BULLET = /^\s{0,3}[-*]\s+(.*)$/
const ORDERED = /^\s{0,3}\d+[.)]\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map(cell => cell.trim())
}

const isTableRow = (line: string) => line.trim().startsWith('|')

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (line.trim() === '') {
      index++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, content: parseInline(heading[2]!) })
      index++
      continue
    }
    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[index + 1] ?? '')) {
      const header = splitRow(line).map(parseInline)
      index += 2
      const rows: InlineSegment[][][] = []
      while (index < lines.length && isTableRow(lines[index]!)) {
        const cells = splitRow(lines[index]!).map(parseInline)
        while (cells.length < header.length) cells.push([])
        rows.push(cells.slice(0, header.length))
        index++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    const ordered = ORDERED.test(line)
    if (ordered || BULLET.test(line)) {
      const marker = ordered ? ORDERED : BULLET
      const items: InlineSegment[][] = []
      for (;;) {
        const match = marker.exec(lines[index] ?? '')
        if (!match) break
        let item = match[1]!
        index++
        // Ligne de continuation indentée : même puce
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]!) && !BULLET.test(lines[index]!) && !ORDERED.test(lines[index]!)) {
          item += ` ${lines[index]!.trim()}`
          index++
        }
        items.push(parseInline(item))
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    // Paragraphe : lignes consécutives jusqu'à une ligne vide ou un autre bloc
    const parts: string[] = []
    while (index < lines.length) {
      const current = lines[index]!
      if (current.trim() === '' || HEADING.test(current) || BULLET.test(current) || ORDERED.test(current) || isTableRow(current)) break
      parts.push(current.trim())
      index++
    }
    if (parts.length === 0) {
      // Ligne isolée qui ressemble à un tableau sans séparateur : texte
      parts.push(line.trim())
      index++
    }
    blocks.push({ type: 'paragraph', content: parseInline(parts.join(' ')) })
  }
  return blocks
}
