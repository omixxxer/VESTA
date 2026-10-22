import { describe, expect, it } from 'vitest'
import { decodeHeads, pixelsToTensor, softmax, type VestaModelMeta } from './vestaClassifier'

const meta: VestaModelMeta = {
  name: 'vesta-garment-classifier',
  modelVersion: 'test-1',
  taxonomyVersion: '0.1.0',
  input: { name: 'pixel_values', size: 2, resize: 'direct-squash', mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], channelOrder: 'RGB' },
  heads: {
    category: {
      output: 'logits_category',
      classes: ['top', 'footwear'],
      labelsEs: ['Parte superior', 'Calzado'],
      appCategories: ['Parte superior', 'Calzado']
    },
    subtype: {
      output: 'logits_subtype',
      classes: ['shirt_blouse', 'shoe', 'pants'],
      labelsEs: ['Camisa / blusa', 'Calzado', 'Pantalón'],
      appCategories: ['Parte superior', 'Calzado', 'Parte inferior']
    }
  }
}

describe('vesta classifier adapter', () => {
  it('computes a stable softmax and rejects invalid logits', () => {
    const probabilities = softmax([1000, 1000, 0])
    expect(probabilities[0]).toBeCloseTo(0.5)
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(() => softmax([1, Number.NaN])).toThrow()
    expect(() => softmax([])).toThrow()
  })

  it('builds a CHW normalized tensor like the training pipeline', () => {
    // 2x2 RGBA: píxeles (255,0,0) (0,255,0) (0,0,255) (255,255,255)
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    const tensor = pixelsToTensor(rgba, 2, meta.input.mean, meta.input.std)
    expect(Array.from(tensor.slice(0, 4))).toEqual([1, -1, -1, 1]) // canal R
    expect(Array.from(tensor.slice(4, 8))).toEqual([-1, 1, -1, 1]) // canal G
    expect(Array.from(tensor.slice(8, 12))).toEqual([-1, -1, 1, 1]) // canal B
    expect(() => pixelsToTensor(new Uint8ClampedArray(4), 2, meta.input.mean, meta.input.std)).toThrow()
  })

  it('decodes heads sorted by score and derives the app category from the subtype', () => {
    const prediction = decodeHeads(
      { logits_category: [0.1, 0.2], logits_subtype: [0, 0.5, 3] },
      meta
    )
    expect(prediction.heads.subtype?.[0]).toMatchObject({ value: 'pants', label: 'Pantalón' })
    expect(prediction.category).toBe('Parte inferior') // el subtipo manda sobre la cabeza 'category'
    expect(prediction.heads.subtype).toHaveLength(3)
    expect(prediction.modelVersion).toBe('test-1')
  })

  it('falls back to the category head and validates output shapes', () => {
    const onlyCategory: VestaModelMeta = { ...meta, heads: { category: meta.heads.category! } }
    expect(decodeHeads({ logits_category: [0, 5] }, onlyCategory).category).toBe('Calzado')
    expect(() => decodeHeads({ logits_category: [0, 5, 1] }, onlyCategory)).toThrow(/esperaban 2/)
    expect(() => decodeHeads({}, onlyCategory)).toThrow(/Falta la salida/)
  })
})
