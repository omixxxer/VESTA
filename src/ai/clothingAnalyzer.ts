import { TAXONOMY_VERSION, taxonomy } from '../ml/taxonomy'
import type { GarmentCategory } from '../types/domain'
import { findBrand, type BrandMatch } from './brands'
import { findComposition, findSize, type LabelValue } from './labelParser'
import { fetchDescription, fetchModelFile, loadOrt } from './onnxRuntime'
import { readText, type TextLine } from './textReader'

// Own model trained in ml/ (DINOv2-small + heads); exported with python -m vesta_ml.export.
export const CLOTHING_MODEL_ID = 'vesta/dinov2-small-heads'
export const MODEL_DOWNLOAD_SIZE = 'aprox. 38,5 MB (clasificador de 25,6 MB y lector de texto de 12,9 MB)'
const MODEL_BASE = `${import.meta.env.BASE_URL}models/vesta/`

/** Probabilities per head (category, subcategory, sleeve, fit, pattern), keyed by taxonomy id. */
export type HeadProbabilities = Record<string, Record<string, number>>

export interface AttributeSuggestion {
  value: string
  label: string
  score: number
}

export interface ClothingAnalysisSuggestion {
  category: GarmentCategory
  subcategory: string
  colors: string[]
  pattern?: AttributeSuggestion
  sleeve?: AttributeSuggestion
  fit?: AttributeSuggestion
  /** Brand found in text visible in the photos (on-device OCR); logos without lettering are not recognised. */
  brand?: BrandMatch
  alternatives: Array<{
    category: GarmentCategory
    subcategory: string
    score: number
  }>
  confidenceByAttribute: Partial<Record<'category' | 'subcategory' | 'colors' | 'pattern' | 'brand', number>>
  unknownAttributes: string[]
  modelId: string
  modelVersion: string
  /** Scores adjusted by temperature scaling so that 80 % is right about 8 times in 10 (vesta_ml.calibrate). */
  calibrated: boolean
  analyzedAt: string
}

interface ModelDescription {
  format: string
  name: string
  taxonomyVersion: number
  preprocessing: { inputSize: number; padColor: number[]; mean: number[]; std: number[] }
  input: string
  /** temperature divides the logits before the softmax; missing in models exported before calibration. */
  heads: Array<{ name: string; multiLabel: boolean; values: string[]; temperature?: number }>
  file: string
  bytes: number
}

interface NormalizedImage {
  blob: Blob
  pixels: ImageData
}

interface Classification {
  modelVersion: string
  probabilities: HeadProbabilities
  calibrated?: boolean
}

interface RankedPair {
  category: string
  subcategory?: string
  score: number
  conditional: number
}

type Classifier = (image: Blob) => Promise<Classification>
type ImageNormalizer = (image: Blob) => Promise<NormalizedImage>
type TextReader = (image: Blob) => Promise<TextLine[]>

let classifierPromise: Promise<Classifier> | undefined

const categoryLabels = new Map(taxonomy.categories.map((entry) => [entry.id, entry.label as GarmentCategory]))
const subcategoryEntries = new Map(taxonomy.subcategories.map((entry) => [entry.id, entry]))

function getColorName(red: number, green: number, blue: number): string {
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000

  if (brightness < 45) return 'Negro'
  if (brightness > 226 && maximum - minimum < 36) return 'Blanco'
  if (maximum - minimum < 24) return brightness > 165 ? 'Gris claro' : 'Gris'

  if (red > 175 && green > 105 && blue < 115 && red - blue > 75) return 'Naranja'
  if (red > green * 1.25 && red > blue * 1.25) return 'Rojo'
  if (green > red * 1.18 && green > blue * 1.12) return 'Verde'
  if (blue > red * 1.15 && blue > green * 1.08) return 'Azul'
  if (red > 125 && blue > 85 && red > green * 1.05) return 'Morado'
  if (red > 155 && green > 105 && blue < 140) return 'Marrón'
  return 'Beige'
}

function colorBucket(red: number, green: number, blue: number): string {
  return [red, green, blue].map((value) => Math.floor(value / 32)).join(':')
}

export function findDominantColor(pixels: ImageData): { color: string; score: number } | undefined {
  const { data, width, height } = pixels
  if (!width || !height || data.length < width * height * 4) return undefined

  const edgeBuckets = new Map<string, number>()
  const sampleStep = Math.max(1, Math.floor(Math.min(width, height) / 48))
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      if (x > sampleStep && x < width - sampleStep && y > sampleStep && y < height - sampleStep) continue
      const offset = (y * width + x) * 4
      const key = colorBucket(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0)
      edgeBuckets.set(key, (edgeBuckets.get(key) ?? 0) + 1)
    }
  }

  const backgroundBucket = [...edgeBuckets.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  const background = backgroundBucket?.split(':').map((value) => (Number(value) * 32) + 16)
  const colors = new Map<string, { count: number; red: number; green: number; blue: number }>()
  let considered = 0
  const marginX = Math.floor(width * 0.08)
  const marginY = Math.floor(height * 0.08)

  for (let y = marginY; y < height - marginY; y += sampleStep) {
    for (let x = marginX; x < width - marginX; x += sampleStep) {
      const offset = (y * width + x) * 4
      const red = data[offset] ?? 0
      const green = data[offset + 1] ?? 0
      const blue = data[offset + 2] ?? 0
      if (background && Math.abs(red - background[0]!) + Math.abs(green - background[1]!) + Math.abs(blue - background[2]!) < 72) {
        continue
      }

      considered += 1
      const key = colorBucket(red, green, blue)
      const bucket = colors.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
      bucket.count += 1
      bucket.red += red
      bucket.green += green
      bucket.blue += blue
      colors.set(key, bucket)
    }
  }

  if (!considered) {
    for (let y = marginY; y < height - marginY; y += sampleStep) {
      for (let x = marginX; x < width - marginX; x += sampleStep) {
        const offset = (y * width + x) * 4
        const red = data[offset] ?? 0
        const green = data[offset + 1] ?? 0
        const blue = data[offset + 2] ?? 0
        const key = colorBucket(red, green, blue)
        const bucket = colors.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
        bucket.count += 1
        bucket.red += red
        bucket.green += green
        bucket.blue += blue
        colors.set(key, bucket)
        considered += 1
      }
    }
  }

  const dominant = [...colors.values()].sort((left, right) => right.count - left.count)[0]
  if (!dominant || !considered) return undefined
  const red = Math.round(dominant.red / dominant.count)
  const green = Math.round(dominant.green / dominant.count)
  const blue = Math.round(dominant.blue / dominant.count)
  return {
    color: getColorName(red, green, blue),
    score: dominant.count / considered
  }
}

async function normalizeImage(image: Blob): Promise<NormalizedImage> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('El navegador no permite preparar la imagen.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = 96
    colorCanvas.height = 96
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })
    if (!colorContext) throw new Error('El navegador no permite analizar los colores.')
    colorContext.drawImage(canvas, 0, 0, 96, 96)
    const pixels = colorContext.getImageData(0, 0, 96, 96)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result)
        else reject(new Error('No se pudo normalizar la imagen.'))
      }, 'image/jpeg', 0.9)
    })
    return { blob, pixels }
  } finally {
    bitmap.close()
  }
}

/** Same as ml/vesta_ml/features.preprocess: letterbox on the mean colour, then ImageNet normalisation, CHW. */
async function preprocess(image: Blob, settings: ModelDescription['preprocessing']): Promise<Float32Array> {
  const size = settings.inputSize
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('El navegador no permite preparar la imagen.')
    const [red, green, blue] = settings.padColor
    context.fillStyle = `rgb(${red}, ${green}, ${blue})`
    context.fillRect(0, 0, size, size)
    const scale = size / Math.max(bitmap.width, bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, Math.floor((size - width) / 2), Math.floor((size - height) / 2), width, height)
    const { data } = context.getImageData(0, 0, size, size)
    const pixels = new Float32Array(3 * size * size)
    for (let index = 0; index < size * size; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[channel * size * size + index] = ((data[index * 4 + channel]! / 255) - settings.mean[channel]!) / settings.std[channel]!
      }
    }
    return pixels
  } finally {
    bitmap.close()
  }
}

function softmax(logits: ArrayLike<number>, temperature = 1): number[] {
  const values = Array.from(logits, (value) => value / temperature)
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('El modelo devolvió puntuaciones de clasificación no válidas.')
  }
  const maximum = Math.max(...values)
  const exponentials = values.map((value) => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return exponentials.map((value) => value / total)
}

async function loadDescription(): Promise<ModelDescription> {
  const description = await fetchDescription<ModelDescription>(`${MODEL_BASE}vesta-model.json`)
  if (description.format !== 'vesta-model') throw new Error('La descripción del modelo no es válida.')
  if (description.taxonomyVersion !== TAXONOMY_VERSION) {
    throw new Error(`El modelo usa la taxonomía v${description.taxonomyVersion} y la app la v${TAXONOMY_VERSION}.`)
  }
  return description
}

async function loadClassifier(): Promise<Classifier> {
  if (!classifierPromise) {
    const pending = (async (): Promise<Classifier> => {
      const [ort, description] = await Promise.all([loadOrt(), loadDescription()])
      // Cached by name and size, so a new export is downloaded again.
      const model = await fetchModelFile(`${MODEL_BASE}${description.file}?v=${description.name}-${description.bytes}`)
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
      const heads = description.heads.filter((head) => !head.multiLabel)
      const size = description.preprocessing.inputSize
      return async (image) => {
        const pixels = await preprocess(image, description.preprocessing)
        const outputs = await session.run({ [description.input]: new ort.Tensor('float32', pixels, [1, 3, size, size]) })
        const probabilities: HeadProbabilities = {}
        for (const head of heads) {
          const output = outputs[head.name]
          if (!output) throw new Error(`El modelo no devolvió la cabeza ${head.name}.`)
          const scores = softmax(output.data as Float32Array, head.temperature)
          probabilities[head.name] = Object.fromEntries(head.values.map((value, index) => [value, scores[index] ?? 0]))
        }
        return { modelVersion: description.name, probabilities, calibrated: heads.every((head) => head.temperature !== undefined) }
      }
    })()
    classifierPromise = pending.catch((error: unknown) => {
      classifierPromise = undefined
      throw error
    })
  }
  return classifierPromise
}

async function classifyLocally(image: Blob): Promise<Classification> {
  return (await loadClassifier())(image)
}

function best(scores: Record<string, number> | undefined): [string, number] | undefined {
  return Object.entries(scores ?? {}).sort((left, right) => right[1] - left[1])[0]
}

/** Mirrors Taxonomy.applies in ml/vesta_ml/taxonomy.py: sleeve on tops, fit on trousers… */
export function attributeApplies(head: string, category: string, subcategory: string | undefined): boolean {
  const attribute = (taxonomy.attributes as Record<string, { appliesTo?: string[]; appliesToSubcategories?: string[] }>)[head]
  if (attribute?.appliesTo && !attribute.appliesTo.includes(category)) return false
  return !attribute?.appliesToSubcategories || !subcategory || attribute.appliesToSubcategories.includes(subcategory)
}

/** Subcategory scores within one category, renormalised (ml/vesta_ml/targets.apply_rules). */
function subcategoriesOf(category: string, scores: Record<string, number>): Array<[string, number]> {
  const within = Object.entries(scores).filter(([value]) => subcategoryEntries.get(value)?.category === category)
  const total = within.reduce((sum, [, score]) => sum + score, 0)
  return total > 0 ? within.map(([value, score]): [string, number] => [value, score / total]).sort((left, right) => right[1] - left[1]) : []
}

function attributeSuggestion(head: string, scores: Record<string, number> | undefined): AttributeSuggestion | undefined {
  const top = best(scores)
  const values = (taxonomy.attributes as Record<string, { values: Array<{ id: string; label: string }> }>)[head]?.values
  const label = values?.find((value) => value.id === top?.[0])?.label
  return top && label ? { value: top[0], label, score: top[1] } : undefined
}

export async function analyzeGarmentImage(
  images: Blob | Blob[],
  classify: Classifier = classifyLocally,
  normalize: ImageNormalizer = normalizeImage,
  read: TextReader = readText
): Promise<ClothingAnalysisSuggestion> {
  const imageList = Array.isArray(images) ? images : [images]
  if (!imageList.length || imageList.some((image) => image.size === 0)) {
    throw new Error('Añade al menos una imagen válida.')
  }

  // Probabilities of every photo are averaged per head; colours are counted per photo. The care label has its own
  // field and is read apart (readGarmentLabel), so it never weighs on these results.
  const averaged: HeadProbabilities = {}
  const colorCounts = new Map<string, { count: number; confidence: number }>()
  const textLines: TextLine[] = []
  let textFailed = false
  let modelVersion = ''
  let calibrated = true
  for (const image of imageList) {
    const normalized = await normalize(image)
    // Reading text is a bonus: if it fails the rest of the suggestion still stands, just without a brand.
    const [result, lines] = await Promise.all([
      classify(normalized.blob),
      textFailed ? Promise.resolve([]) : read(normalized.blob).catch((error: unknown) => {
        console.warn('No se pudo leer el texto de la foto:', error)
        textFailed = true
        return []
      })
    ])
    textLines.push(...lines)
    if (!result.probabilities.category || Object.values(result.probabilities).some((scores) =>
      Object.values(scores).some((score) => !Number.isFinite(score) || score < 0 || score > 1)
    )) {
      throw new Error('El clasificador devolvió puntuaciones o etiquetas no válidas.')
    }
    modelVersion = result.modelVersion
    calibrated &&= result.calibrated === true
    for (const [head, scores] of Object.entries(result.probabilities)) {
      const total = averaged[head] ??= {}
      for (const [value, score] of Object.entries(scores)) total[value] = (total[value] ?? 0) + score / imageList.length
    }

    const dominantColor = findDominantColor(normalized.pixels)
    if (dominantColor) {
      const color = colorCounts.get(dominantColor.color) ?? { count: 0, confidence: 0 }
      color.count += 1
      color.confidence += dominantColor.score
      colorCounts.set(dominantColor.color, color)
    }
  }

  const categoryScores = averaged.category!
  // Every (category, subcategory) pair ranked by P(category) × P(subcategory | category).
  const ranked = Object.entries(categoryScores)
    .filter(([category]) => categoryLabels.has(category))
    .flatMap(([category, categoryScore]): RankedPair[] => {
      const subcategories = subcategoriesOf(category, averaged.subcategory ?? {})
      return subcategories.length
        ? subcategories.map(([subcategory, score]) => ({ category, subcategory, score: categoryScore * score, conditional: score }))
        : [{ category, subcategory: undefined, score: categoryScore, conditional: 0 }]
    })
    .sort((left, right) => right.score - left.score)
  const [category, categoryScore] = best(categoryScores) ?? []
  if (!category || categoryScore === undefined || !categoryLabels.has(category)) {
    throw new Error('El clasificador devolvió una etiqueta no reconocida.')
  }
  const top = ranked.find((entry) => entry.category === category)!
  const labelOf = (subcategory: string | undefined) => (subcategory && subcategoryEntries.get(subcategory)?.label) || ''

  const attributes = Object.fromEntries((['pattern', 'sleeve', 'fit'] as const)
    .filter((head) => attributeApplies(head, category, top.subcategory))
    .map((head) => [head, attributeSuggestion(head, averaged[head])])
    .filter(([, suggestion]) => suggestion)) as Partial<Record<'pattern' | 'sleeve' | 'fit', AttributeSuggestion>>

  const colors = [...colorCounts.entries()]
    .sort((left, right) => right[1].count - left[1].count || right[1].confidence - left[1].confidence)
    .slice(0, 3)
  const dominantColor = colors[0]
  const brand = findBrand(textLines)
  return {
    category: categoryLabels.get(category)!,
    subcategory: labelOf(top.subcategory),
    colors: colors.map(([color]) => color),
    ...attributes,
    ...(brand ? { brand } : {}),
    alternatives: ranked.filter((entry) => entry !== top).slice(0, 3).map((entry) => ({
      category: categoryLabels.get(entry.category)!,
      subcategory: labelOf(entry.subcategory),
      score: entry.score
    })),
    confidenceByAttribute: {
      category: categoryScore,
      ...(top.subcategory ? { subcategory: top.conditional } : {}),
      ...(attributes.pattern ? { pattern: attributes.pattern.score } : {}),
      ...(brand ? { brand: brand.score } : {}),
      ...(dominantColor ? { colors: dominantColor[1].confidence / dominantColor[1].count } : {})
    },
    unknownAttributes: [
      ...(!top.subcategory ? ['subcategory'] : []),
      ...(!colors.length ? ['colors'] : []),
      ...(!attributes.pattern ? ['pattern'] : []),
      'neckline',
      'style',
      'formality',
      'season',
      ...(!brand ? ['brand'] : []),
      // Read from the label photo, which is analysed apart.
      'size',
      'textileComposition',
      'multipleItems',
      'occlusion'
    ],
    modelId: CLOTHING_MODEL_ID,
    modelVersion,
    calibrated,
    analyzedAt: new Date().toISOString()
  }
}

export interface LabelReading {
  /** Every line read, so the size can be chosen again when the category changes (findSize depends on it). */
  lines: TextLine[]
  brand?: BrandMatch
  composition?: LabelValue
}

/** Reads the care label photo: only text, never the garment classifier, so it does not affect the type or colour. */
export async function readGarmentLabel(
  image: Blob,
  normalize: ImageNormalizer = normalizeImage,
  read: TextReader = readText
): Promise<LabelReading> {
  if (image.size === 0) throw new Error('La foto de la etiqueta está vacía.')
  const lines = await read((await normalize(image)).blob)
  const brand = findBrand(lines)
  const composition = findComposition(lines)
  return { lines, ...(brand ? { brand } : {}), ...(composition ? { composition } : {}) }
}

/** The size on a label for a garment category (the category label shown in the app). */
export function labelSize(reading: LabelReading | undefined, category: GarmentCategory): LabelValue | undefined {
  if (!reading) return undefined
  const categoryId = taxonomy.categories.find((entry) => entry.label === category)?.id
  return findSize(reading.lines, categoryId)
}
