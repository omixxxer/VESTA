import { describe, expect, it } from 'vitest'
import type { Garment, Outfit } from '../types/domain'
import { generateOutfitCandidates } from './outfitGenerator'

const garment = (id: string, role: Garment['role'], extras: Partial<Garment> = {}): Garment => ({
  id,
  name: id,
  category: role === 'Top' ? 'Parte superior' : role === 'Bottom' ? 'Parte inferior' : role === 'Capa' ? 'Abrigo' : role === 'Calzado' ? 'Calzado' : role === 'Una pieza' ? 'Vestido / mono' : 'Accesorio',
  subcategory: '',
  colors: [],
  seasons: [],
  styles: [],
  formality: 'Casual',
  role,
  image: new Blob(['photo']),
  thumbnail: new Blob(['thumbnail']),
  width: 100,
  height: 100,
  confirmedAttributes: [],
  suggestedAttributes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extras
})

const basicWardrobe = () => [
  garment('top', 'Top'),
  garment('bottom', 'Bottom'),
  garment('coat', 'Capa'),
  garment('shoe', 'Calzado')
]

describe('outfit generator', () => {
  it('builds candidates only from actual available wardrobe records', () => {
    const wardrobe = basicWardrobe()
    const results = generateOutfitCandidates(wardrobe, { occasion: 'Casual' })

    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.garments).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'Top' }),
        expect.objectContaining({ role: 'Bottom' })
      ]))
      expect(result.garments.every((item) => wardrobe.some((stored) => stored.id === item.id))).toBe(true)
    }
  })

  it('enforces included, excluded, laundry and cold-layer constraints before scoring', () => {
    const wardrobe = [
      ...basicWardrobe(),
      garment('laundry-top', 'Top', { availability: 'laundry' })
    ]
    const results = generateOutfitCandidates(wardrobe, {
      occasion: 'Frío y capas',
      temperatureCelsius: 4,
      includeGarmentIds: ['top'],
      excludeGarmentIds: ['shoe']
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results.every((result) => result.garments.some((item) => item.id === 'top'))).toBe(true)
    expect(results.every((result) => result.garments.some((item) => item.role === 'Capa'))).toBe(true)
    expect(results.every((result) => result.garments.every((item) => item.id !== 'shoe' && item.id !== 'laundry-top'))).toBe(true)
    expect(generateOutfitCandidates(wardrobe.filter((item) => item.role !== 'Capa'), { occasion: 'Frío y capas' })).toEqual([])
  })

  it('allows unknown visual and seasonal attributes without arbitrary rejection', () => {
    const results = generateOutfitCandidates([
      garment('unknown-top', 'Top'),
      garment('unknown-bottom', 'Bottom')
    ], { occasion: 'Casual' })
    expect(results).toHaveLength(1)
    expect(results[0]?.score).toBeGreaterThanOrEqual(0)
    expect(results[0]?.score).toBeLessThanOrEqual(100)
  })

  it('responds to occasion, weather and personal preferences', () => {
    const wardrobe = [
      garment('top', 'Top', { colors: ['Azul'], styles: ['Minimalista'], formality: 'Formal', seasons: ['Invierno'] }),
      garment('bottom', 'Bottom', { colors: ['Negro'], styles: ['Minimalista'], formality: 'Formal', seasons: ['Invierno'] }),
      garment('coat', 'Capa', { colors: ['Negro'], seasons: ['Invierno'], formality: 'Formal' })
    ]
    const base = generateOutfitCandidates(wardrobe, { occasion: 'Casual' })[0]
    const coldFormal = generateOutfitCandidates(wardrobe, { occasion: 'Formal', temperatureCelsius: 2 })[0]
    const personalized = generateOutfitCandidates(wardrobe, { occasion: 'Formal', temperatureCelsius: 2 }, {
      preferences: {
        id: 'current',
        preferredColors: ['Azul'],
        preferredStyles: ['Minimalista'],
        preferredFormality: 'Formal',
        feedbackWeights: {},
        updatedAt: ''
      }
    })[0]

    expect(coldFormal?.score).not.toBe(base?.score)
    expect(personalized?.scores.preference).toBeGreaterThan(coldFormal?.scores.preference ?? 0)
  })

  it('lowers a recent exact repeat score without permanently excluding garments', () => {
    const wardrobe = [garment('top', 'Top'), garment('bottom', 'Bottom')]
    const outfit: Outfit = {
      id: 'recent',
      garmentIds: ['top', 'bottom'],
      occasion: 'Casual',
      score: 80,
      createdAt: '2026-01-02T00:00:00.000Z',
      favorite: true
    }
    const first = generateOutfitCandidates(wardrobe, { occasion: 'Casual' })[0]
    const repeated = generateOutfitCandidates(wardrobe, { occasion: 'Casual' }, { recentOutfits: [outfit] })[0]
    expect(repeated?.scores.rotation).toBeLessThan(first?.scores.rotation ?? 0)
    expect(repeated?.garments.map((item) => item.id).sort()).toEqual(['bottom', 'top'])
  })

  it('applies recorded likes and dislikes to future preference scores', () => {
    const wardrobe = [garment('top', 'Top'), garment('bottom', 'Bottom')]
    const base = generateOutfitCandidates(wardrobe, { occasion: 'Casual' })[0]
    const liked = generateOutfitCandidates(wardrobe, { occasion: 'Casual' }, {
      feedback: [{ id: 'like', type: 'like', garmentIds: ['top'], createdAt: '2026-01-02T00:00:00.000Z' }]
    })[0]
    const disliked = generateOutfitCandidates(wardrobe, { occasion: 'Casual' }, {
      feedback: [{ id: 'dislike', type: 'dislike', garmentIds: ['top'], createdAt: '2026-01-02T00:00:00.000Z' }]
    })[0]

    expect(liked?.score).toBeGreaterThan(base?.score ?? 0)
    expect(disliked?.score).toBeLessThan(base?.score ?? 0)
  })

  it('returns no candidates when the wardrobe lacks the required base garments', () => {
    expect(generateOutfitCandidates([garment('shoe', 'Calzado')], { occasion: 'Casual' })).toEqual([])
    expect(generateOutfitCandidates([], { occasion: 'Casual' })).toEqual([])
  })

  it('does not accept casual garments for formal outfits or layers in hot-weather outfits', () => {
    const casualWardrobe = basicWardrobe()
    expect(generateOutfitCandidates(casualWardrobe, { occasion: 'Formal' })).toEqual([])
    const hotWeather = generateOutfitCandidates(casualWardrobe, { occasion: 'Calor y pocas capas' })
    expect(hotWeather.every((result) => result.garments.every((item) => item.role !== 'Capa'))).toBe(true)
  })

  it('uses known wind or cold conditions for thermal fit without inventing item properties', () => {
    const wardrobe = [garment('top', 'Top'), garment('bottom', 'Bottom'), garment('coat', 'Capa')]
    const mild = generateOutfitCandidates(wardrobe, { occasion: 'Casual' })[0]
    const windy = generateOutfitCandidates(wardrobe, { occasion: 'Casual', weatherConditions: ['viento'] })[0]
    expect(windy?.scores.thermal).toBeGreaterThan(mild?.scores.thermal ?? 0)
  })

  it('treats matching and conflicting known patterns differently from unknown patterns', () => {
    const unknown = [garment('top', 'Top'), garment('bottom', 'Bottom')]
    const matching = [garment('top', 'Top', { pattern: 'Rayas' }), garment('bottom', 'Bottom', { pattern: 'Rayas' })]
    const conflicting = [garment('top', 'Top', { pattern: 'Rayas' }), garment('bottom', 'Bottom', { pattern: 'Cuadros' })]
    const unknownScore = generateOutfitCandidates(unknown, { occasion: 'Casual' })[0]?.scores.visualStyle ?? 0
    const matchingScore = generateOutfitCandidates(matching, { occasion: 'Casual' })[0]?.scores.visualStyle ?? 0
    const conflictingScore = generateOutfitCandidates(conflicting, { occasion: 'Casual' })[0]?.scores.visualStyle ?? 0
    expect(matchingScore).toBeGreaterThan(unknownScore)
    expect(conflictingScore).toBeLessThan(unknownScore)
  })
})
