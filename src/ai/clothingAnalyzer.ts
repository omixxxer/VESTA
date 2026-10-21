import type { RawImage as RawImageType } from '@huggingface/transformers'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import type { GarmentCategory } from '../types/domain'

export const CLOTHING_MODEL_ID = 'wargoninnovation/wargon-clothing-classifier'
export const CLOTHING_MODEL_VERSION = '972befbd9a82cda03352239d813ff4959d2ccb4d'
export const MODEL_DOWNLOAD_SIZE = 'aprox. 89,2 MB (ONNX q8)'

export interface ClothingPrediction {
  label: string
  score: number
}

export interface ClothingAnalysisSuggestion {
  category: GarmentCategory
  subcategory: string
  colors: string[]
  alternatives: Array<{
    category: GarmentCategory
    subcategory: string
    score: number
  }>
  confidenceByAttribute: Partial<Record<'category' | 'subcategory' | 'colors', number>>
  unknownAttributes: string[]
  modelId: string
  modelVersion: string
  analyzedAt: string
}

interface Candidate {
  label: string
  category: GarmentCategory
  subcategory: string
}

interface NormalizedImage {
  blob: Blob
  pixels: ImageData
}

type Classifier = (image: Blob) => Promise<ClothingPrediction[]>
type ImageNormalizer = (image: Blob) => Promise<NormalizedImage>
type ImageClassifier = (image: RawImageType) => Promise<ClothingPrediction[]>

const modelClasses: Candidate[] = [
  { label: 'Blazer', category: 'Abrigo', subcategory: 'Blazer' },
  { label: 'Blouse', category: 'Parte superior', subcategory: 'Blusa' },
  { label: 'Cardigan', category: 'Abrigo', subcategory: 'Cárdigan' },
  { label: 'Dress', category: 'Vestido / mono', subcategory: 'Vestido' },
  { label: 'Hoodie', category: 'Abrigo', subcategory: 'Sudadera con capucha' },
  { label: 'Jacket', category: 'Abrigo', subcategory: 'Chaqueta' },
  { label: 'Jeans', category: 'Parte inferior', subcategory: 'Vaqueros' },
  { label: 'Nightgown', category: 'Vestido / mono', subcategory: 'Camisón' },
  { label: 'Outerwear', category: 'Abrigo', subcategory: 'Prenda de abrigo' },
  { label: 'Pajamas', category: 'Vestido / mono', subcategory: 'Pijama' },
  { label: 'Rain jacket', category: 'Abrigo', subcategory: 'Chubasquero' },
  { label: 'Rain trousers', category: 'Parte inferior', subcategory: 'Pantalón impermeable' },
  { label: 'Robe', category: 'Vestido / mono', subcategory: 'Bata' },
  { label: 'Shirt', category: 'Parte superior', subcategory: 'Camisa' },
  { label: 'Shorts', category: 'Parte inferior', subcategory: 'Pantalón corto' },
  { label: 'Skirt', category: 'Parte inferior', subcategory: 'Falda' },
  { label: 'Sweater', category: 'Abrigo', subcategory: 'Jersey' },
  { label: 'T-shirt', category: 'Parte superior', subcategory: 'Camiseta' },
  { label: 'Tank top', category: 'Parte superior', subcategory: 'Camiseta de tirantes' },
  { label: 'Tights', category: 'Parte inferior', subcategory: 'Medias' },
  { label: 'Top', category: 'Parte superior', subcategory: 'Top' },
  { label: 'Training top', category: 'Parte superior', subcategory: 'Prenda deportiva' },
  { label: 'Trousers', category: 'Parte inferior', subcategory: 'Pantalón' },
  { label: 'Tunic', category: 'Parte superior', subcategory: 'Túnica' },
  { label: 'Vest', category: 'Abrigo', subcategory: 'Chaleco' },
  { label: 'Winter jacket', category: 'Abrigo', subcategory: 'Chaqueta de invierno' },
  { label: 'Winter trousers', category: 'Parte inferior', subcategory: 'Pantalón de invierno' }
]

let classifierPromise: Promise<ImageClassifier> | undefined

export function mapClothingLabel(label: string): Candidate | undefined {
  const classIndex = /^LABEL_(\d+)$/.exec(label)?.[1]
  const classLabel = classIndex === undefined ? label : modelClasses[Number(classIndex)]?.label
  return modelClasses.find((candidate) => candidate.label === classLabel)
}

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

function getLogitValues(output: unknown): number[] {
  const logits = typeof output === 'object' && output !== null && 'logits' in output
    ? output.logits
    : undefined
  const data = typeof logits === 'object' && logits !== null && 'data' in logits
    ? logits.data
    : undefined
  if (!Array.isArray(data) && !(data instanceof Float32Array) && !(data instanceof Float64Array)) {
    throw new Error('El modelo no devolvió una salida de clasificación válida.')
  }

  const values = Array.from(data)
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('El modelo devolvió puntuaciones de clasificación no válidas.')
  }
  return values
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

async function loadClassifier() {
  const { AutoImageProcessor, AutoModelForImageClassification, env } = await import('@huggingface/transformers')
  env.useBrowserCache = true
  env.useWasmCache = false
  env.allowLocalModels = true
  env.allowRemoteModels = false
  env.localModelPath = `${import.meta.env.BASE_URL}models/`
  const wasmEnvironment = env.backends.onnx.wasm
  if (!wasmEnvironment) throw new Error('El runtime WebAssembly de ONNX no está disponible.')
  wasmEnvironment.wasmPaths = {
    wasm: wasmUrl,
    mjs: wasmModuleUrl
  }
  if (!classifierPromise) {
    const pending = Promise.all([
      AutoImageProcessor.from_pretrained(CLOTHING_MODEL_ID),
      AutoModelForImageClassification.from_pretrained(CLOTHING_MODEL_ID, { dtype: 'q8' })
    ]).then(([processor, model]): ImageClassifier => async (image) => {
      const { pixel_values } = await processor(image)
      const logits = getLogitValues(await model({ pixel_values }))
      const maximum = Math.max(...logits)
      const exponentials = logits.map((value) => Math.exp(value - maximum))
      const denominator = exponentials.reduce((sum, value) => sum + value, 0)
      return exponentials.map((value, index) => ({
        label: `LABEL_${index}`,
        score: value / denominator
      })).sort((left, right) => right.score - left.score)
    })
    classifierPromise = pending.catch((error: unknown) => {
      classifierPromise = undefined
      throw error
    })
  }
  return classifierPromise
}

async function classifyLocally(image: Blob): Promise<ClothingPrediction[]> {
  const [{ RawImage }, classifier] = await Promise.all([
    import('@huggingface/transformers'),
    loadClassifier()
  ])
  const normalizedImage = await RawImage.fromBlob(image)
  return classifier(normalizedImage)
}

export async function analyzeGarmentImage(
  images: Blob | Blob[],
  classify: Classifier = classifyLocally,
  normalize: ImageNormalizer = normalizeImage
): Promise<ClothingAnalysisSuggestion> {
  const imageList = Array.isArray(images) ? images : [images]
  if (!imageList.length || imageList.some((image) => image.size === 0)) {
    throw new Error('Añade al menos una imagen válida.')
  }

  const scoresByLabel = new Map<string, number>()
  const colorCounts = new Map<string, { count: number; confidence: number }>()
  for (const image of imageList) {
    const normalized = await normalize(image)
    const predictions = await classify(normalized.blob)
    if (!predictions.length || predictions.some((prediction) =>
      !Number.isFinite(prediction.score) || prediction.score < 0 || prediction.score > 1
    )) {
      throw new Error('El clasificador devolvió puntuaciones o etiquetas no válidas.')
    }
    for (const prediction of predictions) {
      if (!mapClothingLabel(prediction.label)) {
        throw new Error('El clasificador devolvió una etiqueta no reconocida.')
      }
      scoresByLabel.set(prediction.label, (scoresByLabel.get(prediction.label) ?? 0) + prediction.score / imageList.length)
    }

    const dominantColor = findDominantColor(normalized.pixels)
    if (dominantColor) {
      const color = colorCounts.get(dominantColor.color) ?? { count: 0, confidence: 0 }
      color.count += 1
      color.confidence += dominantColor.score
      colorCounts.set(dominantColor.color, color)
    }
  }

  const classPredictions = [...scoresByLabel.entries()]
    .map(([label, score]) => ({ label, score, match: mapClothingLabel(label)! }))
    .sort((left, right) => right.score - left.score)
  const best = classPredictions[0]
  if (!best) throw new Error('El clasificador no devolvió ninguna predicción.')
  const colors = [...colorCounts.entries()]
    .sort((left, right) => right[1].count - left[1].count || right[1].confidence - left[1].confidence)
    .slice(0, 3)
  const dominantColor = colors[0]
  return {
    category: best.match.category,
    subcategory: best.match.subcategory,
    colors: colors.map(([color]) => color),
    alternatives: classPredictions.slice(1, 4).map(({ match, score }) => ({
      category: match.category,
      subcategory: match.subcategory,
      score
    })),
    confidenceByAttribute: {
      category: best.score,
      subcategory: best.score,
      ...(dominantColor ? { colors: dominantColor[1].confidence / dominantColor[1].count } : {})
    },
    unknownAttributes: [
      ...(!colors.length ? ['colors'] : []),
      'pattern',
      'sleeveType',
      'neckline',
      'fit',
      'style',
      'formality',
      'season',
      'brand',
      'size',
      'textileComposition',
      'multipleItems',
      'occlusion'
    ],
    modelId: CLOTHING_MODEL_ID,
    modelVersion: CLOTHING_MODEL_VERSION,
    analyzedAt: new Date().toISOString()
  }
}
