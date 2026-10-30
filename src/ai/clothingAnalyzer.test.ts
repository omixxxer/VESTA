import { describe, expect, it, vi } from 'vitest'
import {
  analyzeGarmentImage,
  attributeApplies,
  CLOTHING_MODEL_ID,
  findDominantColor,
  type HeadProbabilities
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

function result(probabilities: HeadProbabilities) {
  return { modelVersion: 'heads-test', probabilities }
}

const tee: HeadProbabilities = {
  category: { top: 0.8, bottom: 0.15, footwear: 0.05 },
  // vaqueros scores highest overall, but a top cannot be jeans.
  subcategory: { vaqueros: 0.5, camiseta: 0.3, polo: 0.1, botas: 0.1 },
  sleeve: { corta: 0.7, larga: 0.3 },
  fit: { recto: 0.9, ancho: 0.1 },
  pattern: { rayas: 0.6, liso: 0.4 }
}

describe('clothing analyzer', () => {
  it('reduces a uniform border background when finding the dominant garment color', () => {
    expect(findDominantColor(makePixels())).toMatchObject({
      color: 'Rojo',
      score: 1
    })
  })

  it('applies attributes only where the taxonomy allows them', () => {
    expect(attributeApplies('sleeve', 'top', 'camiseta')).toBe(true)
    expect(attributeApplies('sleeve', 'bottom', 'vaqueros')).toBe(false)
    expect(attributeApplies('fit', 'bottom', 'vaqueros')).toBe(true)
    expect(attributeApplies('fit', 'bottom', 'falda')).toBe(false)
    expect(attributeApplies('pattern', 'footwear', 'botas')).toBe(true)
  })

  it('keeps the subcategory within the predicted category and fills pattern and sleeve', async () => {
    const image = new Blob(['private garment image'], { type: 'image/jpeg' })
    const normalizedBlob = new Blob(['normalized image'], { type: 'image/jpeg' })
    const normalize = vi.fn(async () => ({ blob: normalizedBlob, pixels: makePixels() }))
    const classify = vi.fn(async (received: Blob) => {
      expect(received).toBe(normalizedBlob)
      return result(tee)
    })

    const suggestion = await analyzeGarmentImage(image, classify, normalize)

    expect(normalize).toHaveBeenCalledWith(image)
    expect(suggestion).toMatchObject({
      category: 'Parte superior',
      subcategory: 'Camiseta',
      colors: ['Rojo'],
      pattern: { value: 'rayas', label: 'Rayas', score: 0.6 },
      sleeve: { value: 'corta', label: 'Manga corta' },
      modelId: CLOTHING_MODEL_ID,
      modelVersion: 'heads-test'
    })
    expect(suggestion.fit).toBeUndefined() // a top has no trouser fit
    expect(suggestion.confidenceByAttribute.category).toBeCloseTo(0.8)
    expect(suggestion.confidenceByAttribute.subcategory).toBeCloseTo(0.75) // 0.3 / (0.3 + 0.1)
    expect(suggestion.alternatives[0]).toMatchObject({ category: 'Parte superior', subcategory: 'Polo' })
    expect(suggestion.alternatives[0]!.score).toBeCloseTo(0.2)
    expect(suggestion.unknownAttributes).not.toContain('pattern')
    expect(Number.isNaN(Date.parse(suggestion.analyzedAt))).toBe(false)
  })

  it('averages the photos and shows the fit of trousers', async () => {
    const images = [new Blob(['front'], { type: 'image/jpeg' }), new Blob(['back'], { type: 'image/jpeg' })]
    const normalize = vi.fn(async () => ({ blob: new Blob(['normalized']), pixels: makePixels() }))
    const jeans: HeadProbabilities = { ...tee, category: { top: 0.1, bottom: 0.9 } }
    const classify = vi.fn()
      .mockResolvedValueOnce(result(tee))
      .mockResolvedValueOnce(result(jeans))

    const suggestion = await analyzeGarmentImage(images, classify, normalize)

    expect(classify).toHaveBeenCalledTimes(2)
    expect(suggestion).toMatchObject({
      category: 'Parte inferior',
      subcategory: 'Vaqueros',
      fit: { value: 'recto', label: 'Recto' }
    })
    expect(suggestion.confidenceByAttribute.category).toBeCloseTo(0.525)
    expect(suggestion.sleeve).toBeUndefined()
  })

  it('leaves the subcategory empty when the category has none in the model', async () => {
    const image = new Blob(['image'], { type: 'image/jpeg' })
    const normalize = async () => ({ blob: image, pixels: makePixels() })
    const suggestion = await analyzeGarmentImage(image, async () => result({
      category: { accessory: 0.9, top: 0.1 },
      subcategory: { camiseta: 1 }
    }), normalize)
    expect(suggestion).toMatchObject({ category: 'Accesorio', subcategory: '' })
    expect(suggestion.unknownAttributes).toContain('subcategory')
  })

  it('rejects invalid predictions instead of simulating a result', async () => {
    const image = new Blob(['image'], { type: 'image/jpeg' })
    const normalize = async () => ({ blob: image, pixels: makePixels() })

    await expect(analyzeGarmentImage(image, async () => result({}), normalize)).rejects.toThrow('puntuaciones o etiquetas no válidas')
    await expect(analyzeGarmentImage(image, async () => result({ category: { top: 1.5 } }), normalize))
      .rejects.toThrow('puntuaciones o etiquetas no válidas')
    await expect(analyzeGarmentImage(image, async () => result({ category: { kimono: 1 } }), normalize))
      .rejects.toThrow('etiqueta no reconocida')
  })
})
