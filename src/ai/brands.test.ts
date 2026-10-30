import { describe, expect, it } from 'vitest'
import { findBrand, normalizeText } from './brands'

const line = (text: string, score = 0.95) => ({ text, score })

describe('brand matching', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeText("Levi's® Strauss & Co.")).toBe('LEVIS STRAUSS & CO')
    expect(normalizeText('Pull&Bear')).toBe('PULL&BEAR')
  })

  it('finds brands as words, spaced-out logos and aliases', () => {
    expect(findBrand([line('NIKE')])).toMatchObject({ brand: 'Nike' })
    expect(findBrand([line('Made by NEW BALANCE')])).toMatchObject({ brand: 'New Balance' })
    expect(findBrand([line('a d i d a s')])).toMatchObject({ brand: 'Adidas' })
    expect(findBrand([line('ALL STAR')])).toMatchObject({ brand: 'Converse' })
    expect(findBrand([line('crocs')])).toMatchObject({ brand: 'Crocs' })
    expect(findBrand([line('Pull & Bear')])).toMatchObject({ brand: 'Pull&Bear' })
  })

  it('tolerates one misread letter only in long names', () => {
    expect(findBrand([line('SKECHFRS')])).toMatchObject({ brand: 'Skechers' })
    expect(findBrand([line('NIKF')])).toBeUndefined()
  })

  it('needs common words to be the whole line', () => {
    expect(findBrand([line('MANGO')])).toMatchObject({ brand: 'Mango' })
    expect(findBrand([line('zumo de mango natural')])).toBeUndefined()
    expect(findBrand([line('GAP')])).toMatchObject({ brand: 'Gap' })
    expect(findBrand([line('MIND THE GAP')])).toBeUndefined()
  })

  it('weighs the reader confidence and keeps the best line', () => {
    expect(findBrand([line('NIKE', 0.3)])).toBeUndefined()
    expect(findBrand([line('PUMA', 0.7), line('REEBOK', 0.99), line('size 42')])).toMatchObject({ brand: 'Reebok', text: 'REEBOK' })
  })
})
