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
  it('maps the model class ids and names to the Vesta taxonomy', () => {
    expect(mapClothingLabel('LABEL_17')).toMatchObject({
      category: 'Parte superior',
      subcategory: 'Camiseta'
    })
    expect(mapClothingLabel('Winter trousers')).toMatchObject({
      category: 'Parte inferior',
      subcategory: 'Pantalón de invierno'
    })
    expect(mapClothingLabel('LABEL_27')).toBeUndefined()
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
      return [{ label: 'LABEL_17', score: 0.42 }]
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

  it('combines class scores from multiple photos and returns selectable alternatives', async () => {
    const images = [
      new Blob(['front'], { type: 'image/jpeg' }),
      new Blob(['back'], { type: 'image/jpeg' })
    ]
    const normalized = new Blob(['normalized'], { type: 'image/jpeg' })
    const normalize = vi.fn(async () => ({ blob: normalized, pixels: makePixels() }))
    const classify = vi.fn()
      .mockResolvedValueOnce([
        { label: 'LABEL_17', score: 0.7 },
        { label: 'LABEL_13', score: 0.2 }
      ])
      .mockResolvedValueOnce([
        { label: 'LABEL_13', score: 0.6 },
        { label: 'LABEL_17', score: 0.3 }
      ])

    const result = await analyzeGarmentImage(images, classify, normalize)

    expect(normalize).toHaveBeenCalledTimes(2)
    expect(classify).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      category: 'Parte superior',
      subcategory: 'Camiseta',
      confidenceByAttribute: { category: 0.5, subcategory: 0.5 },
      alternatives: [{ category: 'Parte superior', subcategory: 'Camisa', score: 0.4 }]
    })
  })

  it('rejects missing or unrecognized predictions instead of simulating a result', async () => {
    const image = new Blob(['image'], { type: 'image/jpeg' })
    const normalize = async () => ({ blob: image, pixels: makePixels() })

    await expect(analyzeGarmentImage(image, async () => [], normalize)).rejects.toThrow('puntuaciones o etiquetas no válidas')
    await expect(analyzeGarmentImage(
      image,
      async () => [{ label: 'unmapped clothing item', score: 0.8 }],
      normalize
    )).rejects.toThrow('etiqueta no reconocida')
  })
})
