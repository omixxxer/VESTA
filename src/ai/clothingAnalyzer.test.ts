import { describe, expect, it, vi } from 'vitest'
import {
  analyzeGarmentImage,
  CLOTHING_MODEL_ID,
  CLOTHING_MODEL_VERSION,
  findDominantColor,
  mapClothingLabel
} from './clothingAnalyzer'

function makePixels(): ImageData {
  const width = 20
  const height = 20
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const garment = x > 3 && x < 16 && y > 3 && y < 16
      data[offset] = garment ? 210 : 245
      data[offset + 1] = garment ? 35 : 245
      data[offset + 2] = garment ? 30 : 240
      data[offset + 3] = 255
    }
  }
  return { data, width, height } as ImageData
}

describe('clothing analyzer', () => {
  it('maps controlled English model labels to the Vesta taxonomy', () => {
    expect(mapClothingLabel('a T-shirt')).toMatchObject({
      category: 'Parte superior',
      subcategory: 'Camiseta'
    })
    expect(mapClothingLabel('winter trousers')).toMatchObject({
      category: 'Parte inferior',
      subcategory: 'Pantalón de invierno'
    })
    expect(mapClothingLabel('unknown label')).toBeUndefined()
  })

  it('reduces a uniform border background when finding the dominant garment color', () => {
    expect(findDominantColor(makePixels())).toMatchObject({
      color: 'Rojo',
      score: 1
    })
  })

  it('normalizes and classifies locally, marks unsupported attributes unknown, and keeps scores as suggestions', async () => {
    const image = new Blob(['private garment image'], { type: 'image/jpeg' })
    const normalizedBlob = new Blob(['normalized image'], { type: 'image/jpeg' })
    const normalize = vi.fn(async () => ({ blob: normalizedBlob, pixels: makePixels() }))
    const classify = vi.fn(async (received: Blob) => {
      expect(received).toBe(normalizedBlob)
      return [{ label: 'a T-shirt', score: 0.42 }]
    })

    const result = await analyzeGarmentImage(image, classify, normalize)

    expect(normalize).toHaveBeenCalledWith(image)
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      category: 'Parte superior',
      subcategory: 'Camiseta',
      colors: ['Rojo'],
      confidenceByAttribute: { category: 0.42, subcategory: 0.42, colors: 1 },
      modelId: CLOTHING_MODEL_ID,
      modelVersion: CLOTHING_MODEL_VERSION,
      unknownAttributes: expect.arrayContaining(['pattern', 'sleeveType', 'neckline', 'fit', 'style', 'formality', 'season'])
    })
    expect(Number.isNaN(Date.parse(result.analyzedAt))).toBe(false)
  })

  it('rejects missing or unrecognized predictions instead of simulating a result', async () => {
    const image = new Blob(['image'], { type: 'image/jpeg' })
    const normalize = async () => ({ blob: image, pixels: makePixels() })

    await expect(analyzeGarmentImage(image, async () => [], normalize)).rejects.toThrow('puntuación válida')
    await expect(analyzeGarmentImage(
      image,
      async () => [{ label: 'unmapped clothing item', score: 0.8 }],
      normalize
    )).rejects.toThrow('etiqueta no reconocida')
  })
})
