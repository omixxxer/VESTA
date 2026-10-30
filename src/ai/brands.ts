import type { TextLine } from './textReader'

/**
 * Brands searched for in the text read from a photo. `aliases` are other spellings found on garments; `whole`
 * marks names that are also common words or very short, which only count when they are the whole line.
 */
interface Brand {
  name: string
  aliases?: string[]
  whole?: boolean
}

export const BRANDS: Brand[] = [
  { name: 'Nike', aliases: ['Nike Air', 'Just do it'] },
  { name: 'Jordan', aliases: ['Air Jordan'], whole: true },
  { name: 'Adidas', aliases: ['Adidas Originals'] },
  { name: 'Puma' },
  { name: 'Reebok' },
  { name: 'New Balance' },
  { name: 'Converse', aliases: ['All Star', 'Chuck Taylor'] },
  { name: 'Vans', aliases: ['Off the wall'] },
  { name: 'Asics' },
  { name: 'Fila' },
  { name: 'Skechers' },
  { name: 'Under Armour' },
  { name: 'Salomon' },
  { name: 'Hoka', aliases: ['Hoka One One'] },
  { name: 'Saucony' },
  { name: 'Mizuno' },
  { name: 'Brooks', whole: true },
  { name: 'On Running', aliases: ['On Cloud'] },
  { name: 'Diadora' },
  { name: 'Kappa' },
  { name: 'Le Coq Sportif' },
  { name: 'Ellesse' },
  { name: 'Umbro' },
  { name: 'Joma' },
  { name: 'Kelme' },
  { name: 'Hummel' },
  { name: 'Lotto', whole: true },
  { name: 'Champion' },
  { name: 'Lacoste' },
  { name: 'Tommy Hilfiger', aliases: ['Tommy Jeans', 'Hilfiger'] },
  { name: 'Calvin Klein', aliases: ['CK Jeans'] },
  { name: "Levi's", aliases: ['Levis', 'Levi Strauss'] },
  { name: 'Wrangler' },
  { name: 'Lee', whole: true },
  { name: 'Diesel', whole: true },
  { name: 'Guess', whole: true },
  { name: 'Ralph Lauren', aliases: ['Polo Ralph Lauren'] },
  { name: 'Hugo Boss', aliases: ['Hugo'] },
  { name: 'Boss', whole: true },
  { name: 'Armani', aliases: ['Emporio Armani', 'Armani Exchange', 'Giorgio Armani'] },
  { name: 'Michael Kors' },
  { name: 'Carhartt', aliases: ['Carhartt WIP'] },
  { name: 'Dickies' },
  { name: 'The North Face', aliases: ['North Face'] },
  { name: 'Patagonia' },
  { name: 'Columbia' },
  { name: 'Quiksilver' },
  { name: 'Billabong' },
  { name: 'Superdry' },
  { name: 'Napapijri' },
  { name: 'Timberland' },
  { name: 'Dr. Martens', aliases: ['Dr Martens', 'Doc Martens', 'Air Wair', 'AirWair'] },
  { name: 'Birkenstock' },
  { name: 'Crocs' },
  { name: 'Clarks' },
  { name: 'UGG', whole: true },
  { name: 'Camper' },
  { name: 'Pikolinos' },
  { name: 'Superga' },
  { name: 'Victoria', whole: true },
  { name: 'Munich', whole: true },
  { name: 'Kickers' },
  { name: 'Havaianas' },
  { name: 'Veja' },
  { name: 'Zara' },
  { name: 'Mango', whole: true },
  { name: 'H&M', aliases: ['H & M', 'Hennes & Mauritz'] },
  { name: 'Pull&Bear', aliases: ['Pull & Bear', 'Pull and Bear'] },
  { name: 'Bershka' },
  { name: 'Stradivarius' },
  { name: 'Massimo Dutti' },
  { name: 'Oysho' },
  { name: 'Uniqlo' },
  { name: 'Primark' },
  { name: 'Springfield' },
  { name: 'Cortefiel' },
  { name: 'Desigual' },
  { name: 'El Ganso' },
  { name: 'Scalpers' },
  { name: 'Gap', whole: true },
  { name: 'Decathlon' },
  { name: 'Quechua' },
  { name: 'Kalenji' },
  { name: 'Domyos' },
  { name: 'Kiabi' },
  { name: 'C&A', whole: true },
  { name: 'Gucci' },
  { name: 'Prada' },
  { name: 'Versace' },
  { name: 'Burberry' },
  { name: 'Balenciaga' },
  { name: 'Moncler' },
  { name: 'Stone Island' },
  { name: 'Golden Goose' }
]

export interface BrandMatch {
  brand: string
  score: number
  text: string
}

export function normalizeText(text: string): string {
  return text
    .toLocaleUpperCase('es')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/['’`.]/g, '')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .trim()
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[right.length]!
}

const candidates = BRANDS.flatMap((brand) => [brand.name, ...(brand.aliases ?? [])].map((alias) => ({
  brand: brand.name,
  alias: normalizeText(alias),
  whole: brand.whole ?? false
})))

/** How well one line of text names one alias: 1 exact, less for spaced-out letters or a single misread letter. */
function aliasScore(line: string, alias: string, whole: boolean): number {
  if (line === alias) return 1
  if (whole) return 0
  if (` ${line} `.includes(` ${alias} `)) return 1
  const compactLine = line.replaceAll(' ', '')
  const compactAlias = alias.replaceAll(' ', '')
  // Logos often space their letters (N I K E) or the detector splits them.
  if (compactAlias.length >= 4 && compactLine === compactAlias) return 0.95
  if (compactAlias.length >= 5 && compactLine.includes(compactAlias)) return 0.9
  if (compactAlias.length >= 5) {
    const words = line.split(' ')
    if (words.some((word) => Math.abs(word.length - compactAlias.length) <= 1 && editDistance(word, compactAlias) <= 1)) return 0.8
  }
  return 0
}

/** The most likely brand in the text of one or more photos, or undefined below `minimum`. */
export function findBrand(lines: TextLine[], minimum = 0.6): BrandMatch | undefined {
  let best: BrandMatch | undefined
  for (const line of lines) {
    const text = normalizeText(line.text)
    if (!text) continue
    for (const candidate of candidates) {
      const score = aliasScore(text, candidate.alias, candidate.whole) * line.score
      if (score >= minimum && score > (best?.score ?? 0)) best = { brand: candidate.brand, score, text: line.text }
    }
  }
  return best
}
