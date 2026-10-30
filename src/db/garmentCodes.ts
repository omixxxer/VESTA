import { categoryIdForLabel, matchLabel, taxonomy } from '../ml/taxonomy'
import type { Garment } from '../types/domain'

// Short codes such as SUD-002 tell apart garments that look alike (four grey sweatshirts). The prefix comes from
// the type (the "code" of each subcategory, or of the category when the subcategory is unknown) and the number
// counts garments of that type. A code is given once, when the garment is created, and never changes.

const subcategoryCodes = new Map(taxonomy.subcategories.map((entry) => [entry.id, entry.code]))
const categoryCodes = new Map(taxonomy.categories.map((entry) => [entry.id, entry.code]))

export function codePrefix(garment: Pick<Garment, 'category' | 'subcategory'>): string {
  const subcategory = matchLabel('subcategory', garment.subcategory)
  return (subcategory && subcategoryCodes.get(subcategory)) || categoryCodes.get(categoryIdForLabel(garment.category)) || 'PRE'
}

export function formatCode(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, '0')}`
}

function parseCode(code: string): [string, number] | undefined {
  const match = /^([A-Z]+)-(\d+)$/.exec(code)
  return match ? [match[1]!, Number(match[2])] : undefined
}

/**
 * The next code for a prefix: after the highest number among `existing` codes and `lastGiven` (the counter kept
 * in the database), so the code of a deleted garment is never given again.
 */
export function nextCode(prefix: string, existing: Iterable<string>, lastGiven = 0): string {
  let highest = lastGiven
  for (const code of existing) {
    const parsed = parseCode(code)
    if (parsed?.[0] === prefix) highest = Math.max(highest, parsed[1])
  }
  return formatCode(prefix, highest + 1)
}

/** Counter rows (highest number per prefix) for a set of codes. */
export function codeCounters(codes: Iterable<string>): Array<{ prefix: string; last: number }> {
  const last = new Map<string, number>()
  for (const code of codes) {
    const parsed = parseCode(code)
    if (parsed) last.set(parsed[0], Math.max(last.get(parsed[0]) ?? 0, parsed[1]))
  }
  return [...last].map(([prefix, number]) => ({ prefix, last: number }))
}

/** Codes for garments that have none, numbered by creation date; used when upgrading the database. */
export function assignMissingCodes(garments: Array<Pick<Garment, 'id' | 'category' | 'subcategory' | 'createdAt'> & { code?: string }>): Map<string, string> {
  const used = garments.flatMap((garment) => garment.code ? [garment.code] : [])
  const assigned = new Map<string, string>()
  const pending = garments.filter((garment) => !garment.code).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  for (const garment of pending) {
    const code = nextCode(codePrefix(garment), used)
    used.push(code)
    assigned.set(garment.id, code)
  }
  return assigned
}
