import { categoryIdForLabel, matchLabel } from '../ml/taxonomy'
import type { DressLevel, GarmentCategory, Season } from '../types/domain'

// Seasons, dress levels and aesthetic suggested from what the garment is: the model does not predict them, but the type
// says a lot (a down jacket is for winter, a blazer is not sportswear). They feed the outfit generator, so a garment
// is useful there without the user filling the «Uso» section; the user can always change them.

const ALL: Season[] = ['Primavera', 'Verano', 'Otoño', 'Invierno']
const WARM: Season[] = ['Primavera', 'Verano']
const COLD: Season[] = ['Otoño', 'Invierno']
const MILD_AND_COLD: Season[] = ['Primavera', 'Otoño', 'Invierno']
const MILD: Season[] = ['Primavera', 'Otoño']

const seasonsBySubcategory: Record<string, Season[]> = {
  'camiseta-manga-larga': MILD_AND_COLD,
  'camiseta-tirantes': WARM,
  polo: ['Primavera', 'Verano', 'Otoño'],
  top: WARM,
  jersey: COLD,
  sudadera: MILD_AND_COLD,
  'sudadera-capucha': MILD_AND_COLD,
  'pantalon-corto': WARM,
  'pantalon-chandal': MILD_AND_COLD,
  falda: ['Primavera', 'Verano', 'Otoño'],
  medias: COLD,
  chaqueta: MILD,
  blazer: MILD_AND_COLD,
  abrigo: COLD,
  plumifero: COLD,
  chubasquero: MILD,
  cardigan: MILD_AND_COLD,
  chaleco: MILD,
  botas: COLD,
  sandalias: WARM,
  chanclas: ['Verano'],
  zuecos: WARM,
  gorro: COLD,
  bufanda: COLD
}

// Dress levels each type suits, as a range: a white shirt goes from everyday to formal, a tracksuit is for sport.
const SPORT: DressLevel[] = ['Deportivo']
const SPORT_AND_DAILY: DressLevel[] = ['Deportivo', 'Diario']
const DAILY: DressLevel[] = ['Diario']
const DAILY_TO_SMART: DressLevel[] = ['Diario', 'Arreglado']
const DAILY_TO_FORMAL: DressLevel[] = ['Diario', 'Arreglado', 'Formal']
const SMART_TO_FORMAL: DressLevel[] = ['Arreglado', 'Formal']

const levelsBySubcategory: Record<string, DressLevel[]> = {
  'prenda-deportiva': SPORT,
  'pantalon-chandal': SPORT_AND_DAILY,
  leggings: SPORT_AND_DAILY,
  zapatillas: SPORT_AND_DAILY,
  chubasquero: SPORT_AND_DAILY,
  camisa: DAILY_TO_FORMAL,
  blusa: DAILY_TO_SMART,
  polo: DAILY_TO_SMART,
  jersey: DAILY_TO_SMART,
  cardigan: DAILY_TO_SMART,
  vaqueros: DAILY_TO_SMART,
  pantalon: DAILY_TO_SMART,
  falda: DAILY_TO_SMART,
  vestido: DAILY_TO_FORMAL,
  mono: DAILY_TO_SMART,
  chaqueta: DAILY_TO_SMART,
  chaleco: DAILY_TO_SMART,
  abrigo: DAILY_TO_FORMAL,
  blazer: SMART_TO_FORMAL,
  corbata: SMART_TO_FORMAL,
  zapatos: SMART_TO_FORMAL,
  tacones: SMART_TO_FORMAL,
  botas: DAILY_TO_SMART,
  medias: DAILY_TO_FORMAL,
  bufanda: DAILY_TO_SMART,
  cinturon: DAILY_TO_FORMAL,
  reloj: DAILY_TO_FORMAL,
  bolso: DAILY_TO_FORMAL
}

// Aesthetic («Estética»), only where the type clearly implies one; most garments are left without it.
const stylesBySubcategory: Record<string, string[]> = {
  sudadera: ['Urbano'],
  'sudadera-capucha': ['Urbano'],
  zapatillas: ['Urbano'],
  blazer: ['Clásico'],
  camisa: ['Clásico'],
  zapatos: ['Clásico'],
  corbata: ['Clásico']
}

const warmFibres = /lana|cachemir|cashmere|alpaca|mohair|angora|plum[oó]n/
const coolFibres = /lino/

export interface UsageSuggestion {
  seasons: Season[]
  dressLevels: DressLevel[]
  styles: string[]
}

export interface UsageInput {
  category: GarmentCategory
  subcategory: string
  /** Sleeve id predicted by the model (sin-mangas, corta, tres-cuartos, larga), if any. */
  sleeve?: string
  composition?: string
}

function narrow(seasons: Season[], keep: (season: Season) => boolean): Season[] {
  const kept = seasons.filter(keep)
  return kept.length ? kept : seasons
}

export function suggestUsage({ category, subcategory, sleeve, composition }: UsageInput): UsageSuggestion {
  const id = matchLabel('subcategory', subcategory) ?? ''
  let seasons = seasonsBySubcategory[id] ?? ALL
  const categoryId = categoryIdForLabel(category)
  if (categoryId === 'top' || categoryId === 'one-piece') {
    // A short-sleeved shirt or dress is for warm weather; a long-sleeved dress is not for summer.
    if (sleeve === 'corta' || sleeve === 'sin-mangas') seasons = narrow(seasons, (season) => WARM.includes(season))
    else if (sleeve === 'larga' && categoryId === 'one-piece') seasons = narrow(seasons, (season) => season !== 'Verano')
  }
  const fibres = (composition ?? '').toLocaleLowerCase('es')
  if (warmFibres.test(fibres)) seasons = narrow(seasons, (season) => season !== 'Verano')
  if (coolFibres.test(fibres)) seasons = narrow(seasons, (season) => season !== 'Invierno')
  return {
    seasons: ALL.filter((season) => seasons.includes(season)),
    dressLevels: levelsBySubcategory[id] ?? DAILY,
    styles: stylesBySubcategory[id] ?? []
  }
}
