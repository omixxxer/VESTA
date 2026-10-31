import type { ClothingAnalysisSuggestion, LabelReading } from '../../ai/clothingAnalyzer'
import type { LabelValue } from '../../ai/labelParser'
import type { Garment, GarmentAnalysis, GarmentCategory } from '../../types/domain'

export interface SavedValues {
  category: GarmentCategory
  subcategory: string
  colors: string[]
  pattern: string
  brand: string
  size: string
  composition: string
}

interface AnalysisRecordInput {
  /** The analysis of the current photos, if any. */
  suggestion: ClothingAnalysisSuggestion | undefined
  labelReading: LabelReading | undefined
  /** Size read on the label for the current category. */
  labelSize: LabelValue | undefined
  /** The photos changed since the garment was saved, so an earlier analysis no longer describes them. */
  imageChanged: boolean
  garment: Garment | undefined
  values: SavedValues
}

/**
 * What is stored about the analysis: the model's suggestions, where each came from and which ones the user
 * corrected. A garment edited without new photos keeps its earlier analysis, with the corrections updated.
 */
export function analysisRecord({ suggestion, labelReading, labelSize, imageChanged, garment, values }: AnalysisRecordInput): GarmentAnalysis | undefined {
  const labelBrand = labelReading?.brand?.brand
  const previous = suggestion
    ? {
        category: suggestion.category,
        subcategory: suggestion.subcategory,
        colors: suggestion.colors,
        pattern: suggestion.pattern?.label,
        brand: labelBrand ?? suggestion.brand?.brand,
        size: labelSize?.value,
        composition: labelReading?.composition?.value
      }
    : !imageChanged ? garment?.analysis?.suggestions : undefined
  const correctedAttributes: string[] = []
  if (previous) {
    if (values.category !== previous.category) correctedAttributes.push('category')
    if (values.subcategory.trim() !== previous.subcategory) correctedAttributes.push('subcategory')
    const savedColors = values.colors.map((value) => value.toLocaleLowerCase('es'))
    const suggestedColors = previous.colors.map((value) => value.toLocaleLowerCase('es'))
    if (savedColors.join('|') !== suggestedColors.join('|')) correctedAttributes.push('colors')
    if (previous.pattern && values.pattern.trim() !== previous.pattern) correctedAttributes.push('pattern')
    if (previous.brand && values.brand.trim() !== previous.brand) correctedAttributes.push('brand')
    if (previous.size && values.size.trim() !== previous.size) correctedAttributes.push('size')
    if (previous.composition && values.composition.trim() !== previous.composition) correctedAttributes.push('composition')
  }
  if (!suggestion) return !imageChanged && garment?.analysis ? { ...garment.analysis, correctedAttributes } : undefined

  return {
    modelId: suggestion.modelId,
    modelVersion: suggestion.modelVersion,
    ...(suggestion.calibrated ? { calibrated: true } : {}),
    analyzedAt: suggestion.analyzedAt,
    suggestions: {
      category: suggestion.category,
      subcategory: suggestion.subcategory,
      colors: suggestion.colors,
      ...(suggestion.pattern ? { pattern: suggestion.pattern.label } : {}),
      ...(suggestion.sleeve ? { sleeve: suggestion.sleeve.label } : {}),
      ...(suggestion.fit ? { fit: suggestion.fit.label } : {}),
      ...(labelBrand ?? suggestion.brand ? { brand: labelBrand ?? suggestion.brand!.brand } : {}),
      ...(labelSize ? { size: labelSize.value } : {}),
      ...(labelReading?.composition ? { composition: labelReading.composition.value } : {}),
      alternatives: suggestion.alternatives
    },
    confidenceByAttribute: suggestion.confidenceByAttribute,
    sourcesByAttribute: {
      category: 'vesta-dinov2',
      subcategory: 'vesta-dinov2',
      ...(suggestion.pattern ? { pattern: 'vesta-dinov2' as const } : {}),
      ...(labelBrand ?? suggestion.brand ? { brand: 'paddle-ocr' as const } : {}),
      ...(labelSize ? { size: 'paddle-ocr' as const } : {}),
      ...(labelReading?.composition ? { composition: 'paddle-ocr' as const } : {}),
      ...(suggestion.colors.length > 0 ? { colors: 'local-pixels' as const } : {})
    },
    unknownAttributes: suggestion.unknownAttributes,
    correctedAttributes
  }
}
