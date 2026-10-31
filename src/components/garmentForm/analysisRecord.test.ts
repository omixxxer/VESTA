import { describe, expect, it } from 'vitest'
import type { ClothingAnalysisSuggestion } from '../../ai/clothingAnalyzer'
import type { Garment } from '../../types/domain'
import { analysisRecord, type SavedValues } from './analysisRecord'

const suggestion: ClothingAnalysisSuggestion = {
  category: 'Parte superior',
  subcategory: 'Camiseta',
  colors: ['Blanco'],
  pattern: { value: 'liso', label: 'Liso', score: 0.9 },
  brand: { brand: 'Nike', score: 0.9, text: 'NIKE' },
  alternatives: [],
  confidenceByAttribute: { category: 0.9 },
  unknownAttributes: [],
  modelId: 'vesta',
  modelVersion: 'heads-v4',
  calibrated: true,
  analyzedAt: '2026-10-31T00:00:00.000Z'
}

const values: SavedValues = { category: 'Parte superior', subcategory: 'Camiseta', colors: ['blanco'], pattern: 'Liso', brand: 'Nike', size: '', composition: '' }

describe('analysis record', () => {
  it('records the sources and only the attributes the user changed', () => {
    const record = analysisRecord({
      suggestion,
      labelReading: { lines: [], brand: { brand: 'Zara', score: 1, text: 'ZARA' }, composition: { value: '100 % algodón', text: '100% COTTON', score: 1 } },
      labelSize: { value: 'M', text: 'M', score: 1 },
      imageChanged: true,
      garment: undefined,
      values: { ...values, subcategory: 'Polo', brand: 'Zara', size: 'L', composition: '100 % algodón' }
    })
    expect(record).toMatchObject({
      calibrated: true,
      suggestions: { brand: 'Zara', size: 'M', composition: '100 % algodón' }, // the label wins over the photo
      sourcesByAttribute: { category: 'vesta-dinov2', brand: 'paddle-ocr', size: 'paddle-ocr', colors: 'local-pixels' },
      correctedAttributes: ['subcategory', 'size'] // colours compare without case
    })
  })

  it('keeps the earlier analysis of an edited garment whose photos did not change', () => {
    const garment = { analysis: { ...analysisRecord({ suggestion, labelReading: undefined, labelSize: undefined, imageChanged: true, garment: undefined, values })! } } as Garment
    expect(garment.analysis?.correctedAttributes).toEqual([])
    const edited = analysisRecord({ suggestion: undefined, labelReading: undefined, labelSize: undefined, imageChanged: false, garment, values: { ...values, pattern: 'Rayas' } })
    expect(edited).toMatchObject({ modelVersion: 'heads-v4', correctedAttributes: ['pattern'] })
    expect(analysisRecord({ suggestion: undefined, labelReading: undefined, labelSize: undefined, imageChanged: true, garment, values })).toBeUndefined()
  })
})
