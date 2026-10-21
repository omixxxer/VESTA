import type { Garment, Outfit, OutfitFeedback, OutfitFeedbackType, UserPreferences } from '../types/domain'

export type OutfitTemplate = 'Casual' | 'Smart casual' | 'Formal' | 'Deportivo' | 'Frío y capas' | 'Calor y pocas capas'

export interface OutfitContext {
  occasion: string
  desiredStyle?: string
  temperatureCelsius?: number
  weatherConditions?: string[]
  includeGarmentIds?: string[]
  excludeGarmentIds?: string[]
  availableGarmentIds?: string[]
}

export interface OutfitCandidate {
  garments: Garment[]
  score: number
  scores: {
    occasion: number
    visualStyle: number
    thermal: number
    preference: number
    rotation: number
  }
  explanation: string[]
}

export interface OutfitGenerationOptions {
  preferences?: UserPreferences
  recentOutfits?: Outfit[]
  feedback?: OutfitFeedback[]
  limit?: number
}

export interface OutfitScoreWeights {
  occasion: number
  visualStyle: number
  thermal: number
  preference: number
  rotation: number
}

export const OUTFIT_SCORE_WEIGHTS: OutfitScoreWeights = {
  occasion: 0.28,
  visualStyle: 0.25,
  thermal: 0.2,
  preference: 0.15,
  rotation: 0.12
} as const

const TEMPLATE_FORMALITY: Record<OutfitTemplate, string | undefined> = {
  Casual: 'Casual',
  'Smart casual': 'Smart casual',
  Formal: 'Formal',
  Deportivo: undefined,
  'Frío y capas': undefined,
  'Calor y pocas capas': undefined
}

const MAX_PER_ROLE = 7
const MAX_CANDIDATE_COMBINATIONS = 1800
const MAX_RESULTS = 5
const NEUTRAL_COLORS = new Set(['negro', 'blanco', 'gris', 'beige', 'crema', 'marron', 'marrón', 'marino', 'camel'])

function normalize(value: string) {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function isAvailable(garment: Garment, context: OutfitContext) {
  if (garment.availability === 'laundry' || garment.availability === 'unavailable') return false
  return !context.availableGarmentIds || context.availableGarmentIds.includes(garment.id)
}

function isWarmOutfit(context: OutfitContext) {
  return context.occasion === 'Calor y pocas capas' || (context.temperatureCelsius !== undefined && context.temperatureCelsius >= 25)
}

function seasonForTemperature(temperature: number): Garment['seasons'][number] {
  if (temperature >= 25) return 'Verano'
  if (temperature <= 8) return 'Invierno'
  if (temperature < 16) return 'Otoño'
  return 'Primavera'
}

function colorCompatibility(garments: Garment[]) {
  const colors = garments.flatMap((garment) => garment.colors.map(normalize)).filter(Boolean)
  if (colors.length < 2) return 68
  let pairScore = 0
  let pairs = 0
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) {
      const first = colors[i]!
      const second = colors[j]!
      pairScore += first === second || NEUTRAL_COLORS.has(first) || NEUTRAL_COLORS.has(second) ? 92 : 62
      pairs += 1
    }
  }
  return pairs ? pairScore / pairs : 68
}

function styleCompatibility(garments: Garment[], desiredStyle?: string) {
  const styles = garments.flatMap((garment) => garment.styles.map(normalize))
  const definedStyles = [...new Set(styles)]
  let score = 72
  if (definedStyles.length > 1) {
    const shared = styles.length - definedStyles.length + 1
    score = shared > 1 ? 84 : 66
  }
  if (desiredStyle) {
    const target = normalize(desiredStyle)
    const known = garments.filter((garment) => garment.styles.length > 0)
    if (known.length) {
      const matches = known.filter((garment) => garment.styles.some((style) => normalize(style) === target)).length
      score = (score + matches / known.length * 100) / 2
    }
  }
  return score
}

function patternCompatibility(garments: Garment[]) {
  const patterns = garments.map((garment) => normalize(garment.pattern ?? '')).filter(Boolean)
  if (patterns.length < 2) return 68
  const distinctPatterns = new Set(patterns)
  return distinctPatterns.size === 1 ? 92 : 58
}

function occasionScore(garments: Garment[], context: OutfitContext) {
  const formalities = garments.map((garment) => garment.formality)
  const target = TEMPLATE_FORMALITY[context.occasion as OutfitTemplate]
  const formalFit = target && formalities.length
    ? formalities.reduce((sum, value) => sum + (value === target ? 100 : value === 'Smart casual' || target === 'Smart casual' ? 62 : 35), 0) / formalities.length
    : 72
  const occasionTerms = normalize(context.occasion)
  const styleMatches = garments.filter((garment) =>
    [...garment.styles, garment.subcategory, garment.name].some((value) => normalize(value).includes(occasionTerms))
  ).length
  return Math.min(100, formalFit * 0.8 + (styleMatches ? 20 : 14))
}

function thermalScore(garments: Garment[], context: OutfitContext) {
  const temperature = context.temperatureCelsius
  if (temperature === undefined) {
    const weatherSignals = (context.weatherConditions ?? []).map(normalize)
    const needsLayer = weatherSignals.some((condition) => condition.includes('viento') || condition.includes('frio'))
    return needsLayer ? (garments.some((garment) => garment.role === 'Capa') ? 84 : 52) : 68
  }
  const layers = garments.filter((garment) => garment.role === 'Capa').length
  let score = temperature <= 8 ? (layers ? 96 : 48)
    : temperature <= 16 ? (layers ? 82 : 70)
      : temperature >= 25 ? (layers ? 42 : 94)
        : (layers > 1 ? 65 : 86)
  const season = seasonForTemperature(temperature)
  const seasonal = garments.filter((garment) => garment.seasons.length > 0)
  if (seasonal.length) {
    const matching = seasonal.filter((garment) => garment.seasons.includes(season)).length
    score = score * 0.75 + matching / seasonal.length * 100 * 0.25
  }
  const weatherSignals = (context.weatherConditions ?? []).map(normalize)
  if (weatherSignals.some((condition) => condition.includes('viento') || condition.includes('frio'))) {
    score += garments.some((garment) => garment.role === 'Capa') ? 8 : -8
  }
  if (isWarmOutfit(context)) score -= layers * 12
  return Math.max(0, Math.min(100, score))
}

function feedbackPreference(garment: Garment, feedback: OutfitFeedback[]) {
  const relevant = feedback.filter((event) => event.garmentIds.includes(garment.id))
  const signals = relevant.reduce((total, event) => total + (
    event.type === 'like' || event.type === 'saved' || event.type === 'worn' || event.type === 'included' ? 1 :
      event.type === 'dislike' || event.type === 'excluded' ? -1 : 0
  ), 0)
  return Math.max(0, Math.min(100, 50 + signals * 12))
}

function preferenceScore(garments: Garment[], preferences?: UserPreferences, feedback: OutfitFeedback[] = []) {
  let score = garments.length ? garments.reduce((sum, garment) => sum + feedbackPreference(garment, feedback), 0) / garments.length : 50
  if (!preferences) return score
  for (const garment of garments) {
    if (preferences.preferredColors.length && garment.colors.length) {
      const colorMatch = garment.colors.some((color) => preferences.preferredColors.some((preferred) => normalize(color) === normalize(preferred)))
      score += colorMatch ? 5 : -2
    }
    if (preferences.preferredStyles.length && garment.styles.length) {
      const styleMatch = garment.styles.some((style) => preferences.preferredStyles.some((preferred) => normalize(style) === normalize(preferred)))
      score += styleMatch ? 5 : -2
    }
    if (preferences.preferredFormality) score += garment.formality === preferences.preferredFormality ? 4 : -2
  }
  return Math.max(0, Math.min(100, score))
}

function rotationScore(garments: Garment[], recentOutfits: Outfit[] = []) {
  if (!recentOutfits.length) return 82
  const ids = new Set(garments.map((garment) => garment.id))
  const recent = recentOutfits.slice(0, 12)
  const mostRecentMatch = recent.findIndex((outfit) =>
    outfit.garmentIds.length === ids.size && outfit.garmentIds.every((id) => ids.has(id))
  )
  const repetitionPenalty = mostRecentMatch === 0 ? 65 : mostRecentMatch > 0 ? Math.max(0, 42 - mostRecentMatch * 4) : 0
  const usageCount = recent.reduce((count, outfit) => count + outfit.garmentIds.filter((id) => ids.has(id)).length, 0)
  const usagePenalty = Math.min(20, usageCount / Math.max(1, garments.length) * 2)
  return Math.max(0, 92 - repetitionPenalty - usagePenalty)
}

function scoreCandidate(garments: Garment[], context: OutfitContext, options: OutfitGenerationOptions): OutfitCandidate {
  const scores = {
    occasion: occasionScore(garments, context),
    visualStyle: (colorCompatibility(garments) + styleCompatibility(garments, context.desiredStyle) + patternCompatibility(garments)) / 3,
    thermal: thermalScore(garments, context),
    preference: preferenceScore(garments, options.preferences, options.feedback),
    rotation: rotationScore(garments, options.recentOutfits)
  }
  const score = Math.round(Object.entries(OUTFIT_SCORE_WEIGHTS).reduce(
    (total, [key, weight]) => total + scores[key as keyof typeof scores] * weight, 0
  ) * 10) / 10
  const weatherExplanation = context.temperatureCelsius !== undefined
    ? `${context.temperatureCelsius} °C`
    : context.weatherConditions?.length ? `condiciones: ${context.weatherConditions.join(', ')}` : 'sin datos meteorológicos'
  const explanation = [
    `${context.occasion}: ${Math.round(scores.occasion)}/100`,
    context.desiredStyle ? `estilo ${context.desiredStyle}` : 'estilo equilibrado',
    weatherExplanation,
    scores.rotation < 70 ? 'prioriza la rotación de prendas' : ''
  ].filter(Boolean)
  return { garments, score, scores, explanation }
}

function capped(items: Garment[], pinnedIds: Set<string>) {
  const sorted = [...items].sort((a, b) => Number(pinnedIds.has(b.id)) - Number(pinnedIds.has(a.id)) || a.id.localeCompare(b.id))
  return sorted.slice(0, Math.max(MAX_PER_ROLE, sorted.filter((item) => pinnedIds.has(item.id)).length))
}

export function generateOutfitCandidates(
  allGarments: Garment[],
  context: OutfitContext,
  options: OutfitGenerationOptions = {}
): OutfitCandidate[] {
  const excludedIds = new Set(context.excludeGarmentIds ?? [])
  const includedIds = new Set(context.includeGarmentIds ?? [])
  if ([...includedIds].some((id) => excludedIds.has(id))) return []
  const garments = allGarments.filter((garment) => !excludedIds.has(garment.id) && isAvailable(garment, context))
  if ([...includedIds].some((id) => !garments.some((garment) => garment.id === id))) return []

  const pinned = (role: Garment['role']) => new Set(
    garments.filter((garment) => garment.role === role && includedIds.has(garment.id)).map((garment) => garment.id)
  )
  const byRole = (role: Garment['role']) => capped(garments.filter((garment) => garment.role === role), pinned(role))
  const tops = byRole('Top')
  const bottoms = byRole('Bottom')
  const onePieces = byRole('Una pieza')
  const layers = byRole('Capa')
  const shoes = byRole('Calzado')
  const accessories = byRole('Accesorio')
  const hasPinnedRole = (role: Garment['role']) => garments.some((garment) => includedIds.has(garment.id) && garment.role === role)
  const candidates: OutfitCandidate[] = []
  const seen = new Set<string>()
  let checked = 0

  const add = (base: Garment[], layer?: Garment, shoe?: Garment, accessory?: Garment) => {
    if (checked >= MAX_CANDIDATE_COMBINATIONS) return
    checked += 1
    const selected = [...base, layer, shoe, accessory].filter((item): item is Garment => Boolean(item))
    if (context.occasion === 'Formal' && selected.some((item) => item.formality !== 'Formal')) return
    if ((isWarmOutfit(context) || context.occasion === 'Calor y pocas capas') && selected.some((item) => item.role === 'Capa')) return
    if ([...includedIds].some((id) => !selected.some((garment) => garment.id === id))) return
    const key = selected.map((garment) => garment.id).sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(scoreCandidate(selected, context, options))
  }

  const optional = (base: Garment[]) => {
    const needsLayer = context.occasion === 'Frío y capas' || (context.temperatureCelsius !== undefined && context.temperatureCelsius <= 8)
    const layerOptions: Array<Garment | undefined> = hasPinnedRole('Capa')
      ? layers.filter((layer) => includedIds.has(layer.id))
      : needsLayer ? layers.slice(0, 4)
        : isWarmOutfit(context) || context.occasion === 'Calor y pocas capas' ? [undefined] : [undefined, ...layers.slice(0, 4)]
    const shoeOptions: Array<Garment | undefined> = hasPinnedRole('Calzado')
      ? shoes.filter((shoe) => includedIds.has(shoe.id))
      : [undefined, ...shoes.slice(0, 4)]
    const accessoryOptions: Array<Garment | undefined> = hasPinnedRole('Accesorio')
      ? accessories.filter((item) => includedIds.has(item.id))
      : [undefined, ...accessories.slice(0, 3)]
    for (const layer of layerOptions) {
      for (const shoe of shoeOptions) {
        for (const accessory of accessoryOptions) add(base, layer, shoe, accessory)
      }
    }
  }

  const requiresOnePiece = hasPinnedRole('Una pieza') && (hasPinnedRole('Top') || hasPinnedRole('Bottom'))
  if (!requiresOnePiece) {
    for (const top of tops) {
      for (const bottom of bottoms) {
        optional([top, bottom])
        if (checked >= MAX_CANDIDATE_COMBINATIONS) break
      }
      if (checked >= MAX_CANDIDATE_COMBINATIONS) break
    }
  }
  if (!hasPinnedRole('Top') && !hasPinnedRole('Bottom')) {
    for (const onePiece of onePieces) {
      optional([onePiece])
      if (checked >= MAX_CANDIDATE_COMBINATIONS) break
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.garments.map((item) => item.id).join().localeCompare(b.garments.map((item) => item.id).join()))
    .slice(0, Math.max(1, Math.min(options.limit ?? MAX_RESULTS, MAX_RESULTS)))
}

export function createOutfitRecord(candidate: OutfitCandidate, context: OutfitContext, now = new Date().toISOString()): Outfit {
  return {
    id: crypto.randomUUID(),
    garmentIds: candidate.garments.map((garment) => garment.id),
    occasion: context.occasion,
    weather: context.temperatureCelsius === undefined && !context.weatherConditions?.length
      ? undefined
      : { temperatureCelsius: context.temperatureCelsius, conditions: context.weatherConditions },
    score: candidate.score,
    createdAt: now,
    favorite: false
  }
}

export function createOutfitFeedback(
  type: OutfitFeedbackType,
  garmentIds: string[],
  outfitId?: string,
  now = new Date().toISOString()
): OutfitFeedback {
  return { id: crypto.randomUUID(), type, garmentIds: [...new Set(garmentIds)], outfitId, createdAt: now }
}
