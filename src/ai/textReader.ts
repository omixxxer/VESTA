import { fetchDescription, fetchModelFile, loadOrt } from './onnxRuntime'

// PaddleOCR PP-OCRv5 mobile (Apache-2.0): a text detector and a Latin-script recognizer, run on the device.
const OCR_BASE = `${import.meta.env.BASE_URL}models/ocr/`
const MAX_LINES = 24

export interface TextLine {
  text: string
  score: number
}

export interface TextBox {
  left: number
  top: number
  right: number
  bottom: number
  score: number
}

interface OcrDescription {
  format: string
  detector: {
    file: string
    bytes: number
    maxSide: number
    multiple: number
    mean: number[]
    std: number[]
    threshold: number
    boxThreshold: number
    unclipRatio: number
  }
  recognizer: { file: string; bytes: number; height: number; maxWidth: number }
  characters: string[]
}

type TextReader = (image: Blob) => Promise<TextLine[]>

let readerPromise: Promise<TextReader> | undefined

/**
 * Text regions from the detector's probability map (DB post-processing, simplified to axis-aligned boxes):
 * connected pixels above `threshold`, kept when their mean probability reaches `boxThreshold`, then grown by
 * area × unclipRatio / perimeter as PaddleOCR does, because the map covers only the core of each word.
 */
export function detectTextBoxes(
  probabilities: ArrayLike<number>,
  width: number,
  height: number,
  settings: Pick<OcrDescription['detector'], 'threshold' | 'boxThreshold' | 'unclipRatio'>
): TextBox[] {
  const visited = new Uint8Array(width * height)
  const boxes: TextBox[] = []
  const stack: number[] = []
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || probabilities[start]! <= settings.threshold) continue
    visited[start] = 1
    stack.push(start)
    let left = width, top = height, right = 0, bottom = 0, total = 0, count = 0
    while (stack.length) {
      const index = stack.pop()!
      const x = index % width
      const y = (index - x) / width
      left = Math.min(left, x); right = Math.max(right, x + 1)
      top = Math.min(top, y); bottom = Math.max(bottom, y + 1)
      total += probabilities[index]!
      count += 1
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && !visited[next] && probabilities[next]! > settings.threshold) {
          visited[next] = 1
          stack.push(next)
        }
      }
    }
    const boxWidth = right - left
    const boxHeight = bottom - top
    if (Math.min(boxWidth, boxHeight) < 3 || total / count < settings.boxThreshold) continue
    const grow = (boxWidth * boxHeight * settings.unclipRatio) / (2 * (boxWidth + boxHeight))
    boxes.push({
      left: Math.max(0, left - grow),
      top: Math.max(0, top - grow),
      right: Math.min(width, right + grow),
      bottom: Math.min(height, bottom + grow),
      score: total / count
    })
  }
  return boxes
}

/** Greedy CTC decoding: best class per step, repeats merged, blanks (class 0) dropped. */
export function ctcDecode(logits: ArrayLike<number>, steps: number, classes: number, characters: string[]): TextLine {
  let text = ''
  let total = 0
  let count = 0
  let previous = 0
  for (let step = 0; step < steps; step += 1) {
    let best = 0
    let bestScore = -Infinity
    for (let index = 0; index < classes; index += 1) {
      const score = logits[step * classes + index]!
      if (score > bestScore) {
        best = index
        bestScore = score
      }
    }
    if (best !== 0 && best !== previous) {
      text += characters[best - 1] ?? ''
      total += bestScore
      count += 1
    }
    previous = best
  }
  return { text, score: count ? total / count : 0 }
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('El navegador no permite preparar la imagen.')
  return { canvas, context }
}

/** PaddleOCR models take BGR, CHW, normalised per channel in that BGR order. */
function toTensorData(data: Uint8ClampedArray, width: number, height: number, mean: number[], std: number[]): Float32Array {
  const pixels = new Float32Array(3 * width * height)
  for (let index = 0; index < width * height; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = data[index * 4 + 2 - channel]! / 255
      pixels[channel * width * height + index] = (value - mean[channel]!) / std[channel]!
    }
  }
  return pixels
}

async function loadReader(): Promise<TextReader> {
  if (!readerPromise) {
    const pending = (async (): Promise<TextReader> => {
      const [ort, description] = await Promise.all([loadOrt(), fetchDescription<OcrDescription>(`${OCR_BASE}ocr-model.json`)])
      if (description.format !== 'vesta-ocr') throw new Error('La descripción del OCR no es válida.')
      const { detector, recognizer } = description
      const [detectorModel, recognizerModel] = await Promise.all([
        fetchModelFile(`${OCR_BASE}${detector.file}?v=${detector.bytes}`),
        fetchModelFile(`${OCR_BASE}${recognizer.file}?v=${recognizer.bytes}`)
      ])
      const options = { executionProviders: ['wasm'] }
      const [detection, recognition] = await Promise.all([
        ort.InferenceSession.create(detectorModel, options),
        ort.InferenceSession.create(recognizerModel, options)
      ])

      return async (image) => {
        const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
        try {
          const scale = Math.min(1, detector.maxSide / Math.max(bitmap.width, bitmap.height))
          const round = (value: number) => Math.max(detector.multiple, Math.round(value * scale / detector.multiple) * detector.multiple)
          const width = round(bitmap.width)
          const height = round(bitmap.height)
          const { context } = canvasOf(width, height)
          context.drawImage(bitmap, 0, 0, width, height)
          const input = toTensorData(context.getImageData(0, 0, width, height).data, width, height, detector.mean, detector.std)
          const detected = await detection.run({ [detection.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, height, width]) })
          const map = detected[detection.outputNames[0]!]!
          const boxes = detectTextBoxes(map.data as Float32Array, width, height, detector)
            .sort((left, right) => (right.right - right.left) * (right.bottom - right.top) - (left.right - left.left) * (left.bottom - left.top))
            .slice(0, MAX_LINES)

          const lines: TextLine[] = []
          for (const box of boxes) {
            const sourceX = box.left * bitmap.width / width
            const sourceY = box.top * bitmap.height / height
            const sourceWidth = (box.right - box.left) * bitmap.width / width
            const sourceHeight = (box.bottom - box.top) * bitmap.height / height
            // Vertical text (e.g. down a shoe's heel) is read after turning it.
            const vertical = sourceHeight > sourceWidth * 1.5
            const ratio = vertical ? sourceHeight / sourceWidth : sourceWidth / sourceHeight
            const lineWidth = Math.max(8, Math.min(recognizer.maxWidth, Math.round(recognizer.height * ratio)))
            const { context: line } = canvasOf(lineWidth, recognizer.height)
            if (vertical) {
              line.translate(0, recognizer.height)
              line.rotate(-Math.PI / 2)
              line.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, recognizer.height, lineWidth)
            } else {
              line.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, lineWidth, recognizer.height)
            }
            const data = toTensorData(line.getImageData(0, 0, lineWidth, recognizer.height).data, lineWidth, recognizer.height, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
            const output = await recognition.run({ [recognition.inputNames[0]!]: new ort.Tensor('float32', data, [1, 3, recognizer.height, lineWidth]) })
            const logits = output[recognition.outputNames[0]!]!
            const [, steps, classes] = logits.dims
            const decoded = ctcDecode(logits.data as Float32Array, steps!, classes!, description.characters)
            if (decoded.text.trim()) lines.push(decoded)
          }
          return lines
        } finally {
          bitmap.close()
        }
      }
    })()
    readerPromise = pending.catch((error: unknown) => {
      readerPromise = undefined
      throw error
    })
  }
  return readerPromise
}

/** Lines of text visible in a photo, with the recognizer's mean confidence per line. */
export async function readText(image: Blob): Promise<TextLine[]> {
  return (await loadReader())(image)
}
