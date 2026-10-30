import { afterEach, describe, expect, it } from 'vitest'
import { database } from './database'
import { garmentRepository } from './garmentRepository'
import type { Garment } from '../types/domain'

const makeGarment = (id: string): Garment => ({
  id,
  name: 'Camisa blanca',
  category: 'Parte superior',
  subcategory: 'Camisa',
  colors: ['Blanco'],
  seasons: ['Primavera'],
  styles: ['Minimalista'],
  dressLevels: ['Arreglado'],
  role: 'Top',
  image: new Blob(['image'], { type: 'image/png' }),
  thumbnail: new Blob(['thumbnail'], { type: 'image/jpeg' }),
  width: 640,
  height: 800,
  confirmedAttributes: ['category', 'colors'],
  suggestedAttributes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

afterEach(async () => {
  await database.garments.clear()
  await database.garmentCodeCounters.clear()
})

describe('garmentRepository', () => {
  it('creates, reads, updates and deletes a garment in IndexedDB', async () => {
    const garment = makeGarment('garment-1')
    await garmentRepository.create(garment)

    expect(await garmentRepository.get(garment.id)).toMatchObject({ name: 'Camisa blanca' })
    expect(await garmentRepository.count()).toBe(1)

    await garmentRepository.update({ ...garment, name: 'Camisa de lino' })
    expect(await garmentRepository.get(garment.id)).toMatchObject({ name: 'Camisa de lino' })

    await garmentRepository.remove(garment.id)
    expect(await garmentRepository.get(garment.id)).toBeUndefined()
    expect(await garmentRepository.count()).toBe(0)
  })

  it('gives each new garment a code by type that survives edits and deletions of others', async () => {
    const hoodie = (id: string): Garment => ({ ...makeGarment(id), subcategory: 'Sudadera con capucha', name: 'Sudadera gris' })
    await garmentRepository.create(hoodie('h1'))
    await garmentRepository.create(hoodie('h2'))
    await garmentRepository.create(makeGarment('shirt'))
    await garmentRepository.create({ ...makeGarment('unknown'), subcategory: 'Kimono' })
    expect((await garmentRepository.get('h1'))?.code).toBe('SDC-001')
    expect((await garmentRepository.get('h2'))?.code).toBe('SDC-002')
    expect((await garmentRepository.get('shirt'))?.code).toBe('CSA-001')
    expect((await garmentRepository.get('unknown'))?.code).toBe('SUP-001') // falls back to the category

    // The form sends edits without the code and may change the type: the code stays.
    await garmentRepository.update({ ...hoodie('h1'), subcategory: 'Jersey' })
    expect((await garmentRepository.get('h1'))?.code).toBe('SDC-001')
    // The code of a deleted garment is never given to another one.
    await garmentRepository.remove('h2')
    await garmentRepository.create(hoodie('h3'))
    expect((await garmentRepository.get('h3'))?.code).toBe('SDC-003')
  })

  it('retains the image blob when reading a stored garment', async () => {
    const garment = makeGarment('garment-image')
    await garmentRepository.create(garment)

    const stored = await garmentRepository.get(garment.id)
    expect(stored?.image).toBeDefined()
    expect(stored?.thumbnail).toBeDefined()
  })

  it('persists analysis provenance, confidence and local corrections with the garment', async () => {
    const garment = {
      ...makeGarment('garment-analysis'),
      analysis: {
        modelId: 'wargoninnovation/wargon-clothing-classifier',
        modelVersion: 'model-revision',
        analyzedAt: '2026-10-20T11:00:00.000Z',
        suggestions: {
          category: 'Parte superior' as const,
          subcategory: 'Camiseta',
          colors: ['Rojo']
        },
        confidenceByAttribute: { category: 0.42, subcategory: 0.42, colors: 0.8 },
        sourcesByAttribute: {
          category: 'wargon-vit' as const,
          subcategory: 'wargon-vit' as const,
          colors: 'local-pixels' as const
        },
        unknownAttributes: ['pattern', 'sleeveType', 'neckline'],
        correctedAttributes: ['colors']
      }
    }
    await garmentRepository.create(garment)

    expect(await garmentRepository.get(garment.id)).toMatchObject({
      analysis: {
        modelId: 'wargoninnovation/wargon-clothing-classifier',
        confidenceByAttribute: { category: 0.42, subcategory: 0.42, colors: 0.8 },
        sourcesByAttribute: { category: 'wargon-vit', subcategory: 'wargon-vit', colors: 'local-pixels' },
        correctedAttributes: ['colors'],
        unknownAttributes: ['pattern', 'sleeveType', 'neckline']
      }
    })
  })
})
