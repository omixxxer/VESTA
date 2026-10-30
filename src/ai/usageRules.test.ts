import { describe, expect, it } from 'vitest'
import { suggestUsage } from './usageRules'

describe('usage rules', () => {
  it('suggests seasons, dress levels and aesthetic from the garment type', () => {
    expect(suggestUsage({ category: 'Abrigo', subcategory: 'Plumífero' })).toEqual({
      seasons: ['Otoño', 'Invierno'], dressLevels: ['Diario'], styles: []
    })
    expect(suggestUsage({ category: 'Abrigo', subcategory: 'Blazer' })).toMatchObject({ dressLevels: ['Arreglado', 'Formal'], styles: ['Clásico'] })
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Camisa' }).dressLevels).toEqual(['Diario', 'Arreglado', 'Formal'])
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Prenda deportiva' }).dressLevels).toEqual(['Deportivo'])
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Sudadera con capucha' })).toEqual({
      seasons: ['Primavera', 'Otoño', 'Invierno'], dressLevels: ['Diario'], styles: ['Urbano']
    })
    expect(suggestUsage({ category: 'Calzado', subcategory: 'Chanclas' }).seasons).toEqual(['Verano'])
    expect(suggestUsage({ category: 'Parte inferior', subcategory: '' })).toEqual({
      seasons: ['Primavera', 'Verano', 'Otoño', 'Invierno'], dressLevels: ['Diario'], styles: []
    })
  })

  it('narrows the seasons by sleeve and fibre', () => {
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Camisa', sleeve: 'corta' }).seasons).toEqual(['Primavera', 'Verano'])
    expect(suggestUsage({ category: 'Vestido / mono', subcategory: 'Vestido', sleeve: 'larga' }).seasons)
      .toEqual(['Primavera', 'Otoño', 'Invierno'])
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Camiseta', composition: '100 % lino' }).seasons)
      .toEqual(['Primavera', 'Verano', 'Otoño'])
    expect(suggestUsage({ category: 'Parte superior', subcategory: 'Jersey', composition: '80 % lana, 20 % poliamida' }).seasons)
      .toEqual(['Otoño', 'Invierno'])
    // Never left without a season: wool sandals keep theirs.
    expect(suggestUsage({ category: 'Calzado', subcategory: 'Chanclas', composition: 'lana' }).seasons).toEqual(['Verano'])
  })
})
