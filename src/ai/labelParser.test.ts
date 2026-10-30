import { describe, expect, it } from 'vitest'
import { findComposition, findSize } from './labelParser'

const line = (text: string, score = 0.95) => ({ text, score })

describe('size from a label', () => {
  it('reads letter sizes alone or next to a size word', () => {
    expect(findSize([line('M')])?.value).toBe('M')
    expect(findSize([line('Talla: XL')])?.value).toBe('XL')
    expect(findSize([line('SIZE xs')])?.value).toBe('XS')
  })

  it('ignores stray letters and numbers without a size context', () => {
    expect(findSize([line('S', 0.5)])).toBeUndefined()
    expect(findSize([line('MADE IN PORTUGAL')])).toBeUndefined()
    expect(findSize([line('RN 52469'), line('100% COTTON'), line('42')])).toBeUndefined()
  })

  it('reads European numbers and jeans sizes', () => {
    expect(findSize([line('EUR 42')])?.value).toBe('42')
    expect(findSize([line('T. 38')])?.value).toBe('38')
    expect(findSize([line('W32 L34')], 'bottom')?.value).toBe('W32 L34')
    expect(findSize([line('EU 42.5 UK 8 US 9')], 'footwear')?.value).toBe('42,5')
  })

  it('prefers the letter for tops and the number for footwear and bottoms', () => {
    const label = [line('M'), line('EUR 40'), line('US 8')]
    expect(findSize(label, 'top')).toMatchObject({ value: 'M', text: 'M' })
    expect(findSize(label, 'bottom')).toMatchObject({ value: '40', text: 'EUR 40' })
    expect(findSize(label, 'footwear')?.value).toBe('40')
    expect(findSize([line('M')], 'footwear')).toBeUndefined() // a shoe size is a number
  })
})

describe('composition from a label', () => {
  it('reads fibres in either order and translates them', () => {
    expect(findComposition([line('95% COTTON 5% ELASTANE')])?.value).toBe('95 % algodón, 5 % elastano')
    expect(findComposition([line('ALGODÓN 100%')])?.value).toBe('100 % algodón')
    expect(findComposition([line('80 % laine'), line('20% polyamide')])?.value).toBe('80 % lana, 20 % poliamida')
  })

  it('skips the same composition repeated in other languages and a second section', () => {
    const label = [line('100% ALGODÓN'), line('100% COTTON'), line('100% COTON'), line('FORRO 100% POLIESTER')]
    expect(findComposition(label)).toMatchObject({ value: '100 % algodón', text: '100% ALGODÓN' })
  })

  it('needs percentages close to 100 and readable text', () => {
    expect(findComposition([line('50% COTTON')])).toBeUndefined()
    expect(findComposition([line('100% COTTON', 0.4)])).toBeUndefined()
    expect(findComposition([line('100% ORGANIC')])).toBeUndefined()
  })
})
