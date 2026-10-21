export const garmentCategories = [
  'Parte superior',
  'Parte inferior',
  'Vestido / mono',
  'Abrigo',
  'Calzado',
  'Accesorio'
] as const

export type GarmentCategory = (typeof garmentCategories)[number]
export type Formality = 'Casual' | 'Smart casual' | 'Formal'
export type GarmentRole = 'Top' | 'Bottom' | 'Una pieza' | 'Capa' | 'Calzado' | 'Accesorio'
export type Season = 'Primavera' | 'Verano' | 'Otoño' | 'Invierno'

export interface GarmentAnalysis {
  modelId: string
  modelVersion: string
  analyzedAt: string
  suggestions: {
    category: GarmentCategory
    subcategory: string
    colors: string[]
  }
  confidenceByAttribute: Partial<Record<'category' | 'subcategory' | 'colors', number>>
  sourcesByAttribute: Partial<Record<'category' | 'subcategory' | 'colors', 'clip-zero-shot' | 'local-pixels'>>
  unknownAttributes: string[]
  correctedAttributes: string[]
}

export interface Garment {
  id: string
  name: string
  category: GarmentCategory
  subcategory: string
  colors: string[]
  brand?: string
  size?: string
  notes?: string
  seasons: Season[]
  styles: string[]
  formality: Formality
  role: GarmentRole
  image: Blob
  thumbnail: Blob
  width: number
  height: number
  confirmedAttributes: string[]
  suggestedAttributes: string[]
  analysis?: GarmentAnalysis
  createdAt: string
  updatedAt: string
}

export interface Outfit {
  id: string
  garmentIds: string[]
  occasion: string
  weather?: { temperatureCelsius: number }
  score: number
  createdAt: string
  favorite: boolean
  rating?: number
  wornAt?: string
}

export interface UserPreferences {
  id: 'current'
  preferredColors: string[]
  preferredStyles: string[]
  preferredFormality?: Formality
  feedbackWeights: Record<string, number>
  updatedAt: string
}

export interface TrendPack {
  id: string
  version: string
  publishedAt: string
  source: string
  categories: Array<{
    name: string
    rules: Array<{ attribute: string; value: string; weight: number }>
  }>
}
