import type { RawImage as RawImageType } from '@huggingface/transformers'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import type { GarmentCategory } from '../types/domain'

export const CLOTHING_MODEL_ID = 'Xenova/clip-vit-base-patch32'
export const CLOTHING_MODEL_VERSION = 'd15189d7028b43f1d3e65039190477f6af591c2a'
export const MODEL_DOWNLOAD_SIZE = 'aprox. 153,7 MB (ONNX q8)'

export interface ClothingPrediction {
  label: string
  score: number
}

export interface ClothingAnalysisSuggestion {
  category: GarmentCategory
  subcategory: string
  colors: string[]
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
type ZeroShotClassifier = (image: RawImageType, candidateLabels: string[]) => Promise<ClothingPrediction[]>

const candidates: Candidate[] = [
  { label: 'a blazer', category: 'Abrigo', subcategory: 'Blazer' },
  { label: 'a blouse', category: 'Parte superior', subcategory: 'Blusa' },
  { label: 'a cardigan', category: 'Abrigo', subcategory: 'Cárdigan' },
  { label: 'a dress', category: 'Vestido / mono', subcategory: 'Vestido' },
  { label: 'a hoodie', category: 'Abrigo', subcategory: 'Sudadera con capucha' },
  { label: 'a jacket', category: 'Abrigo', subcategory: 'Chaqueta' },
  { label: 'jeans', category: 'Parte inferior', subcategory: 'Vaqueros' },
  { label: 'a nightgown', category: 'Vestido / mono', subcategory: 'Camisón' },
  { label: 'outerwear', category: 'Abrigo', subcategory: 'Prenda de abrigo' },
  { label: 'pajamas', category: 'Vestido / mono', subcategory: 'Pijama' },
  { label: 'a rain jacket', category: 'Abrigo', subcategory: 'Chubasquero' },
  { label: 'rain trousers', category: 'Parte inferior', subcategory: 'Pantalón impermeable' },
  { label: 'a robe', category: 'Vestido / mono', subcategory: 'Bata' },
  { label: 'a shirt', category: 'Parte superior', subcategory: 'Camisa' },
  { label: 'shorts', category: 'Parte inferior', subcategory: 'Pantalón corto' },
  { label: 'a skirt', category: 'Parte inferior', subcategory: 'Falda' },
  { label: 'a sweater', category: 'Abrigo', subcategory: 'Jersey' },
  { label: 'a T-shirt', category: 'Parte superior', subcategory: 'Camiseta' },
  { label: 'a tank top', category: 'Parte superior', subcategory: 'Camiseta de tirantes' },
  { label: 'tights', category: 'Parte inferior', subcategory: 'Medias' },
  { label: 'a top', category: 'Parte superior', subcategory: 'Top' },
  { label: 'a training top', category: 'Parte superior', subcategory: 'Prenda deportiva' },
  { label: 'trousers', category: 'Parte inferior', subcategory: 'Pantalón' },
  { label: 'a tunic', category: 'Parte superior', subcategory: 'Túnica' },
  { label: 'a vest', category: 'Abrigo', subcategory: 'Chaleco' },
  { label: 'a winter jacket', category: 'Abrigo', subcategory: 'Chaqueta de invierno' },
  { label: 'winter trousers', category: 'Parte inferior', subcategory: 'Pantalón de invierno' },
  { label: 'shoes', category: 'Calzado', subcategory: 'Zapatos' },
  { label: 'sneakers', category: 'Calzado', subcategory: 'Zapatillas' },
  { label: 'boots', category: 'Calzado', subcategory: 'Botas' },
  { label: 'sandals', category: 'Calzado', subcategory: 'Sandalias' },
  { label: 'a handbag', category: 'Accesorio', subcategory: 'Bolso' },
  { label: 'a hat', category: 'Accesorio', subcategory: 'Sombrero' },
  { label: 'a belt', category: 'Accesorio', subcategory: 'Cinturón' }
]

let classifierPromise: Promise<ZeroShotClassifier> | undefined

export function mapClothingLabel(label: string): Candidate | undefined {
  return candidates.find((candidate) => candidate.label === label)
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
  const { env, pipeline } = await import('@huggingface/transformers')
  env.useBrowserCache = true
  env.useWasmCache = false
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.remotePathTemplate = `{model}/resolve/${CLOTHING_MODEL_VERSION}/`
  const wasmEnvironment = env.backends.onnx.wasm
  if (!wasmEnvironment) throw new Error('El runtime WebAssembly de ONNX no está disponible.')
  wasmEnvironment.wasmPaths = {
    wasm: wasmUrl,
    mjs: wasmModuleUrl
  }
  if (!classifierPromise) {
    const pending = pipeline('zero-shot-image-classification', CLOTHING_MODEL_ID, {
      revision: CLOTHING_MODEL_VERSION,
      dtype: 'q8'
    }) as Promise<ZeroShotClassifier>
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
  return classifier(normalizedImage, candidates.map((candidate) => candidate.label))
}

export async function analyzeGarmentImage(
  image: Blob,
  classify: Classifier = classifyLocally,
  normalize: ImageNormalizer = normalizeImage
): Promise<ClothingAnalysisSuggestion> {
  if (image.size === 0) throw new Error('La imagen está vacía.')

  const normalized = await normalize(image)
  const predictions = await classify(normalized.blob)
  const best = predictions[0]
  if (!best || !Number.isFinite(best.score) || best.score < 0 || best.score > 1) {
    throw new Error('El clasificador no devolvió una puntuación válida.')
  }
  const match = mapClothingLabel(best.label)
  if (!match) throw new Error('El clasificador devolvió una etiqueta no reconocida.')

  const dominantColor = findDominantColor(normalized.pixels)
  return {
    category: match.category,
    subcategory: match.subcategory,
    colors: dominantColor ? [dominantColor.color] : [],
    confidenceByAttribute: {
      category: best.score,
      subcategory: best.score,
      ...(dominantColor ? { colors: dominantColor.score } : {})
    },
    unknownAttributes: [
      ...(!dominantColor ? ['colors'] : []),
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
