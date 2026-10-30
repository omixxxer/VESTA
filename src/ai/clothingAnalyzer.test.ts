import { describe, expect, it, vi } from 'vitest'
import {
  analyzeGarmentImage,
  attributeApplies,
  CLOTHING_MODEL_ID,
  findDominantColor,
  labelSize,
  readGarmentLabel,
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

const noText = async () => []

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

    const suggestion = await analyzeGarmentImage(image, classify, normalize, noText)

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

    const suggestion = await analyzeGarmentImage(images, classify, normalize, noText)

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
    }), normalize, noText)
    expect(suggestion).toMatchObject({ category: 'Accesorio', subcategory: '' })
    expect(suggestion.unknownAttributes).toContain('subcategory')
  })

  it('suggests a brand read in any photo and survives a text reader failure', async () => {
    const images = [new Blob(['side'], { type: 'image/jpeg' }), new Blob(['label'], { type: 'image/jpeg' })]
    const normalize = async () => ({ blob: new Blob(['normalized']), pixels: makePixels() })
    const read = vi.fn()
      .mockResolvedValueOnce([{ text: '42', score: 0.9 }])
      .mockResolvedValueOnce([{ text: 'N I K E', score: 0.9 }])
    const suggestion = await analyzeGarmentImage(images, async () => result(tee), normalize, read)
    expect(suggestion.brand).toMatchObject({ brand: 'Nike', text: 'N I K E' })
    expect(suggestion.unknownAttributes).not.toContain('brand')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = vi.fn(async () => { throw new Error('sin OCR') })
    const withoutText = await analyzeGarmentImage(images, async () => result(tee), normalize, failing)
    expect(withoutText).toMatchObject({ category: 'Parte superior', subcategory: 'Camiseta' })
    expect(withoutText.brand).toBeUndefined()
    expect(failing).toHaveBeenCalledTimes(1) // not retried for every photo
    warn.mockRestore()
  })

  it('reads the label photo apart, with only the text reader, and picks the size for the category', async () => {
    const normalize = vi.fn(async () => ({ blob: new Blob(['label']), pixels: makePixels() }))
    const read = vi.fn(async () => [
      { text: 'ZARA', score: 0.97 },
      { text: 'M', score: 0.95 },
      { text: 'EUR 40', score: 0.9 },
      { text: '95% COTTON 5% ELASTANE', score: 0.9 }
    ])
    const reading = await readGarmentLabel(new Blob(['label photo']), normalize, read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(reading).toMatchObject({ brand: { brand: 'Zara' }, composition: { value: '95 % algodón, 5 % elastano' } })
    expect(labelSize(reading, 'Parte superior')?.value).toBe('M')
    expect(labelSize(reading, 'Calzado')?.value).toBe('40')
    expect(labelSize(undefined, 'Calzado')).toBeUndefined()
  })

  it('rejects invalid predictions instead of simulating a result', async () => {
    const image = new Blob(['image'], { type: 'image/jpeg' })
    const normalize = async () => ({ blob: image, pixels: makePixels() })

    await expect(analyzeGarmentImage(image, async () => result({}), normalize, noText)).rejects.toThrow('puntuaciones o etiquetas no válidas')
    await expect(analyzeGarmentImage(image, async () => result({ category: { top: 1.5 } }), normalize, noText))
      .rejects.toThrow('puntuaciones o etiquetas no válidas')
    await expect(analyzeGarmentImage(image, async () => result({ category: { kimono: 1 } }), normalize, noText))
      .rejects.toThrow('etiqueta no reconocida')
  })
})
