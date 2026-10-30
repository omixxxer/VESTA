import type { Garment } from '../types/domain'
import { categoryIdForLabel, categoryOfSubcategory, matchLabel, TAXONOMY_VERSION, type LabelHead } from './taxonomy'
import { createZip, type ZipEntry } from './zip'

export const EXPORT_FORMAT = 'vesta-training-export'

type ReviewState = 'corrected' | 'accepted-suggestion' | 'manual'

export interface TrainingRecord {
  garmentId: string
  images: string[]
  labels: Record<LabelHead, string | string[] | null>
  /** How each label was obtained, so training can down-weight unreviewed model suggestions. */
  review: Partial<Record<LabelHead, ReviewState>>
  /** Original text, kept so unmatched values can be added to the taxonomy later. */
  raw: { category: string; subcategory: string; pattern?: string; colors: string[]; seasons: string[]; dressLevels: string[] }
}

const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

function reviewState(garment: Garment, attribute: 'category' | 'subcategory' | 'colors'): ReviewState {
  if (garment.analysis?.correctedAttributes.includes(attribute)) return 'corrected'
  if (garment.suggestedAttributes.includes(attribute)) return 'accepted-suggestion'
  return 'manual'
}

function uniqueMatches(head: LabelHead, values: string[]): string[] | null {
  const matches = [...new Set(values.map((value) => matchLabel(head, value)).filter((value): value is string => value !== null))]
  return matches.length ? matches : null
}

export function photosOf(garment: Garment): Blob[] {
  return [garment.image, ...(garment.additionalImages ?? [])]
}

/** Labels only: no name, brand, size or notes leave the device in the export. */
export function toTrainingRecord(garment: Garment): TrainingRecord {
  const subcategory = matchLabel('subcategory', garment.subcategory)
  return {
    garmentId: garment.id,
    images: photosOf(garment).map((photo, index) => `images/${garment.id}-${index}.${extensions[photo.type] ?? 'jpg'}`),
    labels: {
      // The taxonomy decides the category when the subcategory is known (e.g. a jersey is a top).
      category: (subcategory && categoryOfSubcategory(subcategory)) ?? categoryIdForLabel(garment.category),
      subcategory,
      sleeve: null,
      fit: null,
      pattern: matchLabel('pattern', garment.pattern),
      formality: uniqueMatches('formality', garment.dressLevels),
      seasons: uniqueMatches('seasons', garment.seasons),
      colors: uniqueMatches('colors', garment.colors)
    },
    review: {
      category: reviewState(garment, 'category'),
      subcategory: reviewState(garment, 'subcategory'),
      colors: reviewState(garment, 'colors'),
      pattern: 'manual',
      formality: 'manual',
      seasons: 'manual'
    },
    raw: {
      category: garment.category,
      subcategory: garment.subcategory,
      ...(garment.pattern ? { pattern: garment.pattern } : {}),
      colors: garment.colors,
      seasons: garment.seasons,
      dressLevels: garment.dressLevels
    }
  }
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export async function createTrainingExport(garments: Garment[], exportedAt = new Date()): Promise<Blob> {
  const encoder = new TextEncoder()
  const records = garments.map(toTrainingRecord)
  const entries: ZipEntry[] = [
    {
      name: 'export.json',
      data: encoder.encode(JSON.stringify({
        format: EXPORT_FORMAT,
        taxonomyVersion: TAXONOMY_VERSION,
        exportedAt: exportedAt.toISOString(),
        garments: records.length
      }, null, 2))
    },
    { name: 'labels.jsonl', data: encoder.encode(records.map((record) => JSON.stringify(record)).join('\n') + '\n') }
  ]
  for (const [index, garment] of garments.entries()) {
    const photos = photosOf(garment)
    for (const [photoIndex, name] of records[index]!.images.entries()) {
      entries.push({ name, data: await blobBytes(photos[photoIndex]!) })
    }
  }
  return createZip(entries)
}
