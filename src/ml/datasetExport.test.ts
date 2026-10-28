import { describe, expect, it } from 'vitest'
import type { Garment } from '../types/domain'
import { createTrainingExport, EXPORT_FORMAT, toTrainingRecord } from './datasetExport'
import { matchLabel } from './taxonomy'
import { crc32 } from './zip'

const makeGarment = (overrides: Partial<Garment> = {}): Garment => ({
  id: 'g1',
  name: 'Jersey azul · Marca',
  category: 'Abrigo',
  subcategory: 'Jersey',
  colors: ['Azul marino', 'Gris claro'],
  pattern: 'Rayas',
  brand: 'Marca privada',
  notes: 'Nota personal',
  seasons: ['Otoño', 'Invierno'],
  styles: ['Casual'],
  formality: 'Smart casual',
  role: 'Capa',
  image: new Blob(['principal'], { type: 'image/jpeg' }),
  additionalImages: [new Blob(['detalle'], { type: 'image/png' })],
  thumbnail: new Blob(['thumbnail'], { type: 'image/jpeg' }),
  width: 640,
  height: 800,
  confirmedAttributes: ['category', 'colors'],
  suggestedAttributes: ['category', 'subcategory', 'colors'],
  analysis: {
    modelId: 'test',
    modelVersion: '1',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    suggestions: { category: 'Abrigo', subcategory: 'Jersey', colors: ['Azul'] },
    confidenceByAttribute: {},
    sourcesByAttribute: {},
    unknownAttributes: [],
    correctedAttributes: ['colors']
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

interface ParsedEntry { name: string; data: Uint8Array; crc: number }

// jsdom's Blob has no arrayBuffer().
function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function readStoredZip(bytes: Uint8Array): ParsedEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries: ParsedEntry[] = []
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const crc = view.getUint32(offset + 14, true)
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength
    entries.push({ name, crc, data: bytes.subarray(start, start + size) })
    offset = start + size
  }
  return entries
}

describe('taxonomy matching', () => {
  it('prefers the longest phrase and ignores accents', () => {
    expect(matchLabel('subcategory', 'Camiseta de tirantes')).toBe('camiseta-tirantes')
    expect(matchLabel('subcategory', 'cárdigan')).toBe('cardigan')
    expect(matchLabel('colors', 'Azul marino')).toBe('azul-marino')
    expect(matchLabel('subcategory', 'Kimono raro')).toBeNull()
  })
})

describe('training export', () => {
  it('maps garments to taxonomy ids and records how each label was reviewed', () => {
    const record = toTrainingRecord(makeGarment())
    expect(record.labels).toEqual({
      category: 'top',
      subcategory: 'jersey',
      sleeve: null,
      pattern: 'rayas',
      formality: 'smart-casual',
      seasons: ['otono', 'invierno'],
      colors: ['azul-marino', 'gris']
    })
    expect(record.review).toMatchObject({ category: 'accepted-suggestion', colors: 'corrected', pattern: 'manual' })
    expect(record.images).toEqual(['images/g1-0.jpg', 'images/g1-1.png'])
    expect(JSON.stringify(record)).not.toMatch(/Marca|Nota personal/)
  })

  it('keeps unknown values as null instead of guessing', () => {
    const record = toTrainingRecord(makeGarment({ subcategory: 'Kimono raro', category: 'Calzado', pattern: undefined, seasons: [], colors: [] }))
    expect(record.labels).toMatchObject({ category: 'footwear', subcategory: null, pattern: null, seasons: null, colors: null })
    expect(record.raw.subcategory).toBe('Kimono raro')
  })

  it('writes a valid zip with metadata, labels and every photo', async () => {
    const archive = await createTrainingExport([makeGarment()], new Date('2026-10-28T00:00:00.000Z'))
    const entries = readStoredZip(await readBlob(archive))
    expect(entries.map((entry) => entry.name)).toEqual(['export.json', 'labels.jsonl', 'images/g1-0.jpg', 'images/g1-1.png'])
    for (const entry of entries) expect(entry.crc).toBe(crc32(entry.data))
    const info = JSON.parse(new TextDecoder().decode(entries[0]!.data))
    expect(info).toMatchObject({ format: EXPORT_FORMAT, taxonomyVersion: 1, garments: 1 })
    expect(new TextDecoder().decode(entries[3]!.data)).toBe('detalle')
  })

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
