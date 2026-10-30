import taxonomyJson from '../../ml/taxonomy.json'
import type { GarmentCategory } from '../types/domain'

// Mirrors ml/vesta_ml/taxonomy.py; both read ml/taxonomy.json.
export type LabelHead = 'category' | 'subcategory' | 'sleeve' | 'fit' | 'pattern' | 'formality' | 'seasons' | 'colors'
export type AttributeHead = Exclude<LabelHead, 'category' | 'subcategory'>

interface TaxonomyValue {
  id: string
  label: string
  synonyms?: string[]
}

export const taxonomy = taxonomyJson
export const TAXONOMY_VERSION = taxonomy.version

export function normalizeLabel(text: string): string {
  return text
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function valuesFor(head: LabelHead): TaxonomyValue[] {
  if (head === 'category') return taxonomy.categories
  if (head === 'subcategory') return taxonomy.subcategories
  return taxonomy.attributes[head].values
}

interface Phrase { text: string; pattern: RegExp }

const phraseCache = new Map<LabelHead, Array<[string, Phrase[]]>>()

// Each word also matches its Spanish plural (azul → azules); normalized words are [a-z0-9] only.
const pluralPattern = (phrase: string) => new RegExp(`(^| )${phrase.split(' ').map((word) => `${word}(?:e?s)?`).join(' ')}( |$)`)

function phrasesFor(head: LabelHead) {
  let phrases = phraseCache.get(head)
  if (!phrases) {
    phrases = valuesFor(head).map((value) => [
      value.id,
      [...new Set([value.id, value.label, ...(value.synonyms ?? [])].map(normalizeLabel).filter(Boolean))]
        .map((text) => ({ text, pattern: pluralPattern(text) }))
    ])
    phraseCache.set(head, phrases)
  }
  return phrases
}

/** Maps free text to a taxonomy id; the longest matching phrase wins. */
export function matchLabel(head: LabelHead, text: string | undefined): string | null {
  const normalized = normalizeLabel(text ?? '')
  if (!normalized) return null
  let best: { length: number; id: string } | null = null
  for (const [id, phrases] of phrasesFor(head)) {
    for (const { text: phrase, pattern } of phrases) {
      if (normalized === phrase) return id
      if (pattern.test(normalized) && (!best || phrase.length > best.length)) {
        best = { length: phrase.length, id }
      }
    }
  }
  return best?.id ?? null
}

export function categoryIdForLabel(label: GarmentCategory): string {
  const category = taxonomy.categories.find((entry) => entry.label === label)
  if (!category) throw new Error(`Categoría sin entrada en la taxonomía: ${label}`)
  return category.id
}

export function categoryOfSubcategory(subcategoryId: string): string | null {
  return taxonomy.subcategories.find((entry) => entry.id === subcategoryId)?.category ?? null
}
