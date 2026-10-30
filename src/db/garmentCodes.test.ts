import { describe, expect, it } from 'vitest'
import { assignMissingCodes, codeCounters, codePrefix, nextCode } from './garmentCodes'

describe('garment codes', () => {
  it('takes the prefix from the subcategory, then the category', () => {
    expect(codePrefix({ category: 'Parte superior', subcategory: 'Sudadera' })).toBe('SUD')
    expect(codePrefix({ category: 'Parte superior', subcategory: 'Sudadera con capucha' })).toBe('SDC')
    expect(codePrefix({ category: 'Parte inferior', subcategory: 'jeans' })).toBe('VAQ') // synonyms count
    expect(codePrefix({ category: 'Calzado', subcategory: '' })).toBe('CAL')
    expect(codePrefix({ category: 'Accesorio', subcategory: 'Llavero' })).toBe('ACC')
  })

  it('numbers after the highest code and the stored counter', () => {
    expect(nextCode('SUD', [])).toBe('SUD-001')
    expect(nextCode('SUD', ['SUD-001', 'SUD-004', 'CAM-009'])).toBe('SUD-005')
    expect(nextCode('SUD', ['SUD-001'], 7)).toBe('SUD-008')
    expect(nextCode('SUD', ['SUD-999'])).toBe('SUD-1000')
  })

  it('gives existing garments codes by creation date when upgrading', () => {
    const codes = assignMissingCodes([
      { id: 'late', category: 'Parte superior', subcategory: 'Sudadera', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: 'early', category: 'Parte superior', subcategory: 'Sudadera', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'coded', category: 'Parte superior', subcategory: 'Sudadera', createdAt: '2026-02-01T00:00:00.000Z', code: 'SUD-001' },
      { id: 'shoe', category: 'Calzado', subcategory: 'Botas', createdAt: '2026-01-05T00:00:00.000Z' }
    ])
    expect(Object.fromEntries(codes)).toEqual({ early: 'SUD-002', late: 'SUD-003', shoe: 'BOT-001' })
    expect(codeCounters(codes.values())).toEqual(expect.arrayContaining([{ prefix: 'SUD', last: 3 }, { prefix: 'BOT', last: 1 }]))
  })
})
