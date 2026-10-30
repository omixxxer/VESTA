import type { TextLine } from './textReader'

/** Size and composition read from a care label. Every match keeps the text it came from, to show it. */
export interface LabelValue {
  value: string
  text: string
  score: number
}

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL']
// Words that announce a size on labels (Spanish, English, French, Italian, German…).
const SIZE_WORDS = '(?:TALLA|TALLE|SIZE|TAILLE|TAGLIA|TG|GR|GROSSE|GRÖSSE|TAM|T)'
// European size systems; US/UK/MEX sizes are not converted.
const EUROPEAN = '(?:EUR|EU|ES|E|FR|F|IT|I|DE|D)'

function upper(text: string): string {
  return text.toLocaleUpperCase('es').normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ').trim()
}

function inRange(value: number, low: number, high: number) {
  return value >= low && value <= high
}

/**
 * The size on a label. A bare letter only counts when it is the whole line and confidently read (OCR often
 * returns stray single letters); numbers need a European system or a size word next to them, so references,
 * percentages or prices are not taken for sizes. Footwear and bottoms prefer the number, other garments the letter.
 */
export function findSize(lines: TextLine[], category?: string): LabelValue | undefined {
  const found: Array<LabelValue & { kind: 'letter' | 'number' | 'jeans' }> = []
  for (const line of lines) {
    const text = upper(line.text)
    const jeans = /\bW\s?(\d{2})\s?[/ ]?\s?L\s?(\d{2})\b/.exec(text)
    if (jeans && inRange(Number(jeans[1]), 24, 46) && inRange(Number(jeans[2]), 26, 38) && line.score >= 0.6) {
      found.push({ kind: 'jeans', value: `W${jeans[1]} L${jeans[2]}`, text: line.text, score: line.score })
    }
    const number = new RegExp(`(?:^|[^A-Z])(?:${EUROPEAN}|${SIZE_WORDS})\\s?[.:]?\\s?(\\d{2}(?:[.,]5)?)(?!\\d|\\s?%)`).exec(text)
    if (number && inRange(Number(number[1]!.replace(',', '.')), 30, 60) && line.score >= 0.6) {
      found.push({ kind: 'number', value: number[1]!.replace('.', ','), text: line.text, score: line.score })
    }
    const named = new RegExp(`(?:^|[^A-Z])${SIZE_WORDS}\\s?[.:]?\\s?(${LETTER_SIZES.join('|')})(?![A-Z0-9])`).exec(text)
    const letter = named?.[1] ?? (LETTER_SIZES.includes(text) ? text : undefined)
    const needed = named ? 0.6 : text.length === 1 ? 0.85 : 0.7
    if (letter && line.score >= needed) found.push({ kind: 'letter', value: letter, text: line.text, score: line.score })
  }
  const order = category === 'footwear'
    ? ['number']
    : category === 'bottom' ? ['jeans', 'number', 'letter'] : ['letter', 'number', 'jeans']
  for (const kind of order) {
    const best = found.filter((entry) => entry.kind === kind).sort((left, right) => right.score - left.score)[0]
    if (best) return { value: best.value, text: best.text, score: best.score }
  }
  return undefined
}

// Fibre names in the languages labels usually repeat them in, to the Spanish name shown in the app.
const FIBRES: Array<[string, string[]]> = [
  ['algodón', ['ALGODON', 'COTTON', 'COTON', 'COTONE', 'BAUMWOLLE', 'ALGODAO', 'KATOEN']],
  ['poliéster', ['POLIESTER', 'POLYESTER', 'POLIESTERE']],
  ['elastano', ['ELASTANO', 'ELASTANE', 'ELASTHANNE', 'ELASTHAN', 'SPANDEX', 'LYCRA']],
  ['poliamida', ['POLIAMIDA', 'POLYAMIDE', 'POLIAMMIDE', 'POLYAMID', 'NYLON', 'NAILON']],
  ['viscosa', ['VISCOSA', 'VISCOSE', 'RAYON', 'VISKOSE']],
  ['lana', ['LANA', 'WOOL', 'LAINE', 'WOLLE', 'LA']],
  ['lino', ['LINO', 'LINEN', 'LIN', 'LEINEN']],
  ['seda', ['SEDA', 'SILK', 'SOIE', 'SETA', 'SEIDE']],
  ['acrílico', ['ACRILICO', 'ACRYLIC', 'ACRYLIQUE', 'ACRYL']],
  ['cachemira', ['CACHEMIRA', 'CASHMERE', 'CACHEMIRE', 'CASHMIRE', 'KASCHMIR']],
  ['lyocell', ['LYOCELL', 'TENCEL']],
  ['modal', ['MODAL']],
  ['poliuretano', ['POLIURETANO', 'POLYURETHANE', 'POLYURETHANNE']],
  ['piel', ['PIEL', 'LEATHER', 'CUIR', 'CUOIO', 'LEDER', 'CUERO']],
  ['plumón', ['PLUMON', 'DOWN', 'DUVET']],
  ['pluma', ['PLUMA', 'FEATHER', 'PLUME', 'FEDER']],
  ['alpaca', ['ALPACA', 'ALPAGA']],
  ['mohair', ['MOHAIR']],
  ['polipropileno', ['POLIPROPILENO', 'POLYPROPYLENE']],
  ['metalizada', ['METALIZADA', 'METALLIC', 'METALLISEE']]
]
const fibreByWord = new Map(FIBRES.flatMap(([name, words]) => words.map((word): [string, string] => [word, name])))

/**
 * The composition on a label, e.g. "95 % algodón, 5 % elastano". Percentages next to a known fibre are read in
 * order ("95% COTTON" or "ALGODÓN 95%"); a fibre repeated in another language is skipped, and reading stops once
 * the percentages add up to 100, so the lining of a second section is not mixed in.
 */
export function findComposition(lines: TextLine[]): LabelValue | undefined {
  const parts: Array<[number, string]> = []
  const sources: TextLine[] = []
  let total = 0
  for (const line of lines) {
    if (line.score < 0.6 || total >= 100) continue
    const text = upper(line.text).replace(/[^A-Z0-9% ]/g, ' ')
    const pattern = /(\d{1,3})\s?%\s?([A-Z]{2,})|([A-Z]{2,})\s?(\d{1,3})\s?%/g
    let used = false
    for (const match of text.matchAll(pattern)) {
      const percent = Number(match[1] ?? match[4])
      const fibre = fibreByWord.get(match[2] ?? match[3]!)
      if (!fibre || !inRange(percent, 1, 100) || parts.some(([, known]) => known === fibre)) continue
      if (total + percent > 100) break
      parts.push([percent, fibre])
      total += percent
      used = true
      if (total >= 100) break
    }
    if (used) sources.push(line)
  }
  if (!parts.length || total < 95) return undefined
  return {
    value: parts.map(([percent, fibre]) => `${percent} % ${fibre}`).join(', '),
    text: sources.map((line) => line.text).join(' · '),
    score: Math.min(...sources.map((line) => line.score))
  }
}
