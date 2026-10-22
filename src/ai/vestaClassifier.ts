import type { GarmentCategory } from '../types/domain'

/**
 * Adaptador para el clasificador multi-cabeza propio de VESTA (ver /training).
 *
 * Aún NO está conectado a la app: clothingAnalyzer.ts sigue usando el modelo Wargon. Este módulo
 * separa la parte pura (preprocesado y decodificación, probada en vitest) de la parte con
 * navegador (canvas + onnxruntime-web), que hay que validar con un modelo entrenado real.
 */

export interface VestaHeadMeta {
  output: string
  classes: string[]
  labelsEs: string[]
  appCategories?: string[]
}

export interface VestaModelMeta {
  name: string
  modelVersion: string
  taxonomyVersion: string
  input: {
    name: string
    size: number
    resize: 'direct-squash'
    mean: [number, number, number]
    std: [number, number, number]
    channelOrder: 'RGB'
  }
  heads: Record<string, VestaHeadMeta>
}

export interface HeadPrediction {
  value: string
  label: string
  score: number
}

export interface VestaPrediction {
  /** Mejores candidatos por cabeza, ordenados por probabilidad (softmax). */
  heads: Record<string, HeadPrediction[]>
  category?: GarmentCategory
  modelVersion: string
}

const appCategories: readonly string[] = [
  'Parte superior', 'Parte inferior', 'Vestido / mono', 'Abrigo', 'Calzado', 'Accesorio'
]

export function isGarmentCategory(value: string | undefined): value is GarmentCategory {
  return value !== undefined && appCategories.includes(value)
}

export function softmax(logits: ArrayLike<number>): number[] {
  const values = Array.from(logits)
  if (!values.length || values.some((value) => !Number.isFinite(value))) {
    throw new Error('El modelo devolvió puntuaciones no válidas.')
  }
  const maximum = Math.max(...values)
  const exponentials = values.map((value) => Math.exp(value - maximum))
  const sum = exponentials.reduce((total, value) => total + value, 0)
  return exponentials.map((value) => value / sum)
}

/**
 * RGBA (ya redimensionado a size x size) -> tensor float32 CHW normalizado.
 * Debe coincidir con training/dataset.py (Resize directo + normalización ImageNet).
 */
export function pixelsToTensor(
  rgba: Uint8ClampedArray | Uint8Array,
  size: number,
  mean: readonly number[],
  std: readonly number[]
): Float32Array {
  if (rgba.length < size * size * 4) throw new Error('La imagen no tiene el tamaño esperado.')
  const plane = size * size
  const tensor = new Float32Array(3 * plane)
  for (let index = 0; index < plane; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      tensor[channel * plane + index] = ((rgba[index * 4 + channel] ?? 0) / 255 - (mean[channel] ?? 0)) / (std[channel] ?? 1)
    }
  }
  return tensor
}

export function decodeHeads(
  outputs: Record<string, ArrayLike<number>>,
  meta: VestaModelMeta,
  topK = 3
): VestaPrediction {
  const heads: Record<string, HeadPrediction[]> = {}
  for (const [head, spec] of Object.entries(meta.heads)) {
    const logits = outputs[spec.output]
    if (!logits) throw new Error(`Falta la salida ${spec.output} del modelo.`)
    if (logits.length !== spec.classes.length) {
      throw new Error(`La cabeza ${head} devolvió ${logits.length} valores y se esperaban ${spec.classes.length}.`)
    }
    heads[head] = softmax(logits)
      .map((score, index) => ({
        value: spec.classes[index] as string,
        label: spec.labelsEs[index] ?? (spec.classes[index] as string),
        score
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
  }

  // La categoría de la app se deriva del subtipo (más fiable); si no hay subtipo, de la cabeza 'category'.
  const subtype = meta.heads.subtype
  const bestSubtype = heads.subtype?.[0]
  const fromSubtype = subtype?.appCategories && bestSubtype
    ? subtype.appCategories[subtype.classes.indexOf(bestSubtype.value)]
    : undefined
  const categoryHead = meta.heads.category
  const bestCategory = heads.category?.[0]
  const fromCategory = categoryHead?.appCategories && bestCategory
    ? categoryHead.appCategories[categoryHead.classes.indexOf(bestCategory.value)]
    : undefined
  const category = fromSubtype ?? fromCategory
  return {
    heads,
    ...(isGarmentCategory(category) ? { category } : {}),
    modelVersion: meta.modelVersion
  }
}

// --- Parte con navegador (no cubierta por tests unitarios) ---------------------------------

interface OrtTensorLike { data: ArrayLike<number> }
interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>
}

export interface VestaClassifier {
  meta: VestaModelMeta
  classify(image: Blob): Promise<VestaPrediction>
}

async function imageToRgba(image: Blob, size: number): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('El navegador no permite preparar la imagen.')
    context.drawImage(bitmap, 0, 0, size, size)
    return context.getImageData(0, 0, size, size).data
  } finally {
    bitmap.close()
  }
}

/** Carga vesta_model.json y onnx/model_quantized.onnx desde `${baseUrl}models/vesta-garment-classifier/`. */
export async function loadVestaClassifier(
  modelBaseUrl = `${import.meta.env.BASE_URL}models/vesta-garment-classifier/`
): Promise<VestaClassifier> {
  const metaResponse = await fetch(`${modelBaseUrl}vesta_model.json`)
  if (!metaResponse.ok) throw new Error('No se pudo cargar los metadatos del modelo.')
  const meta = (await metaResponse.json()) as VestaModelMeta
  const ort = await import('onnxruntime-web')
  const session = (await ort.InferenceSession.create(`${modelBaseUrl}onnx/model_quantized.onnx`)) as unknown as OrtSessionLike
  return {
    meta,
    async classify(image: Blob) {
      const { size, mean, std, name } = meta.input
      const tensor = pixelsToTensor(await imageToRgba(image, size), size, mean, std)
      const results = await session.run({ [name]: new ort.Tensor('float32', tensor, [1, 3, size, size]) })
      const outputs = Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.data]))
      return decodeHeads(outputs, meta)
    }
  }
}
